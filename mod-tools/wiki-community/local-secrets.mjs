// Local-only persistent private configuration. Never imported by Pages Functions.
import {realpath, lstat, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const names = ['COMMUNITY_COOKIE_SECRET', 'COMMUNITY_IP_SALT', 'COMMUNITY_PASSWORD_PEPPER'];
const fresh = () => Object.fromEntries(names.map((name) => [name, randomBytes(32).toString('hex')]));
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
async function safePath(file, site) {
  const absolute = path.resolve(file), parent = await realpath(path.dirname(absolute));
  const resolved = path.join(parent, path.basename(absolute));
  if (inside(site, resolved)) throw new Error('Private database and secrets must stay outside the static site.');
  let info;
  try {info = await lstat(resolved);} catch (error) {if (error.code !== 'ENOENT') throw error;}
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error('Private configuration must be a regular file, not a link.');
  return resolved;
}
export async function localSecrets(database, site) {
  if (database === ':memory:') return {database, secrets: fresh()};
  // Compare both sides canonically, including Windows short paths and directory aliases.
  const root = await realpath(site);
  const file = await safePath(database, root), secretFile = await safePath(`${file}.secrets.json`, root);
  let raw;
  try {raw = await readFile(secretFile, 'utf8');} catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Upgrade legacy visitor-only databases, but never replace a password account's missing pepper.
    try {if ((await lstat(file)).size > 0) {
      const legacy = new DatabaseSync(file, {readOnly: true});
      try {
        const hasUsers = legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='community_users'").get();
        if (hasUsers && legacy.prepare('SELECT 1 FROM community_users LIMIT 1').get())
          throw new Error('Existing password accounts have no private secrets; restore their original secrets before starting.');
      } finally {legacy.close();}
    }}
    catch (statError) {if (statError.code !== 'ENOENT') throw statError;}
    const value = JSON.stringify(fresh()) + '\n';
    try {await writeFile(secretFile, value, {flag: 'wx', mode: 0o600}); raw = value;}
    catch (writeError) {if (writeError.code !== 'EEXIST') throw writeError; raw = await readFile(secretFile, 'utf8');}
  }
  let secrets;
  try {secrets = JSON.parse(raw);} catch {throw new Error('Invalid private secrets file; restore it instead of regenerating keys.');}
  if (!secrets || names.some((name) => typeof secrets[name] !== 'string' || !/^[a-f0-9]{64}$/.test(secrets[name])))
    throw new Error('Invalid private secrets format; restore the original keys.');
  return {database: file, secrets};
}
