import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Opt in with the project's available Wrangler/Miniflare installation, without adding dependencies.
const runtimePath = process.env.WF_WIKI_MINIFLARE;
test('workerd verifies Turnstile and rejects redirects without forwarding credentials', {skip: !runtimePath}, async (t) => {
  const {Miniflare, convertV4MiniflareOptions} = await import(pathToFileURL(runtimePath).href);
  const root = path.resolve(import.meta.dirname, '..');
  const entry = `import {challenge} from './security.mjs';
    export default {async fetch(request) {
      try {
        await challenge(request, {TURNSTILE_SECRET:'fixture-secret',COMMUNITY_ALLOWED_HOSTNAMES:'wiki.example'},
          'fixture-token', 'admin_login', fetch, null);
        return Response.json({verified:true});
      } catch (error) {return Response.json({error:error.code}, {status:error.status || 500});}
    }};`;
  const modules = [{type: 'ESModule', path: path.join(root, '__runtime_test.mjs'), contents: entry}];
  for (const name of ['security.mjs', 'model.mjs', 'codecs.mjs', 'limit-maintenance.mjs'])
    modules.push({type: 'ESModule', path: path.join(root, name), contents: await readFile(path.join(root, name), 'utf8')});
  let mode = 'success';
  const requests = [];
  const options = {modules, modulesRoot: root, compatibilityDate: '2026-09-29', outboundService: async (request) => {
    requests.push({url: request.url, method: request.method});
    assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(request.method, 'POST');
    const form = new URLSearchParams(await request.text());
    assert.equal(form.get('secret'), 'fixture-secret'); assert.equal(form.get('response'), 'fixture-token');
    if (mode === 'redirect') return new Response(null, {status: 302, headers: {Location: 'https://untrusted.example/steal'}});
    if (mode === 'unavailable') return new Response(null, {status: 503});
    if (mode === 'invalid-json') return new Response('not json');
    if (mode === 'null') return Response.json(null);
    const response = {success: true, action: 'admin_login', hostname: 'wiki.example'};
    if (mode === 'wrong-action') response.action = 'like_team';
    if (mode === 'wrong-host') response.hostname = 'another.example';
    if (mode === 'rejected') response.success = false;
    return Response.json(response);
  }};
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const verified = await mf.dispatchFetch('https://wiki.example/api/community/auth/login');
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), {verified: true});
  for (const value of ['redirect', 'unavailable', 'invalid-json', 'null', 'wrong-action', 'wrong-host', 'rejected']) {
    mode = value; const before = requests.length;
    const response = await mf.dispatchFetch('https://wiki.example/api/community/auth/login');
    assert.equal(response.status, ['redirect', 'unavailable', 'invalid-json'].includes(value) ? 503 : 403, value);
    assert.equal(requests.length, before + 1, 'Redirects must never cause a second outbound request');
  }
});
