import { LRUCache } from 'lru-cache';

export interface AiContext {
  customerName?: string;
  customerEmail?: string;
  orderSummary?: string;
  inStockProducts?: Array<{ id: string; name: string; price: number; category?: string; description?: string }>;
  stylists?: Array<{ name: string; role: string; rating: number }>;
  history?: Array<{ sender: 'user' | 'ai' | 'admin'; text: string }>;
}

// ── In-memory answer cache ──────────────────────────────────────────────────
// Only generic, non-personalized concierge answers are cached (see askOnlineAi).
// Keeps repeat questions instant and shields the LLM from duplicate load, per
// the AGENTS.md performance standard (in-memory LRU cache with fallback).
const answerCache = new LRUCache<string, string>({
  max: 200,
  ttl: 10 * 60 * 1000, // 10 minutes
});

/**
 * 1. NVIDIA NIM — primary provider. Retries once, but ONLY when the failure was
 *    fast (a transient network error). A slow model that hits the timeout is not
 *    retried — re-running the same slow model would just burn the remaining
 *    budget and still miss. Every attempt is bounded by the shared deadline.
 */
async function callNvidiaNim(
  messages: Array<{ role: string; content: string }>,
  deadline: number,
): Promise<string | null> {
  const apiKey = (process.env.NVIDIA_API_KEY || '').trim();
  if (!apiKey) return null;

  const model = process.env.NVIDIA_MODEL || 'meta/llama-3.2-11b-vision-instruct';
  const body = JSON.stringify({ model, messages, temperature: 0.72, max_tokens: 350 });

  for (let attempt = 0; attempt < 2; attempt++) {
    // Remaining budget for this attempt: never less than 1s, never above the
    // per-attempt cap. The cap is generous because the verified NVIDIA model is
    // slow (observed up to ~6s) — a tight cap would abort calls that were about
    // to succeed and needlessly fall back to the rule-based synthesizer.
    const remaining = deadline - Date.now();
    if (remaining < 1000) return null;
    const timeout = Math.min(6500, remaining);
    const started = Date.now();
    let tid: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      tid = setTimeout(() => controller.abort(), timeout);
      const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (res.ok) {
        const data: any = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text && text.trim().length > 10) return text.trim();
      }
      // A definitive HTTP response (even an error) means the provider answered —
      // do not burn a retry on auth / rate-limit / model errors.
      return null;
    } catch {
      if (tid) clearTimeout(tid);
      /* network error or abort. Retry once ONLY if the failure was fast, i.e.
         a transient connection error rather than a slow model timing out. */
      if (Date.now() - started >= timeout - 200) break; // hit the timeout → don't retry
    }
  }
  return null;
}

/**
 * 2. Pollinations.AI free proxy — bounded by the shared deadline.
 */
async function callPollinationsAi(
  messages: Array<{ role: string; content: string }>,
  deadline: number,
): Promise<string | null> {
  const remaining = deadline - Date.now();
  if (remaining < 1000) return null;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), Math.min(4000, remaining));
    const res = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/plain, */*', 'User-Agent': 'UrbanBlade/2.0' },
      body: JSON.stringify({ messages, model: 'openai' }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (res.ok) {
      let reply = await res.text();
      if (reply && reply.length > 15 &&
          !reply.includes('<!DOCTYPE') && !reply.includes('502:') &&
          !reply.includes('Cloudflare') && !reply.includes('Queue full')) {
        // Strip Pollinations footer
        reply = reply.split(/\n*---+\s*\n*(?:\*\*)?Support Pollinations/i)[0]
                     .split(/\n*🌸/)[0].trim();
        if (reply.length > 10) return reply;
      }
    }
  } catch { /* abort or network error */ }
  return null;
}

/**
 * Total time budget for the whole LLM stage. The support route enforces a 9s
 * hard timeout. The verified NVIDIA model is slow and variable (2–6s), so we
 * allow up to 7.5s here to give it a real chance to answer, while still leaving
 * headroom for the Tier-3 synthesizer and the inquiry persistence write that
 * follow before the 9s route deadline.
 */
const LLM_TOTAL_BUDGET_MS = 7500;

/**
 * Use the configured provider first. The anonymous public fallback is opt-in
 * because customer support text must not be sent to another processor by
 * default merely because the primary provider is slow or unavailable.
 */
async function callConfiguredLlm(messages: Array<{ role: string; content: string }>): Promise<string | null> {
  const deadline = Date.now() + LLM_TOTAL_BUDGET_MS;
  const configuredReply = await callNvidiaNim(messages, deadline);
  if (configuredReply) return configuredReply;
  if (process.env.AI_ALLOW_PUBLIC_FALLBACK !== 'true') return null;
  return callPollinationsAi(messages, deadline);
}

/**
 * Deterministically pick one variant from a list of fallback templates.
 *
 * The Tier-3 rule-based fallbacks used to be a single fixed string per
 * language, so when the live LLM was unavailable every generic question got the
 * byte-for-byte identical reply. Rotating through several variants — chosen by a
 * stable hash of the user's message — means the SAME question always gets the
 * SAME variant (predictable, cache-friendly) while DIFFERENT questions get
 * DIFFERENT replies (no "same reply every time" effect).
 */
function pickVariant(variants: string[], seed: string): string {
  if (variants.length <= 1) return variants[0] ?? '';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % variants.length;
  return variants[idx];
}


