// End-to-end test of the real askOnlineAi pipeline (detection -> live LLM ->
// Tier-3 fallback), proving language routing + API work through the actual
// service code. Run: npx tsx scripts/verify-ai-e2e.ts
import { config } from 'dotenv';
config();
import { askOnlineAi } from '../src/core/online-ai.service.js';

async function run(label: string, msg: string, ctx?: any) {
  const t = Date.now();
  const reply = await askOnlineAi(msg, ctx);
  const ms = Date.now() - t;
  console.log(`\n━━━ ${label} (${ms}ms) ━━━`);
  console.log(`Q: ${msg}`);
  console.log(`A: ${reply.replace(/\n/g, ' ').slice(0, 240)}`);
  return reply;
}

// 1. Pure English — must reply in English, never Hinglish.
const a1 = await run('ENGLISH', 'What is the best haircut for a round face?');
// 2. Hinglish — must reply in Hinglish.
const a2 = await run('HINGLISH', 'mujhe hair fall kam karne ke liye kya karuna chahiye?');
// 3. Native Tamil script — Tier-3 accurate translation path (LLM skipped).
const a3 = await run('TAMIL SCRIPT', 'முடி உதிர்வுக்கு என்ன தடவி?');
// 4. Multi-turn context — follow-up should stay on beard topic.
const a4 = await run('MULTI-TURN', 'aur mere beard ke liye?', {
  history: [
    { sender: 'user', text: 'mujhe hair fall ka ilaaj chahiye' },
    { sender: 'ai', text: 'Bhai, Biotique Bhringaraj Oil try karo, 2 hafte me farak dikhega.' },
  ],
});

// ── Assertions ──
const hinglishMarker = /\b(aapke|aapka|aap|mujhe|chahiye|karuna|karo|kare|hain|hai|batao|liye|kya)\b/i;
let ok = true;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) ok = false;
}
check('English reply is NOT Hinglish', !hinglishMarker.test(a1));
check('Hinglish reply IS Hinglish', hinglishMarker.test(a2));
check('Tamil reply contains Tamil script', /[\u0B80-\u0BFF]/.test(a3));
check('Multi-turn reply is non-trivial', a4.length > 10);

console.log(ok ? '\n🎉 AI PIPELINE VERIFIED' : '\n⚠️ PIPELINE HAS ISSUES');
process.exit(ok ? 0 : 1);
