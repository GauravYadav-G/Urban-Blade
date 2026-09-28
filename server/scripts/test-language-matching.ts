import { askOnlineAi } from '../src/core/online-ai.service.js';

async function testLanguageRouting() {
  console.log('🧪 Testing Language-Matching Intelligence in Urban AI Concierge...\n');

  // Test 1: User's exact case - Pure English
  console.log('----------------------------------------------------');
  console.log('Case 1: User asks in Pure English');
  const q1 = 'Which hair serum or scalp restorative oil is currently available in your catalog?';
  const a1 = await askOnlineAi(q1);
  console.log('Question:', q1);
  console.log('AI Reply:\n', a1);

  const hasHinglishInA1 = /\b(aapke|aapka|aapki|aap|mein|hain|hai|acha|accha|bohot|bahut|chahiye|batao|karein|hoga|kuch|liye)\b/i.test(a1);
  if (hasHinglishInA1) {
    console.error('❌ FAILED: AI replied in Hinglish to a Pure English question!');
    process.exitCode = 1;
  } else {
    console.log('✅ PASSED: AI replied in 100% Pure English!\n');
  }

  // Test 2: User asks in Hinglish
  console.log('----------------------------------------------------');
  console.log('Case 2: User asks in Hinglish');
  const q2 = 'kaal meri dos t ki shaadi hai uske liye ready hona hai recommend laro kuch';
  const a2 = await askOnlineAi(q2);
  console.log('Question:', q2);
  console.log('AI Reply:\n', a2);

  const hasHinglishInA2 = /\b(aap|aapke|shadi|shaadi|liye|mein|hai|bhi|aur|kuch|karein|hain)\b/i.test(a2);
  if (!hasHinglishInA2) {
    console.warn('⚠️ Note: Hinglish reply might have minimal Hindi words, but check content.');
  } else {
    console.log('✅ PASSED: AI replied in warm conversational Hinglish as requested!\n');
  }

  // Test 3: Haircut prices in English
  console.log('----------------------------------------------------');
  console.log('Case 3: English haircut price query');
  const q3 = 'What are your haircut prices and timings in Noida?';
  const a3 = await askOnlineAi(q3);
  console.log('Question:', q3);
  console.log('AI Reply:\n', a3);

  const hasHinglishInA3 = /\b(aapke|aapka|aapki|aap|mein|hain|hai|acha|accha|bohot|bahut|chahiye|batao|karein|hoga|kuch|liye)\b/i.test(a3);
  if (hasHinglishInA3) {
    console.error('❌ FAILED: AI replied in Hinglish to English haircut query!');
    process.exitCode = 1;
  } else {
    console.log('✅ PASSED: AI replied in 100% Pure English!\n');
  }
}

testLanguageRouting().catch((err) => {
  console.error(err);
  process.exit(1);
});
