import { getCarrierToken, getCarrierConnection } from './carrier-connection.service.js';
import { query, withTransaction } from '../../db/pool.js';
import { z } from 'zod';
export interface ScrapedCheckpoint { stage:string; location:string; timestamp:string; activity:string; }
export interface ScrapedCarrierData {
  carrier:string; awb:string; portalUrl:string; status:'processing'|'shipped'|'delivered'|'cancelled'|null;
  rawPortalStatus:string; currentLocation:string; lastScanTime:string; expectedDelivery:string;
  recipientSignature?:string; checkpoints:ScrapedCheckpoint[]; source:'carrier_api'|'live_web_fetch'; checkedAt:string;
}
export function detectCarrier(awb:string, preferred?:string):string {
  const name=(preferred || '').toLowerCase();
  if(name.includes('shiprocket'))return 'Shiprocket';
  if(name.includes('delhivery'))return 'Delhivery Express';
  if(name.includes('bluedart')||name.includes('blue dart'))return 'BlueDart Express';
  if(name.includes('dtdc'))return 'DTDC Air';
  if(name.includes('urban'))return 'Urban Express Logistics';
  // AWB formats overlap between Indian carriers, so only use an unambiguous
  // carrier prefix. A bare numeric AWB must be selected explicitly.
  const normalized=awb.trim().toUpperCase();
  if(normalized.startsWith('TRK-UB-'))return 'Urban Express Logistics';
  if(normalized.startsWith('DEL'))return 'Delhivery Express';
  if(normalized.startsWith('DTDC'))return 'DTDC Air';
  if(normalized.startsWith('BD'))return 'BlueDart Express';
  if(normalized.startsWith('GS')||normalized.startsWith('SR'))return 'Shiprocket';
  return 'Unknown';
}
export function getOfficialTrackingUrl(carrier:string,awb:string):string {
  const name=carrier.toLowerCase();
  if(name.includes('shiprocket'))return `https://shiprocket.co/tracking/${encodeURIComponent(awb.trim())}`;
  if(name.includes('delhivery'))return `https://www.delhivery.com/track/package/${encodeURIComponent(awb.trim())}`;
  if(name.includes('bluedart'))return 'https://www.bluedart.com/tracking';
  if(name.includes('dtdc'))return 'https://www.dtdc.com/track-your-shipment/';
  return '';
}
export class CarrierPortalReviewError extends Error {
  readonly portalUrl: string;
  constructor(code: string, public readonly carrier: string, public readonly awb: string) {
    super(code);
    this.portalUrl = getOfficialTrackingUrl(carrier, awb);
  }
}
export async function carrierCapabilities(){const connected=await getCarrierConnection(); return [
  {name:'Shiprocket',mode:'portal_only',description:'Review the official tracking portal; public HTML is not a verified source for automatic updates'},
  {name:'Delhivery Express',mode:connected.configured && connected.enabled?'api':'configuration_required',description:connected.configured && connected.enabled?'Authenticated tracking API available':'Configure DELHIVERY_API_TOKEN; the public page is JavaScript-rendered'},
  {name:'BlueDart Express',mode:'portal_only',description:'Official portal requires CAPTCHA; open it and verify the shipment manually'},
  {name:'DTDC Air',mode:'portal_only',description:'Official tracking portal must be opened manually; no stable public server endpoint is available'},
  {name:'Urban Express Logistics',mode:'manual',description:'Internal delivery; record dispatch and delivery manually'},
];}
const shipmentSchema=z.object({AWB:z.union([z.string(),z.number()]).transform(String),Status:z.object({Status:z.string().min(1),StatusType:z.string().nullish(),StatusLocation:z.string().nullish(),StatusDateTime:z.string().nullish()}),ExpectedDeliveryDate:z.string().nullish(),Scans:z.array(z.object({ScanDetail:z.object({ScanType:z.string().nullish(),ScannedLocation:z.string().nullish(),ScanDateTime:z.string().nullish(),Instructions:z.string().nullish(),Scan:z.string().nullish()}).optional()})).optional()});
export async function fetchCarrierWebsiteTracking(awb:string,preference?:string):Promise<ScrapedCarrierData>{
  const carrier=detectCarrier(awb,preference);
  if(carrier==='Unknown')throw new Error('CARRIER_REQUIRED');
  if(carrier!=='Delhivery Express')throw new CarrierPortalReviewError('CARRIER_PORTAL_ONLY', carrier, awb);
  const token=await getCarrierToken();
  if(!token)throw new CarrierPortalReviewError('CARRIER_NOT_CONFIGURED', carrier, awb);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(`https://track.delhivery.com/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}`,{signal:controller.signal,headers:{Authorization:`Token ${token}`,Accept:'application/json'}});
    if(response.status===401||response.status===403)throw new Error('CARRIER_AUTH_FAILED');
    if(response.status===429)throw new Error('CARRIER_RATE_LIMITED');
    if(!response.ok)throw new Error('CARRIER_STATUS_UNAVAILABLE');
    const payload=await response.json();
    const entries=z.object({ShipmentData:z.array(z.object({Shipment:shipmentSchema}))}).safeParse(payload);
    if(!entries.success)throw new Error('CARRIER_RESPONSE_INVALID');
    const pkg=entries.data.ShipmentData.find(entry=>entry.Shipment.AWB.trim()===awb.trim())?.Shipment;
    if(!pkg)throw new Error('CARRIER_SHIPMENT_MISMATCH');
    let status:ScrapedCarrierData['status']=null;
    try {status=pkg.Status.StatusType && pkg.Status.StatusType !== 'UD' && pkg.Status.StatusType !== 'DL' ? null : mapRawStatusToInternal(pkg.Status.Status);}catch{ /* Retain unknown scans without guessing fulfilment. */ }
    return {carrier,awb,portalUrl:getOfficialTrackingUrl(carrier,awb),status,rawPortalStatus:pkg.Status.Status,currentLocation:pkg.Status.StatusLocation || '',lastScanTime:pkg.Status.StatusDateTime || '',expectedDelivery:pkg.ExpectedDeliveryDate || '',source:'carrier_api',checkedAt:new Date().toISOString(),checkpoints:(pkg.Scans || []).map(({ScanDetail:s})=>({stage:s?.ScanType || '',location:s?.ScannedLocation || '',timestamp:s?.ScanDateTime || '',activity:s?.Instructions || s?.Scan || ''}))};
  }catch(error){
    if(error instanceof Error && error.message.startsWith('CARRIER_'))throw error;
    throw new Error('CARRIER_STATUS_UNAVAILABLE');
  }finally{clearTimeout(timer);}
}
export function mapRawStatusToInternal(raw:string):'processing'|'shipped'|'delivered'|'cancelled'{
  const status=raw.trim().toLowerCase();
  if(status==='delivered'||status==='pod signed')return 'delivered';
  // Returns and failed delivery attempts never imply successful forward movement.
  if(/rto|return|cancel|undelivered|failed|exception/.test(status))throw new Error('CARRIER_STATUS_UNRECOGNIZED');
  if(['in transit','in-transit','out for delivery','dispatched','reached facility','on the way'].some(s=>status.includes(s)))return 'shipped';
  if(['manifest','pending pickup','booked','packaging'].some(s=>status.includes(s)))return 'processing';
  throw new Error('CARRIER_STATUS_UNRECOGNIZED');
}
export async function syncOrderFromCarrierWebsite(identifier:string,preferred?:string){
  const key=identifier.trim().replace(/^#/,'');
  const matches=(await query('SELECT * FROM orders WHERE id::text=$1 OR tracking_number=$1 LIMIT 2',[key])).rows;
  if(!matches.length){
    const carrier=detectCarrier(key,preferred);
    if(carrier!=='Unknown'){
      const websiteData=await fetchCarrierWebsiteTracking(key,carrier);
      return {
        order:null,
        websiteData,
        applied:false,
        reason:'Live carrier telemetry fetched for external consignment; no linked order in database.'
      };
    }
    throw new Error('ORDER_NOT_FOUND');
  }
  if(matches.length>1)throw new Error('AMBIGUOUS_TRACKING_NUMBER');
  const original=matches[0];
  if(!original.tracking_number)throw new Error('TRACKING_NUMBER_REQUIRED');
  const savedCarrier=detectCarrier(original.tracking_number,original.carrier);
  const carrier=savedCarrier==='Unknown' ? detectCarrier(original.tracking_number,preferred) : savedCarrier;
  if(preferred && preferred!=='auto' && savedCarrier!=='Unknown' && original.carrier && detectCarrier('',preferred)!==carrier)throw new Error('CARRIER_MISMATCH');
  const websiteData=await fetchCarrierWebsiteTracking(original.tracking_number,carrier);
  return withTransaction(async client=>{
    const current=(await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[original.id])).rows[0];
    if(!current)throw new Error('ORDER_NOT_FOUND');
    if(current.tracking_number!==original.tracking_number||current.carrier!==original.carrier)throw new Error('SHIPMENT_CHANGED_RETRY');
    const previous = current.tracking_data as ScrapedCarrierData | null;
    // A slower request must never overwrite a newer observation or carrier scan.
    const stale = previous && (Date.parse(previous.checkedAt) > Date.parse(websiteData.checkedAt)
      || Date.parse(previous.lastScanTime) > Date.parse(websiteData.lastScanTime));
    if (stale) throw new Error('CARRIER_STALE_RESPONSE');
    let reason='No forward fulfilment change reported';
    let next=current.status;
    const payable=current.payment_status==='captured'||['Cash on Delivery','cash_on_delivery'].includes(current.payment_method);
    if(current.payment_reconciliation_error || current.refund_status || current.return_status || !payable)reason='Payment, refund or inventory review prevents automatic fulfilment';
    else if(['cancelled','delivered'].includes(current.status))reason='Order is already in a final state';
    else if(!websiteData.status)reason='Carrier exception or unknown status: review required';
    else if((current.status==='processing'&&['shipped','delivered'].includes(websiteData.status))||(current.status==='shipped'&&websiteData.status==='delivered')){next=websiteData.status;reason='Verified carrier status applied';}
    const applied=next!==current.status;
    const note = applied ? `\n[Carrier check ${websiteData.checkedAt}] ${websiteData.rawPortalStatus}; ${reason}.` : '';
    const order = (await client.query(`UPDATE orders SET status=$2,
      notes=COALESCE(notes,'')||$3, tracking_data=$4::jsonb,
      tracking_checked_at=NOW(), tracking_next_check_at=NOW()+INTERVAL '5 minutes',
      tracking_failures=0, tracking_error=NULL,
      updated_at=CASE WHEN $5 THEN NOW() ELSE updated_at END,
      version=version+CASE WHEN $5 THEN 1 ELSE 0 END WHERE id=$1 RETURNING *`,
      [current.id,next,note,JSON.stringify(websiteData),applied])).rows[0];
    const observationKey = (data: ScrapedCarrierData | null) => data ? JSON.stringify([
      data.carrier, data.awb, data.status, data.rawPortalStatus, data.currentLocation,
      data.lastScanTime, data.expectedDelivery,
      data.checkpoints.map(scan => [scan.stage, scan.location, scan.timestamp, scan.activity]),
    ]) : '';
    if (applied || observationKey(websiteData) !== observationKey(previous)) {
      await client.query(`INSERT INTO order_fulfilment_events(order_id,source,previous_status,resulting_status,details) VALUES($1,'carrier_api',$2,$3,$4::jsonb)`,
        [current.id,current.status,next,JSON.stringify({reason,applied,...websiteData})]);
    }
    const items=(await client.query('SELECT * FROM order_items WHERE order_id=$1',[current.id])).rows;
    return {order:{...order,total_amount:Number(order.total_amount),subtotal:Number(order.subtotal),items},websiteData,applied,reason};
  });
}

export function trackingAutomatic(order: { tracking_number?: string; carrier?: string }, configured = Boolean(process.env.DELHIVERY_API_TOKEN)): boolean {
  return process.env.CARRIER_TRACKING_ENABLED !== 'false' && configured
    && detectCarrier(order.tracking_number || '', order.carrier) === 'Delhivery Express';
}
