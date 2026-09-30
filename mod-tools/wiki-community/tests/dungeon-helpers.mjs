import {privacyContext} from './privacy-helpers.mjs';
import {createCommunityHandler} from '../handler.mjs';
import {developmentTools} from '../development.mjs';
import {fixtureCatalog} from './helpers.mjs';

export const dungeons = {items: [{id: 'boss-fire'}, {id: 'event-water'}]};
export const pixel = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mVAAAAAASUVORK5CYII=', 'base64'));
export const guide = (extra = {}) => ({expectedRevision: 0, text: '阶段一\n蓄力后发动技能。', teamIds: [], imageIds: [], ...extra});
export async function dungeonContext(t) {
  const app = await privacyContext(t);
  const handle = createCommunityHandler(fixtureCatalog, {dungeons, now: () => app.now,
    development: developmentTools(app.env.COMMUNITY_COOKIE_SECRET, () => app.now)});
  async function dungeonCall(route, options = {}) {
    const method = options.method || (options.body !== undefined ? 'POST' : 'GET');
    const headers = {Origin: app.origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', Cookie: app.cookie, ...options.headers};
    const body = options.body instanceof Uint8Array ? options.body : typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    const response = await handle(new Request(`${app.origin}/api/community${route}`, {method, headers,
      ...(options.body !== undefined ? {body} : {})}), app.env);
    const json = response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : null;
    return {status: response.status, headers: response.headers, json, ...(json ? {} : {bytes: new Uint8Array(await response.arrayBuffer())})};
  }
  return Object.assign(app, {dungeonCall, upload(id = 'boss-fire', bytes = pixel, contentType = 'image/png') {
    return dungeonCall(`/admin/dungeons/${id}/images`, {body: bytes, headers: {'Content-Type': contentType}});
  }});
}
