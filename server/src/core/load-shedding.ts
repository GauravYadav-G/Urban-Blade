import type { FastifyRequest, FastifyReply } from 'fastify';

export async function pressureResponse(req: FastifyRequest, reply: FastifyReply, type: string, value?: number) {
  const path = req.url.split('?')[0];
  if (path === '/' || path === '/api/health' || path.startsWith('/api/health/')) return;
  req.log.warn({type, value}, 'System under pressure; shedding load');
  reply.code(503).header('Retry-After', 2);
  // Await the reply so the plugin cannot continue while async onSend hooks
  // are still running and reply.sent is not set yet.
  await reply.send({error: 'SERVICE_UNDER_PRESSURE', message: 'The service is busy. Please retry in a moment.'});
}
