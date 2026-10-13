// Verify: (1) different generic questions get different fallback replies,
// (2) the SAME question is stable across calls, (3) same question under the
// live LLM is stable via cache. Run: npx tsx scripts/verify-ai-variety.ts
import { config } from 'dotenv';
config();
const LLM = process.env.NO_LLM !== '1';
if (!LLM) delete process.env.NVIDIA_API_KEY;
import { askOnlineAi } from '../src/core/online-ai.service.js';

const questions = [
  'mujhe shampoo chahiye',
  'beard ke liye kya karun',
  'aaj mausam accha hai',
  'aapka studio kahan hai',
  'thanks bhai',
  'kya suggestions hai',
  'kuch batao',
  'hello',
  'namaste',
  'kaise ho',
];

// 1. Variety: distinct questions → distinct replies.
const first = new Map<string, string>();
for (const q of questions) first.set(q, (await askOnlineAi(q)).trim());
const uniqueReplies = new Set(first.values());

// 2. Stability: same question → same reply on repeat.
let stable = true;
for (const q of questions) {
  const again = (await askOnlineAi(q)).trim();
  if (again !== first.get(q)) { stable = false; console.log(`❌ unstable: "${q}"`); }
}

console.log(`\nLLM ${LLM ? 'ON' : 'OFF (Tier-3)'}`);
console.log(`${questions.length} questions → ${uniqueReplies.size} unique replies`);
console.log(`Same-question stability: ${stable ? '✅ stable' : '❌ unstable'}`);

const ok = uniqueReplies.size >= questions.length * 0.7 && stable;
console.log(ok ? '\n🎉 VARIETY + STABILITY VERIFIED' : '\n⚠️ CHECK FAILED');
process.exit(ok ? 0 : 1);