export async function askOnlineAi(userMessage: string, context?: AiContext): Promise<string> {
  const safeMsg = (userMessage || '').trim();
  if (!safeMsg) {
    return 'Hello! How can I assist you with your grooming, hair styling, or orders today?';
  }

  // ── Cache (all replies, LLM or Tier-3 fallback) ───────────────────────────
  // Only generic, non-personalized concierge turns are cached. Skip when a live
  // order summary or conversation history is in play so per-user / per-turn
  // answers are never served from another session's cache entry. Caching the
  // FINAL result (not just the LLM reply) guarantees the same question always
  // gets the same answer even when the LLM intermittently times out.
  const isCacheable = !context?.orderSummary && (!context?.history || context.history.length === 0);
  const cacheKey = `${safeMsg.toLowerCase()}`;
  if (isCacheable) {
    const cached = answerCache.get(cacheKey);
    if (cached) return cached;
  }

  const reply = await computeAiReply(safeMsg, context);
  if (isCacheable && reply) answerCache.set(cacheKey, reply);
  return reply;
}

async function computeAiReply(userMessage: string, context?: AiContext): Promise<string> {
  const safeMsg = (userMessage || '').trim();
  if (!safeMsg) {
    return 'Hello! How can I assist you with your grooming, hair styling, or orders today?';
  }

  const textLower = safeMsg.toLowerCase();

  // ── Detect Indian Language by Unicode Script Range ────────────────────────────
  // Each regex tests for presence of that script's Unicode block characters
  const hasDevanagari = /[\u0900-\u097F]/.test(safeMsg);      // Hindi, Marathi, Sanskrit, Nepali
  const hasBengali    = /[\u0980-\u09FF]/.test(safeMsg);      // Bengali, Assamese
  const hasGurmukhi   = /[\u0A00-\u0A7F]/.test(safeMsg);      // Punjabi
  const hasGujarati   = /[\u0A80-\u0AFF]/.test(safeMsg);      // Gujarati
  const hasOdia       = /[\u0B00-\u0B7F]/.test(safeMsg);      // Odia
  const hasTamil      = /[\u0B80-\u0BFF]/.test(safeMsg);      // Tamil
  const hasTelugu     = /[\u0C00-\u0C7F]/.test(safeMsg);      // Telugu
  const hasKannada    = /[\u0C80-\u0CFF]/.test(safeMsg);      // Kannada
  const hasMalayalam  = /[\u0D00-\u0D7F]/.test(safeMsg);      // Malayalam
  const hasUrdu       = /[\u0600-\u06FF]/.test(safeMsg);      // Urdu, Arabic script

  const hasAnyIndianScript = hasDevanagari || hasBengali || hasGurmukhi || hasGujarati ||
    hasOdia || hasTamil || hasTelugu || hasKannada || hasMalayalam || hasUrdu;

  // ── Detect Hinglish (Hindi words written in Latin/English alphabet) ───────────
  // CRITICAL: Never include real English words here. The previous list contained
  // "the", so almost every English sentence ("What is the best haircut?") was
  // misclassified as Hinglish and answered in Hindi. Only unambiguous Hindi
  // romanized tokens belong in this detector, and they use strict word
  // boundaries (\b...\b) so English substrings like "hair", "chair", "air" never
  // match.
  const isHinglish = !hasAnyIndianScript && /\b(namaste|namaskar|namste|kaise|kaisa|kese|kesa|mujhe|mera|meri|mere|tum|tumhara|tumhari|aap|aapka|aapke|aapki|kuch|chahiye|dikhao|dikha|batao|bataiye|hoga|hogi|honge|hona|hai|hain|hume|humko|kaal|parson|shaadi|shadi|dost|yaar|accha|acha|achha|bohot|bahut|kitna|kitne|kitni|karo|kare|karna|karein|kardo|krdo|raha|rahi|rahe|kya|kyun|kyu|kab|kahan|kaha|kaun|kon|wala|wali|wale|bhi|thoda|thodi|zyada|jyada|sabse|bata|bhejo|shuru|karega|karegi|milta|milega|badhiya|theek|thik|bhai|bhaiya|paas|ke liye|laro|dekha|dekho|karvaana|kitneka)\b/i.test(safeMsg);

  // Exact detected language
  let detectedLang: string;
  if (hasTamil) detectedLang = 'tamil';
  else if (hasTelugu) detectedLang = 'telugu';
  else if (hasKannada) detectedLang = 'kannada';
  else if (hasMalayalam) detectedLang = 'malayalam';
  else if (hasGujarati) detectedLang = 'gujarati';
  else if (hasGurmukhi) detectedLang = 'punjabi';
  else if (hasOdia) detectedLang = 'odia';
  else if (hasBengali) detectedLang = 'bengali';
  else if (hasUrdu) detectedLang = 'urdu';
  else if (hasDevanagari) detectedLang = 'hindi';
  else if (isHinglish) detectedLang = 'hinglish';
  else detectedLang = 'english';

  const isHindiOrHinglish = hasDevanagari || isHinglish;

  // Detect event / occasion context (multilingual)
  const isEventOccasionQuery =
    /\b(shaadi|shadi|wedding|function|party|reception|engagement|sangeet|mehndi|interview|event|occasion|vivah|kalyanam|thirumanam|pelli|maduve|biye|lagna|viah)\b/i.test(safeMsg) ||
    /ready hona|taiyar|tayar/i.test(safeMsg) ||
    /திருமணம்|கல்யாணம்/.test(safeMsg) ||   // Tamil
    /పెళ్ళి|వివాహం/.test(safeMsg) ||         // Telugu
    /ಮದುವೆ|ವಿವಾಹ/.test(safeMsg) ||          // Kannada
    /കല്യാണം|വിവാഹം/.test(safeMsg) ||        // Malayalam
    /বিয়ে|বিবাহ/.test(safeMsg) ||            // Bengali
    /લગ્ન|વિવાહ/.test(safeMsg) ||            // Gujarati
    /ਵਿਆਹ|ਸ਼ਾਦੀ/.test(safeMsg);              // Punjabi

  // Pure greeting (no embedded request)
  const isGreetingQuery =
    (/^\s*(namaste|namaskar|namste|hi|hello|hey|vanakkam|nomoshkar|sat sri akal|kem cho|good morning|good afternoon|good evening)\b/i.test(safeMsg) ||
     /\b(kaise ho|kesa ho|kese ho|kaisa hai|kya haal|how are you|ki haal)\b/i.test(safeMsg) ||
     /^(வணக்கம்|நமஸ்கார|నమస్కారం|హలో|ನಮಸ್ಕಾರ|ಹಲೋ|নমস্কার|হ্যালো|નમસ્તે|હેલો|ਸਤ ਸ੍ਰੀ ਅਕਾਲ|ਹੈਲੋ)/.test(safeMsg)
    ) &&
    !/\b(recommend|chahiye|dikha|dikhao|shaadi|shadi|wedding|ready|product|suggest|serum|oil|haircut|price|book|order)\b/i.test(safeMsg);

  // ── Build Live Context String ────────────────────────────────────────────────
  const contextLines: string[] = [];
  // Personal identifiers and order details stay in the application. Operational
  // intents are resolved before this generic advice call reaches an LLM.
  if (context?.inStockProducts && context.inStockProducts.length > 0) {
    const prods = context.inStockProducts.slice(0, 6).map((p) => `${p.name} (₹${p.price.toFixed(0)})`).join(', ');
    contextLines.push(`IN-STOCK SALON CATALOG: ${prods}`);
  }
  if (context?.stylists && context.stylists.length > 0) {
    const st = context.stylists.map((s) => `${s.name} (${s.role}, ★${s.rating})`).join(', ');
    contextLines.push(`RESIDENT MASTER BARBERS: ${st}`);
  }

  // ── System Prompt ────────────────────────────────────────────────────────────
  // Tell the LLM exactly which language was detected
  const langInstruction = hasAnyIndianScript
    ? `DETECTED USER LANGUAGE: ${detectedLang.toUpperCase()} (Native Script). You MUST reply STRICTLY in ${detectedLang} using its native script. Do NOT switch to Hindi or English.`
    : detectedLang === 'hinglish'
    ? `DETECTED USER LANGUAGE: HINGLISH (Hindi written in Roman/Latin script). The user asked in Hinglish. You MUST reply in warm, modern Hinglish (Hindi conversational vocabulary in English letters, e.g. 'Aapke liye hamara Hair Serum best rahega...').`
    : `DETECTED USER LANGUAGE: PURE ENGLISH.
CRITICAL MANDATORY INSTRUCTION:
The user asked their question in pure English. You MUST reply in 100% fluent, elegant, and professional English.
ABSOLUTE PROHIBITION: DO NOT use ANY Hindi or Hinglish words (never say 'Aapke', 'hai', 'hain', 'mein', 'acha', 'shadi', 'batao', 'chahiye', etc.). Every single word must be in standard English.`;

  const systemPrompt = `You are Urban AI, the master barber & luxury grooming concierge for Urban Blade luxury salon, Sector 63, Noida (open 7 AM–11 PM daily, call: +91 90156 18265).

${langInstruction}

CRITICAL LANGUAGE MATCHING RULE — 100% STRICT & NON-NEGOTIABLE:
1. When user asks in English → Reply 100% in natural, fluent English. NEVER use Hinglish or Hindi words for an English query.
2. When user asks in Hinglish (Hindi in Roman script) → Reply in warm Hinglish.
3. When user asks in a regional language (Tamil, Telugu, Bengali, Devanagari Hindi, etc.) → Reply in that exact language and script.
Always match the user's chosen language with zero exceptions.

RULES:
1. GREETING ONLY: If message is ONLY a greeting (no request), respond warmly and briefly. NO product dumps.
2. UNDERSTAND INTENT:
   - Wedding/event/function in ANY language → recommend COMPLETE grooming package
   - "show me / suggest / recommend" in any language → give relevant products
   - Hair/beard/face query → recommend matching products
   - Greetings (vanakkam, nomoshkar, sat sri akal, kem cho, namaskar, etc.) → warm reply only
3. OCCASION GROOMING PACKAGE (for ANY wedding/party/event word in any language):
   - ✂️ Men's Precision Haircut ₹249
   - 🪒 Beard Sculpting + Hot Towel ₹199
   - ✨ Signature Men's SPA ₹1499 (face + hair, 90 min)
   - 🧴 Charcoal Face Wash ₹349 (pre-event glow)
   - 💧 Hair Serum ₹899 (anti-frizz shine all night)
   - Book with Vikram Sharma ★4.95 — +91 90156 18265
4. PRODUCT CATALOG:
   - Face: Charcoal Face Wash ₹349, De-Tan Kit ₹899, SPA ₹1499
   - Hair: Hair Oil ₹799, Shampoo ₹449, Hair Serum ₹899
   - Beard: Beard Oil ₹449, Beard Brush ₹449, Sculpting ₹199
   - Studio: Haircut ₹249, Master Cut (Vikram Sharma) ₹499
5. LENGTH: 80–130 words max. Warm, specific, actionable. Use the user's exact language script.
${contextLines.length > 0 ? '\nLIVE CONTEXT:\n' + contextLines.join('\n') : ''}`;

  // Language primer: inject a prior assistant turn in the user's script to strongly force reply language
  const langPrimers: Record<string, string> = {
    tamil:     'நான் தமிழில் பதில் சொல்கிறேன். (I will reply in Tamil.)',
    telugu:    'నేను తెలుగులో సమాధానం ఇస్తాను. (I will reply in Telugu.)',
    kannada:   'ನಾನು ಕನ್ನಡದಲ್ಲಿ ಉತ್ತರಿಸುತ್ತೇನೆ. (I will reply in Kannada.)',
    malayalam: 'ഞാൻ മലയാളത്തിൽ മറുപടി നൽകും. (I will reply in Malayalam.)',
    bengali:   'আমি বাংলায় উত্তর দেব। (I will reply in Bengali.)',
    gujarati:  'હું ગુજરાતીમાં જવાબ આપીશ. (I will reply in Gujarati.)',
    punjabi:   'ਮੈਂ ਪੰਜਾਬੀ ਵਿੱਚ ਜਵਾਬ ਦੇਵਾਂਗਾ। (I will reply in Punjabi.)',
    urdu:      'میں اردو میں جواب دوں گا۔ (I will reply in Urdu.)',
    hindi:     'मैं हिंदी में उत्तर दूँगा। (I will reply in Hindi.)',
  };

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Insert language primer for non-English/Hinglish scripts
  if (hasAnyIndianScript && langPrimers[detectedLang]) {
    messages.push({ role: 'assistant', content: langPrimers[detectedLang] });
  }

  // Replay recent conversation turns so follow-ups ("and for my beard?") keep
  // context. Cap at the last 6 messages and truncate each to bound token cost.
  if (context?.history && context.history.length > 0) {
    for (const turn of context.history.slice(-6)) {
      if (!turn || typeof turn.text !== 'string' || !turn.text.trim()) continue;
      const role = turn.sender === 'user' ? 'user' : 'assistant';
      messages.push({ role, content: turn.text.trim().slice(0, 500) });
    }
  }

  messages.push({ role: 'user', content: safeMsg });

  // ─── CONFIGURED ONLINE MODEL ─────────────────────────────────────────────────
  // NOTE: Skip LLM for native Indian scripts (Tamil, Telugu, Kannada, Malayalam,
  // Bengali, Gujarati, Punjabi, Odia, Urdu) — the NVIDIA Llama model unreliably
  // replies in Hindi/English for these scripts. Tier-3 has accurate translations.
  if (!hasAnyIndianScript) {
    const llmReply = await callConfiguredLlm(messages);
    if (llmReply) {
      if (detectedLang === 'english') {
        // Strict guard: verify LLM did NOT mistakenly generate Hinglish for an English query
        const isMistakenHinglish = /\b(aapke|aapka|aapki|aap|mein|hain|hai|acha|accha|bohot|bahut|chahiye|batao|karein|hoga|kuch|liye)\b/i.test(llmReply);
        if (!isMistakenHinglish) {
          return llmReply;
        }
        console.warn('[Online AI] LLM mistakenly generated Hinglish for an English query. Falling back to clean Tier-3 English synthesizer.');
      } else {
        return llmReply;
      }
    }
  }

  // ─── TIER 3: MULTILINGUAL RULE-BASED SYNTHESIZER (INSTANT, ALWAYS CORRECT) ───




  const isFaceQuery =
    textLower.includes('face') || textLower.includes('skin') || textLower.includes('chehra') ||
    textLower.includes('chehre') || textLower.includes('glow') || textLower.includes('tan') ||
    textLower.includes('detan') || textLower.includes('acne') || textLower.includes('pimple') ||
    textLower.includes('cleanser') || textLower.includes('wash') || textLower.includes('cream') ||
    textLower.includes('facial') || textLower.includes('scrub') || textLower.includes('d-tan') ||
    /முகம்|சருமம்/.test(safeMsg) ||   // Tamil
    /ముఖం|చర్మం/.test(safeMsg) ||      // Telugu
    /ಮುಖ|ಚರ್ಮ/.test(safeMsg) ||        // Kannada
    /മുഖം|ചർമ്മം/.test(safeMsg) ||      // Malayalam
    /মুখ|ত্বক/.test(safeMsg) ||         // Bengali
    /ચહેરો|ત્વચા/.test(safeMsg) ||      // Gujarati
    /ਚਿਹਰਾ|ਚਮੜੀ/.test(safeMsg);        // Punjabi

  const isHairQuery =
    textLower.includes('hair') || textLower.includes('baal') || textLower.includes('baalo') ||
    textLower.includes('baalon') || textLower.includes('shampoo') || textLower.includes('serum') ||
    textLower.includes('dandruff') || textLower.includes('thinning') || textLower.includes('scalp') ||
    textLower.includes('jhad') || textLower.includes('pomade') || textLower.includes('kesh') ||
    /முடி|தலைமுடி/.test(safeMsg) ||    // Tamil
    /జుట్టు|వెంట్రుక/.test(safeMsg) || // Telugu
    /ಕೂದಲು|ತಲೆ/.test(safeMsg) ||       // Kannada
    /മുടി|തലമുടി/.test(safeMsg) ||     // Malayalam
    /চুল|মাথার/.test(safeMsg) ||        // Bengali
    /વાળ|કેશ/.test(safeMsg) ||          // Gujarati
    /ਵਾਲ|ਕੇਸ/.test(safeMsg);            // Punjabi

  const isBeardQuery =
    textLower.includes('beard') || textLower.includes('daadi') || textLower.includes('dadi') ||
    textLower.includes('mustache') || textLower.includes('mooch') || textLower.includes('patchy') ||
    textLower.includes('stubble') || textLower.includes('shav') ||
    /தாடி/.test(safeMsg) ||             // Tamil
    /గడ్డం/.test(safeMsg) ||            // Telugu
    /ಗಡ್ಡ/.test(safeMsg) ||             // Kannada
    /താടി/.test(safeMsg) ||             // Malayalam
    /দাড়ি/.test(safeMsg) ||             // Bengali
    /દાઢી/.test(safeMsg) ||             // Gujarati
    /ਦਾੜ੍ਹੀ/.test(safeMsg);             // Punjabi

  const isBookingQuery =
    textLower.includes('book') || textLower.includes('appointment') || textLower.includes('haircut') ||
    textLower.includes('salon') || textLower.includes('chair') || textLower.includes('slot') ||
    textLower.includes('price') || textLower.includes('kitne') || textLower.includes('timings') ||
    textLower.includes('vikram') || textLower.includes('rohan');

  const isTrackingQuery =
    textLower.includes('order') || textLower.includes('track') || textLower.includes('where is') ||
    textLower.includes('delivery') || textLower.includes('package') || textLower.includes('kahan');

  // ── Multilingual Tier-3 response helper ──────────────────────────────────────
  const eventPkg = `• ✂️ **Men's Precision Haircut (₹249)**\n• 🪒 **Beard Sculpting + Hot Towel (₹199)**\n• ✨ **Signature Men's SPA (₹1499)**\n• 🧴 **Charcoal Face Wash (₹349)**\n• 💧 **Hair Serum (₹899)**\n📞 Vikram Sharma ★4.95 — +91 90156 18265`;


  const t3Event: Record<string, string> = {
    tamil:     `🎉 **திருமண/நிகழ்வு Grooming Package:**\n\nஉங்கள் சிறப்பு நாளுக்கு சிறந்தவராக தோற்றமளிக்க:\n\n${eventPkg}`,
    telugu:    `🎉 **పెళ్ళి/సందర్భం Grooming Package:**\n\nమీ ప్రత్యేక రోజుకు బెస్ట్ గా కనిపించండి:\n\n${eventPkg}`,
    kannada:   `🎉 **ಮದುವೆ/ಸಂದರ್ಭ Grooming Package:**\n\nನಿಮ್ಮ ವಿಶೇಷ ದಿನಕ್ಕೆ ಅತ್ಯುತ್ತಮವಾಗಿ ಕಾಣಿ:\n\n${eventPkg}`,
    malayalam: `🎉 **കല്യാണം/ചടങ്ങ് Grooming Package:**\n\nനിങ്ങളുടെ പ്രത്യേക ദിനത്തിൽ മികച്ചതായി കാണൂ:\n\n${eventPkg}`,
    bengali:   `🎉 **বিয়ে/অনুষ্ঠান Grooming Package:**\n\nআপনার বিশেষ দিনে সেরা দেখতে:\n\n${eventPkg}`,
    gujarati:  `🎉 **લગ્ન/સમારોહ Grooming Package:**\n\nતમારા વિશેષ દિવસ માટે શ્રેષ્ઠ દેખો:\n\n${eventPkg}`,
    punjabi:   `🎉 **ਵਿਆਹ/ਸਮਾਗਮ Grooming Package:**\n\nਆਪਣੇ ਖਾਸ ਦਿਨ ਤੇ ਸਭ ਤੋਂ ਵਧੀਆ ਦਿਖੋ:\n\n${eventPkg}`,
    urdu:      `🎉 **شادی/تقریب Grooming Package:**\n\nاپنے خاص دن کے لیے بہترین نظر آئیں:\n\n${eventPkg}`,
    hindi:     `🎉 **शादी/उत्सव के लिए Complete Grooming:**\n\nअपने खास दिन पर सबसे बेहतरीन दिखें:\n\n${eventPkg}`,
    hinglish:  `🎉 **Shaadi/Event ke liye Complete Grooming Package:**\n\nKoi tension nahi! Urban Blade ke saath aap sabse handsome dikhenge:\n\n${eventPkg}`,
    default:   `🎉 **Complete Wedding/Event Grooming Package:**\n\nLook your absolute best!\n\n${eventPkg}`,
  };

  const t3Greeting: Record<string, string[]> = {
    tamil:     [`வணக்கம்! நான் Urban Blade-இன் AI concierge. உங்கள் hair, beard, skincare அல்லது salon booking-ல் உதவட்டுமா? 😊`],
    telugu:    [`నమస్కారం! నేను Urban Blade AI concierge. మీ hair, beard, skincare లేదా salon booking లో సహాయం చేయనా? 😊`],
    kannada:   [`ನಮಸ್ಕಾರ! ನಾನು Urban Blade AI concierge. ನಿಮ್ಮ hair, beard, skincare અથવા salon booking-ಲ್ಲಿ ಸಹಾಯ ಮಾಡಲಾ? 😊`],
    malayalam: [`നമസ്കാരം! ഞാൻ Urban Blade AI concierge ആണ്. Hair, beard, skincare അല്ലെങ്കിൽ salon booking-ൽ സഹായിക്കട്ടെ? 😊`],
    bengali:   [`নমস্কার! আমি Urban Blade AI concierge। আপনার hair, beard, skincare বা salon booking-এ সাহায্য করতে পারি? 😊`],
    gujarati:  [`નમસ્તે! હું Urban Blade AI concierge છું. તમારા hair, beard, skincare અથવા salon booking-માં મદદ કરું? 😊`],
    punjabi:   [`ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ Urban Blade AI concierge ਹਾਂ। ਤੁਹਾਡੇ hair, beard, skincare ਜਾਂ salon booking ਵਿੱਚ ਮਦਦ ਕਰਾਂ? 😊`],
    urdu:      [`سلام! میں Urban Blade AI concierge ہوں۔ آپ کے hair, beard, skincare یا salon booking میں مدد کروں؟ 😊`],
    hindi:     [`नमस्ते! मैं Urban Blade AI concierge हूँ। आपके hair, beard, skincare या salon booking में मदद करूँ? 😊`],
    hinglish: [
      `Namaste! Main bilkul badhiya hoon! 😊 Urban Blade mein aapka swagat hai. Hair care, beard, skincare ya salon chair booking — kya madad kar sakta hoon?`,
      `Hello bhai! 🙏 Urban Blade mein swagat hai. Aaj kya karein — haircut, beard sculpting, ya koi grooming product dekhna hai?`,
      `Arre hi! 👋 Main aapka grooming concierge hoon. Batao, hair, beard ya skin care mein kya chahiye?`,
    ],
    default: [
      `Hello! Welcome to Urban Blade! I can help with grooming advice, products, or booking a barber chair. What can I do for you today?`,
      `Hi there! 👋 Ready to look sharp? I can help with haircuts, beard care, skincare, or tracking your order. What's up?`,
      `Hey! Great to see you at Urban Blade. Whether it's a fresh cut, a product recommendation, or an appointment — I'm here. What can I do?`,
    ],
  };

  // NOTE: each value is an ARRAY of variants so the fallback does not repeat the
  // same canned text for every question (see pickVariant). Native-script entries
  // keep a single variant; hinglish/default get several for real variety.
  const t3Generic: Record<string, string[]> = {
    tamil:     [`✨ **Urban Blade Concierge:**\n\n• 💇 Haircut book செய்யுங்கள் — ₹249 முதல்\n• 🧴 Grooming products — Hair, beard, face\n• 📦 Order track செய்யுங்கள்\n• 🎉 திருமண grooming package\n\nஒரு நிமிடம் சொல்லுங்கள்! 💪`],
    telugu:    [`✨ **Urban Blade Concierge:**\n\n• 💇 Haircut book చేయండి — ₹249 నుండి\n• 🧴 Grooming products — Hair, beard, face\n• 📦 Order track చేయండి\n• 🎉 పెళ్ళి grooming package\n\nచెప్పండి, నేను ఇక్కడ ఉన్నాను! 💪`],
    kannada:   [`✨ **Urban Blade Concierge:**\n\n• 💇 Haircut book ಮಾಡಿ — ₹249 ರಿಂದ\n• 🧴 Grooming products — Hair, beard, face\n• 📦 Order track ಮಾಡಿ\n• 🎉 ಮದುವೆ grooming package\n\nಹೇಳಿ, ನಾನು ಇಲ್ಲಿದ್ದೇನೆ! 💪`],
    malayalam: [`✨ **Urban Blade Concierge:**\n\n• 💇 Haircut book ചെയ്യൂ — ₹249 മുതൽ\n• 🧴 Grooming products — Hair, beard, face\n• 📦 Order track ചെയ്യൂ\n• 🎉 കല്യാണ grooming package\n\nപറയൂ, ഞാൻ ഇവിടെ ഉണ്ട്! 💪`],
    bengali:   [`✨ **Urban Blade Concierge:**\n\n• 💇 Haircut book করুন — ₹249 থেকে\n• 🧴 Grooming products — Hair, beard, face\n• 📦 Order track করুন\n• 🎉 বিয়ের grooming package\n\nবলুন, আমি এখানে আছি! 💪`],
    gujarati:  [`✨ **Urban Blade Concierge:**\n\n• 💇 Haircut book કરો — ₹249 થી\n• 🧴 Grooming products — Hair, beard, face\n• 📦 Order track કરો\n• 🎉 લગ્ન grooming package\n\nકહો, હું અહીં છું! 💪`],
    punjabi:   [`✨ **Urban Blade Concierge:**\n\n• 💇 Haircut book ਕਰੋ — ₹249 ਤੋਂ\n• 🧴 Grooming products — Hair, beard, face\n• 📦 Order track ਕਰੋ\n• 🎉 ਵਿਆਹ grooming package\n\nਦੱਸੋ, ਮੈਂ ਇੱਥੇ ਹਾਂ! 💪`],
    urdu:      [`✨ **Urban Blade Concierge:**\n\n• 💇 Haircut book کریں — ₹249 سے\n• 🧴 Grooming products\n• 📦 Order track کریں\n• 🎉 شادی grooming package\n\nبتائیں، میں یہاں ہوں! 💪`],
    hindi:     [`✨ **Urban Blade Concierge — बताइए क्या चाहिए!**\n\n• 💇 Haircut book करें — ₹249 से\n• 🧴 Grooming products — Hair, beard, face\n• 📦 Order track करें\n• 🎉 शादी/Event grooming package\n\nबस बताएं! 💪`],
    hinglish: [
      `✨ **Urban Blade Concierge — Batao Kya Chahiye!**\n\n• 💇 Haircut book karein — ₹249 se\n• 🧴 Grooming products — Hair, beard, face\n• 📦 Order track karein\n• 🎉 Event/Party grooming package\n\nBas batao, main yahan hoon! 💪`,
      `Bataiye bhai, main kaise madad kar sakta hoon? 😊\n\n• 💇 **Haircut / Beard Sculpt** — ₹199 se shuru\n• 🧴 **Hair, beard & skin care** — premium products\n• 📦 **Order tracking** — live status\n• 🎉 **Shaadi/Event package** — full grooming\n\nKuch bhi poochho!`,
      `Arre, main sunn raha hoon! 🎧\n\nUrban Blade mein aapke liye:\n• ✂️ Master barber cut — Vikram Sharma ★4.95\n• 🧔 Beard oil, wash aur styling\n• 💧 Charcoal face wash, de-tan, SPA\n• 📦 Apne order ki live tracking\n\nBolo, kya dekhna hai?`,
      `Main aapki grooming assistant hoon! 💈\n\nAaj kya try karein?\n• 💇 Precision haircut — ₹249\n• 🧔 Beard sculpting — ₹199\n• ✨ Signature men's SPA — ₹1499\n• 📦 Order status check\n\nEk line mein bata do!`,
      `Haan bolo, kya soch rahe ho? 🤔\n\nMain help kar sakta hoon:\n• 🪒 Chair booking aur slot selection\n• 🧴 Hair fall, beard ya skin care products\n• 💈 Master barber se appointment\n• 📦 Order kahan pahuncha — live update\n\nJo chahiye wo poocho!`,
      `Aapka swagat hai Urban Blade mein! 🙌\n\nYahan kya milta hai:\n• ✂️ Precision cut & hot-towel shave\n• 🧔 Beard sculpting aur oil care\n• ✨ Charcoal detox, de-tan, SPA\n• 🎉 Shaadi ke liye full package\n\nBataiye, kya explore karein?`,
      `Kya baat hai! 😄 Main yahin hoon.\n\nAapke liye ready options:\n• 💇 Fresh haircut — ₹249\n• 🧔 Beard trim & sculpt — ₹199\n• 💧 Face wash / de-tan / facial\n• 📦 Order track karna ho to bolo\n\nChaliye shuru karein!`,
      `Bilkul, suniye! 👂\n\nUrban Blade concierge aapki seva mein:\n• ✂️ Vikram Sharma (Master Barber) se cut\n• 🧴 Premium hair & beard products\n• 💈 Studio visit — Sector 63, Noida\n• 📦 Live order status\n\nAap batao, kaam kya hai?`,
    ],
    default: [
      `✨ **Urban Blade Master Concierge:**\n\n• 💇 **Book a Haircut** — from ₹249\n• 🧴 **Grooming Products** — Hair, beard & skincare\n• 📦 **Track Your Order** — Live logistics\n• 🎉 **Event Grooming** — Full package\n\nWhat would you like today?`,
      `Hey! I'm your Urban Blade grooming concierge. 💈\n\nHere's what I can do for you:\n• ✂️ Reserve a master barber chair\n• 🧔 Beard & hair care recommendations\n• ✨ Facials, de-tan and spa treatments\n• 📦 Live order tracking\n\nJust tell me what you need!`,
      `Great to see you! What are we doing today? 😊\n\n• 💇 Fresh haircut or beard sculpt — from ₹199\n• 🧴 Premium grooming products in stock\n• 📦 Check where your order is\n• 🎉 Getting ready for an event?\n\nAsk me anything!`,
    ],
  };

  const lang = (detectedLang in t3Event) ? detectedLang : 'default';

  // 🎉 Event/Occasion handler
  if (isEventOccasionQuery) return t3Event[lang] || t3Event['default'];

  // Booking / Studio queries (checked before general hair keywords)
  if (isBookingQuery) {
    const bookMsg: Record<string, string> = {
      tamil:     `✂️ **Urban Blade Studio:**\n\nSector 63, Noida (காலை 7 - இரவு 11):\n\n• Men's Haircut — ₹249\n• Beard Sculpting — ₹199\n• Master Cut (Vikram ★4.95) — ₹499\n\nBook: +91 90156 18265`,
      telugu:    `✂️ **Urban Blade Studio:**\n\nSector 63, Noida (ఉ. 7 - రా. 11):\n\n• Men's Haircut — ₹249\n• Beard Sculpting — ₹199\n• Master Cut (Vikram ★4.95) — ₹499\n\nBook: +91 90156 18265`,
      hinglish:  `✂️ **Urban Blade Studio — Chair Book Karein:**\n\nSector 63 Noida (7 AM–11 PM):\n\n• Men's Haircut — ₹249\n• Beard Sculpting — ₹199\n• Master Cut (Vikram ★4.95) — ₹499\n\nCall: +91 90156 18265`,
      default:   `✂️ **Urban Blade Studio — Reserve Your Chair:**\n\nSector 63, Noida (7 AM–11 PM daily):\n\n• Men's Precision Haircut — ₹249\n• Beard Sculpting + Hot Towel — ₹199\n• Master Cut (Vikram Sharma ★4.95) — ₹499\n\nCall +91 90156 18265!`,
    };
    return (bookMsg[lang] || bookMsg['default']);
  }

  if (isFaceQuery) {
    const faceMsg: Record<string, string> = {
      tamil:     `✨ **முகம் & சரும பராமரிப்பு:**\n\n• **Charcoal Face Wash (₹349)** — ஆழமான சுத்தம்\n• **De-Tan Kit (₹899)** — சன் டான் நீக்கம்\n• **Men's SPA (₹1499)** — 90-நிமிட facial\n\nகார்டில் சேர்க்கவும்!`,
      telugu:    `✨ **ముఖం & చర్మ సంరక్షణ:**\n\n• **Charcoal Face Wash (₹349)** — డీప్ క్లీన్\n• **De-Tan Kit (₹899)** — సన్ టాన్ రిమూవల్\n• **Men's SPA (₹1499)** — 90-నిమిష facial\n\nకార్ట్ కి జోడించండి!`,
      kannada:   `✨ **ಮುಖ & ಚರ್ಮ ಆರೈಕೆ:**\n\n• **Charcoal Face Wash (₹349)** — ಆಳವಾದ ಶುದ್ಧೀಕರಣ\n• **De-Tan Kit (₹899)** — ಸನ್ ಟ್ಯಾನ್ ತೆಗೆದುಹಾಕಿ\n• **Men's SPA (₹1499)** — 90-ನಿಮಿಷ facial\n\nಕಾರ್ಟ್ ಗೆ ಸೇರಿಸಿ!`,
      malayalam: `✨ **മുഖം & ചർമ്മ പരിചരണം:**\n\n• **Charcoal Face Wash (₹349)** — ആഴത്തിലുള്ള ശുദ്ധീകരണം\n• **De-Tan Kit (₹899)** — സൺ ടான் നീക്കം\n• **Men's SPA (₹1499)** — 90-മിനിറ്റ് facial\n\nകാർട്ടിൽ ചേർക്കൂ!`,
      bengali:   `✨ **মুখ ও ত্বকের যত্ন:**\n\n• **Charcoal Face Wash (₹349)** — গভীর পরিষ্কার\n• **De-Tan Kit (₹899)** — সান ট্যান দূর\n• **Men's SPA (₹1499)** — ৯০-মিনিটের facial\n\nকার্টে যোগ করুন!`,
      hinglish:  `✨ **Urban Blade Face & Skin Care:**\n\n• **Charcoal Face Wash (₹349)** — Deep pore cleansing\n• **De-Tan Kit (₹899)** — Sun-tan hatane ka 3-step sequence\n• **Men's SPA (₹1499)** — 90-min complete facial\n\nNiche cards se cart mein add karein!`,
      default:   `✨ **Urban Blade Face & Skin Care:**\n\n• **Charcoal Face Wash (₹349)** — Deep pore detox & oil control\n• **De-Tan Kit (₹899)** — 3-step salon sequence for sun damage\n• **Men's SPA (₹1499)** — Complete 90-min rejuvenating therapy\n\nTap below to add to cart!`,
    };
    return (faceMsg[lang] || faceMsg['default']);
  }

  if (isHairQuery) {
    const hairProducts = (context?.inStockProducts || [])
      .filter((p) => p.category === 'hair' || p.name.toLowerCase().includes('hair') || p.name.toLowerCase().includes('shampoo'))
      .slice(0, 3);
    const prodList = hairProducts.length > 0
      ? hairProducts.map((p) => `• **${p.name}** (₹${p.price.toFixed(0)})`).join('\n')
      : `• **Hair Oil (₹799)**\n• **Shampoo (₹449)**\n• **Hair Serum (₹899)**`;
    const hairSuffix: Record<string, string> = {
      tamil: `\n\nமுடி உதிர்வு அல்லது styling பற்றி கேட்கலாம்!`,
      telugu: `\n\nజుట్టు రాలడం లేదా styling గురించి అడగండి!`,
      kannada: `\n\nಕೂದಲು ಉದುರುವಿಕೆ ಅಥವಾ styling ಬಗ್ಗೆ ಕೇಳಿ!`,
      malayalam: `\n\nമുടി കൊഴിക്കൽ അല്ലെങ്കിൽ styling ഇൽ ചോദ്യം ചോദിക്കൂ!`,
      bengali: `\n\nচুল পড়া বা styling সম্পর্কে জিজ্ঞেস করুন!`,
      hinglish: `\n\nHair fall ya daily styling ke liye suggest karoon? Batao!`,
      default: `\n\nLooking for hair growth care or daily styling? Let me know!`,
    };
    return `✨ **Urban Blade Hair Care:**\n\n${prodList}${hairSuffix[lang] || hairSuffix['default']}`;
  }

  if (isBeardQuery) {
    const beardMsg: Record<string, string> = {
      tamil:     `🧔 **தாடி பராமரிப்பு:**\n\n• **Beard Oil (₹449)** — வளர்ச்சி & itch நீக்கம்\n• **Beard Brush (₹449)** — வடிவமைப்பு\n• **Beard Sculpting (₹199)** — Studio treatment\n\nPatchy beard fix பண்ணணுமா?`,
      telugu:    `🧔 **గడ్డం సంరక్షణ:**\n\n• **Beard Oil (₹449)** — పెరుగుదల & itch నివారణ\n• **Beard Brush (₹449)** — styling\n• **Beard Sculpting (₹199)** — Studio treatment\n\nPatchy beard fix చేయాలా?`,
      hinglish:  `🧔 **Urban Blade Beard Care:**\n\n• **Beard Oil (₹449)** — Follicles nourish, itch door\n• **Beard Brush (₹449)** — Shape aur direction deta hai\n• **Beard Sculpting (₹199)** — Hot towel + razor detailing\n\nPatchiness fix karni hai ya beard style karni hai?`,
      default:   `🧔 **Urban Blade Beard Care:**\n\n• **Beard Oil (₹449)** — Nourishes follicles, eliminates itch\n• **Beard Brush (₹449)** — Trains growth, distributes oils\n• **Beard Sculpting (₹199)** — Hot steam towel + straight-razor\n\nWorking on patchiness or styling?`,
    };
    return (beardMsg[lang] || beardMsg['default']);
  }

  if (isTrackingQuery && context?.orderSummary) {
    return `📦 **Live Order Tracking:**\n\n${context.orderSummary}\n\nYour package is real-time tracked. Open the tracking card!`;
  }

  if (isGreetingQuery) return pickVariant(t3Greeting[lang] || t3Greeting['default'], textLower);

  // Generic fallback — rotate through variants so repeated generic questions
  // don't always get the identical canned reply.
  const genericVariants = t3Generic[lang] || t3Generic['default'];
  return pickVariant(genericVariants, textLower);
}
