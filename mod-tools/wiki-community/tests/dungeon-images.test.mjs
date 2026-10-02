import test from 'node:test';
import assert from 'node:assert/strict';
import {dungeonContext, guide, pixel} from './dungeon-helpers.mjs';
import {inspectImage} from '../dungeon-image-format.mjs';
import {IMAGE_BYTES} from '../dungeon-model.mjs';

const decode = (value) => Uint8Array.from(Buffer.from(value, 'base64'));
const jpeg = decode('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyGiiivSOA/9k=');
const webp = decode('UklGRjIAAABXRUJQVlA4ICYAAACQAQCdASoCAAMAAUAmJQBOl0AAhgAA/vquD+1MEkZS/6+AKeJAAA==');

test('real static PNG/JPEG/WebP fixtures have their actual dimensions and MIME checked', () => {
  assert.deepEqual(inspectImage(pixel, 'image/png'), {width: 1, height: 1, mime: 'image/png', bytes: pixel.length});
  for (const [bytes, mime] of [[jpeg, 'image/jpeg'], [webp, 'image/webp']])
    assert.deepEqual(inspectImage(bytes, mime), {width: 2, height: 3, mime, bytes: bytes.length});
  for (const [bytes, mime] of [[pixel, 'image/jpeg'], [jpeg, 'image/webp'], [webp, 'image/png'],
    [new TextEncoder().encode('<svg onload="alert(1)"></svg>'), 'image/png'], [pixel, 'image/svg+xml'], [pixel, 'image/gif']])
    assert.throws(() => inspectImage(bytes, mime), {status: 415});
});

test('truncated, oversized, animated, huge-dimension and trailing-data image inputs are rejected', () => {
  assert.throws(() => inspectImage(new Uint8Array(IMAGE_BYTES + 1), 'image/png'), {status: 413});
  for (const [bytes, mime] of [[pixel, 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp']]) {
    assert.throws(() => inspectImage(bytes.slice(0, -2), mime), {status: 415});
    const trailing = new Uint8Array(bytes.length + 4); trailing.set(bytes);
    assert.throws(() => inspectImage(trailing, mime), {status: 415});
  }
  for (const [width, height] of [[0, 1], [4097, 1], [1, 4097], [4096, 4096]]) {
    const bytes = pixel.slice(), view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
    assert.throws(() => inspectImage(bytes, 'image/png'), {code: 'image_dimensions'});
  }
  const animation = pixel.slice(); animation.set(new TextEncoder().encode('acTL'), 37);
  assert.throws(() => inspectImage(animation, 'image/png'), {status: 415});
  const riff = webp.slice(); new DataView(riff.buffer).setUint32(4, 100000, true);
  assert.throws(() => inspectImage(riff, 'image/webp'), {status: 415});
});

test('image HTTP auth, MIME, streaming size, same-origin and mutation rate limits are enforced', async (t) => {
  const app = await dungeonContext(t);
  assert.equal((await app.upload()).status, 401);
  app.as('editor-a');
  const endpoint = '/admin/dungeons/boss-fire/images';
  assert.equal((await app.dungeonCall(endpoint, {body: pixel, headers: {'Content-Type': 'image/png', Origin: 'https://evil.test'}})).status, 403);
  assert.equal((await app.upload('boss-fire', jpeg, 'image/png')).status, 415);
  assert.equal((await app.upload('boss-fire', new Uint8Array(IMAGE_BYTES + 1))).status, 413);
  assert.equal((await app.upload('missing')).status, 404);
  const first = await app.upload(); assert.equal(first.status, 201);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_images').get().n, 1);
  app.db.raw.prepare("UPDATE community_limits SET count=120 WHERE key LIKE 'admin:%'").run();
  assert.equal((await app.dungeonCall(`/admin/dungeons/boss-fire/images/${first.json.image.id}`, {method: 'DELETE'})).status, 429);
  assert.equal((await app.upload()).status, 429);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_images').get().n, 1);
});

test('per-admin upload limit survives deleting drafts and cannot be reset by changing IP', async (t) => {
  const app = await dungeonContext(t); app.as('editor-a');
  for (let i = 0; i < 20; i++) {
    const result = await app.upload(); assert.equal(result.status, 201);
    assert.equal((await app.dungeonCall(`/admin/dungeons/boss-fire/images/${result.json.image.id}`, {method: 'DELETE'})).status, 200);
  }
  app.db.raw.prepare("DELETE FROM community_limits WHERE key LIKE 'dungeon_upload:%'").run();
  const denied = await app.upload(); assert.equal(denied.status, 429); assert.equal(denied.json.error, 'upload_rate_limited');
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_images').get().n, 0);
  assert.equal(app.db.raw.prepare("SELECT COUNT(*) n FROM community_dungeon_audit WHERE action='image_upload'").get().n, 20);
  app.now += 3600_001;
  assert.equal((await app.upload()).status, 201);
});

test('per-dungeon storage bound includes unreferenced drafts and failed upload writes no image or audit', async (t) => {
  const app = await dungeonContext(t); app.as('editor-a');
  const seed = app.db.raw.prepare(`INSERT INTO community_dungeon_images VALUES(?,?,'image/png',zeroblob(?),?,1,1,?,?)`);
  for (let i = 0; i < 16; i++) seed.run(crypto.randomUUID(), 'boss-fire', IMAGE_BYTES, IMAGE_BYTES, 'editor-b', app.now);
  const result = await app.upload(); assert.equal(result.status, 409); assert.equal(result.json.error, 'image_storage_full');
  assert.match(result.json.message, /联系站长/);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_images').get().n, 16);
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) n FROM community_dungeon_audit').get().n, 0);
  assert.equal((await app.upload('event-water')).status, 201);
});

test('guide cannot race an image deletion or use a different dungeon image', async (t) => {
  const app = await dungeonContext(t); app.as('editor-a'); const image = (await app.upload()).json.image;
  assert.equal((await app.dungeonCall('/admin/dungeons/event-water', {method: 'PATCH', body: guide({imageIds: [image.id]})})).status, 409);
  await app.dungeonCall(`/admin/dungeons/boss-fire/images/${image.id}`, {method: 'DELETE'});
  assert.equal((await app.dungeonCall('/admin/dungeons/boss-fire', {method: 'PATCH', body: guide({imageIds: [image.id]})})).status, 409);
});
