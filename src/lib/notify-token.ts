import crypto from 'crypto';

/**
 * Deterministic HMAC token for the "blown-out" notification link (Phase 6).
 *
 * V1 is intentionally anonymous — no email infrastructure exists. The token
 * is shown/copyable directly on the claim-form success page after a creator
 * submits their bid. No PII is collected or sent.
 *
 * Token = first 16 hex chars of HMAC-SHA256(IDENTITY_SECRET, handle:seasonId)
 * - IDENTITY_SECRET is a per-deployment constant set via Vercel env, never client-side
 * - Deterministic: same handle + same season always produces same token
 * - Not a cryptographic secret, just anti-guess protection (16 hex = 64 bits)
 */
export function createNotifyToken(handle: string, seasonId: string): string {
  const secret = process.env.IDENTITY_SECRET;
  if (!secret) {
    throw new Error('IDENTITY_SECRET is not set — cannot create notify token');
  }
  const bare = handle.replace(/^@/, '').toLowerCase();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${bare}:${seasonId}`);
  const digest = hmac.digest('hex');
  // First 16 hex chars — URL-friendly, sufficient entropy for this purpose
  return digest.slice(0, 16);
}

/**
 * Verify a notify token against a handle and season.
 * Returns true if the token matches the expected value.
 */
export function verifyNotifyToken(handle: string, seasonId: string, token: string): boolean {
  const expected = createNotifyToken(handle, seasonId);
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== token.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return result === 0;
}