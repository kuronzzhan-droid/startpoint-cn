'use strict';
// Reconstruct the complete, self-contained review without installing dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const POOLS = ['starview-encounter', 'autumn-beast-dice', 'autumn-prayer-rabbit', 'autumn-moon-laurel'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
function requireValue(condition, message) { if (!condition) throw Error(message); }
function assemble(key) {
  requireValue(POOLS.includes(key), 'Unknown pool');
  const root = path.join(__dirname, key, 'preview');
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const meta = JSON.parse(read('preview.json'));
  const raw = read('review-data.json');
  requireValue(sha256(raw) === meta.reviewDataSHA256, 'Review data identity changed');
  const { model, frameLibrary } = JSON.parse(raw);
  const presentationText = read('presentation.json');
  const mediaText = read('native-recordings.json');
  const presentation = JSON.parse(presentationText), media = JSON.parse(mediaText);
  const roles = presentation.characters.map(r => String(r.id));
  const order = presentation.order;
  requireValue(order.length === 1 + 2 * roles.length && order[0].kind === 0, 'Incomplete page order');
  requireValue(media.clips.length === roles.length && new Set(roles).size === roles.length, 'Invalid role list');
  requireValue(media.fps === 60 && JSON.stringify(media.stageMask) === '[0,60,1080,1560]', 'Native viewport changed');
  let frames = 0;
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i], skill = order[1 + i * 2], poster = order[2 + i * 2], clip = media.clips[i];
    requireValue(skill.kind === 2 && String(skill.roleId) === role && poster.kind === 0 && poster.page === presentation.characters[i].posterPage, 'Skill/poster order differs');
    requireValue(String(clip.roleId) === role && sha256(Buffer.from(clip.data, 'base64')) === clip.videoHash, 'Native recording identity changed');
    requireValue(clip.width * 1560 === clip.height * 1080, 'Recording aspect ratio differs');
    requireValue(Number.isInteger(clip.lastFrame) && clip.lastFrame >= clip.firstFrame, 'Invalid frame window');
    frames += clip.lastFrame - clip.firstFrame + 1;
  }
  for (const entry of order.filter(p => p.kind === 0)) {
    const page = model.pages[entry.page];
    requireValue(page && frameLibrary[page.frameLibraryIndex]?.length === page.frameCount, 'Missing Movie frames');
  }
  const compressed = gzipSync(raw, { level: 9 });
  const header = Buffer.from(meta.gzipHeaderHex, 'hex');
  requireValue(header.length === 10 && header[0] === 31 && header[1] === 139 && header[3] === 0, 'Unsupported gzip header');
  header.copy(compressed, 0);
  const sections = new Map([
    ['REVIEW_DATA', compressed.toString('base64')], ['PRESENTATION', presentationText],
    ['NATIVE_RECORDINGS', mediaText], ['NATIVE_CLIP_PLAYER', read('native-clip-player.js')],
    ['PREVIEW_PLAYER', read('preview-player.js')],
  ]);
  const html = read('template.html').replace(/@@([A-Z_]+)@@/g, (_, name) => {
    requireValue(sections.has(name), 'Unknown or repeated template section');
    const value = sections.get(name); sections.delete(name); return value;
  });
  requireValue(sections.size === 0 && html.length <= 4500000, 'Incomplete or oversized preview');
  return { html, sha256: sha256(html), bytes: Buffer.byteLength(html), nativeFrames: frames, pages: order.length, meta };
}
function main() {
  const [key, output] = process.argv.slice(2);
  requireValue(process.argv.length === 4 && (output === '--verify' || path.extname(output).toLowerCase() === '.html'), 'Usage: node build-preview.cjs <pool-key> <--verify|output.html>');
  const result = assemble(key);
  requireValue(result.sha256 === result.meta.previewSHA256 && result.bytes === result.meta.previewBytes, 'Generated preview differs from the frozen delivery');
  if (output !== '--verify') fs.writeFileSync(output, result.html, { flag: 'wx' });
  console.log(JSON.stringify({ pool: key, bytes: result.bytes, sha256: result.sha256, pages: result.pages, nativeFrames: result.nativeFrames }));
}
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { assemble, POOLS };
