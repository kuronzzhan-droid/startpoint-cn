import {base64url, unbase64, utf8, hmacKey} from './codecs.mjs';
import {fail} from './model.mjs';

// workerd currently caps PBKDF2 at 100,000. Keep one explicit format, never silently downgrade.
export const PASSWORD_ITERATIONS = 100_000;
export const PASSWORD_MIN_LENGTH = 8, PASSWORD_MAX_LENGTH = 128;
const DUMMY = `p1$${PASSWORD_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
export function normalizeEmail(value) {
  if (typeof value !== 'string') fail(400, 'invalid_email', '请输入有效的邮箱登录名。');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email))
    fail(400, 'invalid_email', '请输入有效的邮箱登录名。');
  return email;
}
export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH)
    fail(400, 'invalid_password', '密码须为 8 至 128 个字符，空格会原样保留。');
  return value;
}
async function derived(password, salt) {
  const key = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS}, key, 256);
  return utf8.encode(base64url(new Uint8Array(bits)));
}
export async function hashPassword(password, pepper) {
  validatePassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(pepper), await derived(password, salt));
  return `p1$${PASSWORD_ITERATIONS}$${base64url(salt)}$${base64url(new Uint8Array(mac))}`;
}
export async function checkPassword(password, stored, pepper) {
  const validInput = typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
  const parts = (stored || DUMMY).split('$');
  const validFormat = parts.length === 4 && parts[0] === 'p1' && parts[1] === String(PASSWORD_ITERATIONS) &&
    /^[A-Za-z0-9_-]{22}$/.test(parts[2]) && /^[A-Za-z0-9_-]{43}$/.test(parts[3]);
  const source = validFormat ? parts : DUMMY.split('$');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(pepper), unbase64(source[3]),
    await derived(validInput ? password : 'invalid-password-input', unbase64(source[2])));
  return Boolean(stored && validFormat && validInput && ok);
}
export const randomSession = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function tokenHash(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value))));
}
