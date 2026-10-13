import 'dotenv/config';

// Provider-only smoke test: no customer records, no database writes, no printed key.
async function main(): Promise<void> {
  const key = process.env.NVIDIA_API_KEY?.trim();
  if (!key) throw new Error('NVIDIA_API_KEY is missing from this server environment.');
  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model: process.env.NVIDIA_MODEL || 'meta/llama-3.2-11b-vision-instruct',
      messages: [{ role: 'user', content: 'Reply with the single word READY.' }],
      max_tokens: 8, temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`NVIDIA provider returned HTTP ${response.status}. Check the server key, model access, and quota.`);
  const data: unknown = await response.json();
  const { z } = await import('zod');
  const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1) }).parse(data);
  if (!parsed.choices[0].message.content.trim()) throw new Error('Provider returned an empty response.');
  console.log('PASS: configured NVIDIA provider returned an online response. No fallback or database was used.');
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Provider verification failed.');
  process.exitCode = 1;
});
