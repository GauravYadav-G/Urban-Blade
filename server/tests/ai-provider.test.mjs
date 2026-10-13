import test from 'node:test';
import assert from 'node:assert/strict';
import { askOnlineAi, getAiProviderStatus } from '../dist/core/online-ai.service.js';

test('online concierge configuration, failures, recovery, grounding and cache isolation', async t => {
  const savedFetch = globalThis.fetch;
  const names = ['NVIDIA_API_KEY', 'NVIDIA_MODEL', 'AI_ALLOW_PUBLIC_FALLBACK'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => {
    globalThis.fetch = savedFetch;
    for (const name of names) saved[name] === undefined ? delete process.env[name] : process.env[name] = saved[name];
  });
  delete process.env.NVIDIA_API_KEY;
  process.env.AI_ALLOW_PUBLIC_FALLBACK = 'false';
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not call without key'); };
  const message = 'Recommend a haircut for an oval face recovery fixture';
  assert.ok((await askOnlineAi(message)).length > 10);
  assert.equal(calls, 0);
  assert.equal(getAiProviderStatus().lastAttempt.state, 'not_configured');

  process.env.NVIDIA_API_KEY = 'fake-test-key-never-a-real-secret';
  const success = text => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
  let body;
  globalThis.fetch = async (url, init) => { calls++; body = JSON.parse(init.body); return success('A textured haircut suits an oval face.'); };
  assert.equal(await askOnlineAi(message), 'A textured haircut suits an oval face.');
  assert.equal(getAiProviderStatus().lastAttempt.state, 'healthy');
  await askOnlineAi(message);
  assert.equal(calls, 1, 'successful generic reply is cached');
  assert.ok(!JSON.stringify(getAiProviderStatus()).includes(process.env.NVIDIA_API_KEY));

  for (const [status, state] of [[401, 'unauthorized'], [403, 'unauthorized'], [404, 'model_unavailable'], [410, 'model_unavailable'], [429, 'rate_limited'], [503, 'unavailable']]) {
    let attempts = 0;
    globalThis.fetch = async () => { attempts++; return new Response('{}', { status }); };
    assert.ok((await askOnlineAi(`Haircut advice fixture ${status}`)).length > 10);
    assert.equal(attempts, 1, 'definitive HTTP errors are not retried');
    assert.equal(getAiProviderStatus().lastAttempt.state, state);
  }
  let retries = 0;
  globalThis.fetch = async () => { if (++retries === 1) throw new Error('transient network'); return success('Recovered after a transient network failure.'); };
  assert.equal(await askOnlineAi('Network recovery haircut fixture'), 'Recovered after a transient network failure.');
  assert.equal(retries, 2);

  calls = 0;
  globalThis.fetch = async (url, init) => { calls++; body = JSON.parse(init.body); return success(`Catalog response number ${calls}.`); };
  const context = { customerName: 'PRIVATE_NAME', customerEmail: 'PRIVATE_EMAIL', business: { name: 'Urban Blade', address: 'Actual studio address', hours: 'Actual hours', phone: 'Actual phone' }, inStockProducts: [{ id: 'one', name: 'Live product', price: 123 }] };
  await askOnlineAi('Catalog grounding fixture', context);
  assert.ok(body.messages[0].content.includes('Actual studio address'));
  assert.ok(body.messages[0].content.includes('Live product'));
  assert.ok(!JSON.stringify(body).includes('PRIVATE_'));
  await askOnlineAi('Catalog grounding fixture', { ...context, inStockProducts: [{ id: 'one', name: 'Live product', price: 456 }] });
  assert.equal(calls, 2, 'catalog changes invalidate cached advice');
  const history = { history: [{ sender: 'user', text: 'My earlier question' }] };
  await askOnlineAi('Conversation fixture', history);
  await askOnlineAi('Conversation fixture', history);
  assert.equal(calls, 4, 'conversation replies are never shared through cache');
  assert.equal(body.messages.at(-2).content, 'My earlier question');
  await askOnlineAi('தமிழில் முடி பராமரிப்பு');
  assert.equal(calls, 4, 'native script uses the documented local language fallback');
});
