'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');

const baselineSHA256 = 'c6134297ac12a3743fb9ccdfdc62a82edb4f30b517cb03dff7cf086a7a7f14e8';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const inlineJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c');

function validateData(review, presentation, recordings) {
  const { model, frameLibrary } = review;
  const moviePages = presentation.order.filter(page => page.kind === 0).map(page => page.page);
  assert.deepEqual(moviePages, model.pageOrder, 'Movie order differs from the display order');
  for (const page of moviePages) {
    const movie = model.pages[page];
    assert(movie && frameLibrary[movie.frameLibraryIndex]?.length === movie.frameCount,
      'Movie is missing frames: ' + page);
  }

  const roles = presentation.characters.map(character => character.id);
  const skillRoles = presentation.order.filter(page => page.kind === 2).map(page => page.roleId);
  assert.deepEqual([...skillRoles].sort(), [...roles].sort(), 'Skill pages do not cover the configured roles');
  assert.deepEqual(recordings.clips.map(clip => clip.roleId), skillRoles, 'Recordings differ from the skill page order');
  assert.equal(new Set(presentation.order.map(page => page.page)).size, presentation.order.length, 'Duplicate page');
  assert.equal(new Set(roles).size, roles.length, 'Duplicate role');
  for (const { id, posterPage } of presentation.characters) {
    assert(moviePages.includes(posterPage) && model.characters[id], 'Missing poster or role art: ' + id);
  }

  const [x, y, width, height] = recordings.stageMask;
  const [stageWidth, stageHeight] = recordings.stage;
  assert([x, y, width, height, stageWidth, stageHeight, recordings.fps].every(Number.isInteger)
    && x >= 0 && y >= 0 && width > 0 && height > 0 && recordings.fps > 0
    && x + width <= stageWidth && y + height <= stageHeight, 'Invalid native viewport');
  assert.deepEqual(recordings.stage, [model.stage.width, model.stage.uiHeight], 'Movie and recording stages differ');
  for (const clip of recordings.clips) {
    const bytes = Buffer.from(clip.data, 'base64');
    assert(bytes.length && bytes.toString('base64') === clip.data && hash(bytes) === clip.videoHash,
      'Native recording changed: ' + clip.roleId);
    assert(Number.isInteger(clip.width) && Number.isInteger(clip.height) && clip.width > 0 && clip.height > 0
      && clip.width * height === clip.height * width, 'Recording aspect ratio changed: ' + clip.roleId);
    assert(Number.isInteger(clip.firstFrame) && Number.isInteger(clip.lastFrame) && clip.firstFrame >= 0
      && clip.lastFrame >= clip.firstFrame && /^[a-f0-9]{64}$/.test(clip.sourcePNGSequenceSHA256),
    'Invalid frame window or capture identity: ' + clip.roleId);
  }
}

function build() {
  const review = JSON.parse(read('review-data.json'));
  const presentation = JSON.parse(read('presentation.json'));
  const recordings = JSON.parse(read('native-recordings.json'));
  validateData(review, presentation, recordings);

  const parts = new Map([
    ['REVIEW_DATA', gzipSync(JSON.stringify(review), { level: 9 }).toString('base64')],
    ['PRESENTATION', inlineJSON(presentation)],
    ['NATIVE_RECORDINGS', inlineJSON(recordings)],
    ['NATIVE_CLIP_PLAYER', read('native-clip-player.js')],
    ['PREVIEW_PLAYER', read('preview-player.js')],
  ]);
  const html = read('template.html').replace(/@@([A-Z_]+)@@/g, (_, marker) => {
    assert(parts.has(marker), 'Unknown or duplicate template marker: ' + marker);
    const value = parts.get(marker);
    parts.delete(marker);
    return value;
  });
  assert.equal(parts.size, 0, 'Template is missing required sections');
  return html;
}

function main() {
  const [output] = process.argv.slice(2);
  assert(process.argv.length === 3 && (output === '--verify' || path.extname(output).toLowerCase() === '.html'),
    'Usage: node build.cjs <output.html> or node build.cjs --verify');
  const html = build();
  const bytes = Buffer.from(html, 'utf8');
  const sha256 = hash(bytes);
  const baselineMatch = sha256 === baselineSHA256;
  if (output === '--verify') {
    assert(baselineMatch, 'Generated SHA-256 differs from the frozen preview: ' + sha256);
  } else {
    fs.writeFileSync(output, bytes, { flag: 'wx' });
  }
  console.log(JSON.stringify({ bytes: bytes.length, htmlCharacters: html.length, sha256, baselineMatch }));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
