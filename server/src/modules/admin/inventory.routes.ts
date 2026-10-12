import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireStaff } from '../../core/auth.middleware.js';
import { withTransaction } from '../../db/pool.js';
import { invalidateCatalog } from '../../redis/cache.service.js';

export async function inventoryRoutes(app: FastifyInstance) {
  app.post<{ Params: { id:string } }>('/admin/inventory/:id/adjust', { preHandler:[requireStaff] }, async(request,reply)=>{
    const parsed=z.object({ delta:z.number().int().min(-100000).max(100000).refine(n=>n!==0), reason:z.string().trim().min(3).max(300), requestId:z.string().uuid() }).strict().safeParse(request.body);
    if(!parsed.success || !z.string().uuid().safeParse(request.params.id).success) return reply.code(400).send({error:'INVALID_ADJUSTMENT'});
    try {
      const product=await withTransaction(async client=>{
        const p=(await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[request.params.id])).rows[0];
        if(!p) throw new Error('PRODUCT_NOT_FOUND');
        if(request.user.role==='vendor' && p.vendor.toLowerCase()!==request.user.vendorName?.toLowerCase()) throw new Error('FORBIDDEN');
        const prior=(await client.query('SELECT * FROM stock_adjustments WHERE id=$1',[parsed.data.requestId])).rows[0];
        if(prior) {
          if(prior.product_id!==p.id || prior.delta!==parsed.data.delta || prior.actor_id!==request.user.id) throw new Error('ADJUSTMENT_CONFLICT');
          return p;
        }
        const held=Number((await client.query("SELECT COALESCE(SUM(quantity),0) AS quantity FROM stock_reservations WHERE product_id=$1 AND status='active'",[p.id])).rows[0].quantity);
        if(held!==p.stock_reserved) throw new Error('RESERVATION_RECONCILIATION_REQUIRED');
        const next=p.stock_quantity+parsed.data.delta;
        if(next<held || next<0) throw new Error('RESERVED_STOCK_PROTECTED');
        await client.query(`INSERT INTO stock_adjustments(id,product_id,actor_id,delta,quantity_before,quantity_after,reason) VALUES($1,$2,$3,$4,$5,$6,$7)`,[parsed.data.requestId,p.id,request.user.id,parsed.data.delta,p.stock_quantity,next,parsed.data.reason]);
        return (await client.query('UPDATE products SET stock_quantity=$2,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *',[p.id,next])).rows[0];
      });
      await invalidateCatalog().catch(()=>{});
      return {ok:true,product};
    }catch(error){
      const code=error instanceof Error ? error.message : 'ADJUSTMENT_FAILED';
      request.log.warn({error},'Inventory adjustment rejected');
      return reply.code(code==='FORBIDDEN'?403:409).send({error:code,message:'Stock was not changed. Refresh inventory and check reservations before retrying.'});
    }
  });
}
