// Standalone verification of the Hinglish detector regex fix.
// Run: node scripts/verify-hinglish-detector.mjs
const re = /\b(namaste|namaskar|namste|kaise|kaisa|kese|kesa|mujhe|mera|meri|mere|tum|tumhara|tumhari|aap|aapka|aapke|aapki|kuch|chahiye|dikhao|dikha|batao|bataiye|hoga|hogi|honge|hona|hai|hain|hume|humko|kaal|parson|shaadi|shadi|dost|yaar|accha|acha|achha|bohot|bahut|kitna|kitne|kitni|karo|kare|karna|karein|kardo|krdo|raha|rahi|rahe|kya|kyun|kyu|kab|kahan|kaha|kaun|kon|wala|wali|wale|bhi|thoda|thodi|zyada|jyada|sabse|bata|bhejo|shuru|karega|karegi|milta|milega|badhiya|theek|thik|bhai|bhaiya|paas|ke liye|laro|dekha|dekho|karvaana|kitneka)\b/i;

const english = [
  'What is the best haircut for me?',
  'Where is the studio?',
  'I want the hair serum',
  'Do you have the shampoo',
  'Give me the price list',
  'The package is late',
  'Which hair serum is available?',
  'What are your haircut prices?',
  'Can you recommend a haircut for an oval face?',
];

const hinglish = [
  'kaal meri dos t ki shaadi hai uske liye ready hona hai recommend laro kuch',
  'mujhe hair fall ka ilaaj chahiye',
  'aapke paas beard oil hai kya',
  'namaste mujhe shampoo chahiye',
  'kitne ka hai haircut',
];

let ok = true;
console.log('== ENGLISH (expect: NOT hinglish) ==');
for (const q of english) {
  const r = re.test(q);
  if (r) ok = false;
  console.log(`${r ? 'FAIL' : 'pass'} | ${q}`);
}
console.log('== HINGLISH (expect: hinglish) ==');
for (const q of hinglish) {
  const r = re.test(q);
  if (!r) ok = false;
  console.log(`${r ? 'pass' : 'FAIL'} | ${q}`);
}
console.log(ok ? '\n✅ ALL CORRECT — English never misdetected as Hinglish' : '\n❌ HAS FAILURES');
process.exit(ok ? 0 : 1);
