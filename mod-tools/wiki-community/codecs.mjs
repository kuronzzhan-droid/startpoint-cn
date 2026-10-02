export const utf8 = new TextEncoder();
export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function unbase64(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}
export const encodeJSON = (value) => base64url(utf8.encode(JSON.stringify(value)));
export const decodeJSON = (value) => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(unbase64(value)));
export async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', utf8.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
export async function sign(secret, value) {
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8.encode(value))));
}
export async function verify(secret, value, signature) {
  try { return await crypto.subtle.verify('HMAC', await hmacKey(secret), unbase64(signature), utf8.encode(value)); }
  catch { return false; }
}
