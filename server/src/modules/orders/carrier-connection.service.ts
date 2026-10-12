import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { query } from '../../db/pool.js';

export const bookingSettingsSchema = z.object({
  pickupLocation: z.string().trim().min(1).max(100),
  clientName: z.string().trim().min(1).max(100),
  sellerGstTin: z.string().trim().regex(/^[0-9A-Z]{15}$/),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/),
  weightGrams: z.number().positive().max(30000),
  lengthCm: z.number().positive().max(200),
  widthCm: z.number().positive().max(200),
  heightCm: z.number().positive().max(200),
}).strict();
export type BookingSettings = z.infer<typeof bookingSettingsSchema>;

function encryptionKey(): Buffer | null {
  const value = process.env.CARRIER_CREDENTIALS_KEY || '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

export function encryptCarrierToken(token: string): string {
  const key = encryptionKey();
  if (!key) throw new Error('CARRIER_ENCRYPTION_NOT_CONFIGURED');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('urban-blade:delhivery:v1'));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString('base64')).join('.');
}

function decryptCarrierToken(value: string): string {
  const key = encryptionKey();
  if (!key) throw new Error('CARRIER_ENCRYPTION_NOT_CONFIGURED');
  try {
    const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('urban-blade:delhivery:v1'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch { throw new Error('CARRIER_CREDENTIALS_UNREADABLE'); }
}

export async function getCarrierConnection() {
  const stored = (await query<{ token_ciphertext: string; enabled: boolean; auto_assign: boolean; booking_settings: unknown }>(
    "SELECT token_ciphertext,enabled,auto_assign,booking_settings FROM carrier_connections WHERE carrier='delhivery'",
  )).rows[0];
  return {
    configured: Boolean(stored?.token_ciphertext || process.env.DELHIVERY_API_TOKEN),
    bookingSettings: bookingSettingsSchema.safeParse(stored?.booking_settings).success ? bookingSettingsSchema.parse(stored?.booking_settings) : null,
    enabled: stored?.enabled ?? true,
    autoAssign: stored?.auto_assign ?? false,
    source: stored ? 'admin' : process.env.DELHIVERY_API_TOKEN ? 'environment' : 'none',
    canSave: Boolean(encryptionKey()),
    workerEnabled: process.env.CARRIER_TRACKING_ENABLED !== 'false',
  };
}

export async function getCarrierToken(): Promise<string | null> {
  const stored = (await query<{ token_ciphertext: string; enabled: boolean }>(
    "SELECT token_ciphertext,enabled FROM carrier_connections WHERE carrier='delhivery'",
  )).rows[0];
  if (stored && !stored.enabled) return null;
  if (stored?.token_ciphertext) return decryptCarrierToken(stored.token_ciphertext);
  return process.env.DELHIVERY_API_TOKEN?.trim() || null;
}

export async function saveCarrierConnection(input: { token?: string; enabled: boolean; autoAssign: boolean; bookingSettings?: BookingSettings }, actorId: string) {
  const encrypted = input.token ? encryptCarrierToken(input.token) : null;
  await query(`INSERT INTO carrier_connections(carrier,token_ciphertext,enabled,auto_assign,updated_by,booking_settings)
    VALUES('delhivery',$1,$2,$3,$4,$5::jsonb)
    ON CONFLICT(carrier) DO UPDATE SET token_ciphertext=COALESCE($1,carrier_connections.token_ciphertext),
      enabled=$2,auto_assign=$3,updated_by=$4,booking_settings=COALESCE($5::jsonb,carrier_connections.booking_settings),updated_at=NOW()`,
  [encrypted, input.enabled, input.autoAssign, actorId, JSON.stringify(input.bookingSettings || {})]);
  return getCarrierConnection();
}
