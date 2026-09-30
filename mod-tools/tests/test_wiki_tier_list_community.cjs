const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(setImmediate);
class Node {
  constructor(tag, className = '', text = '') {Object.assign(this, {tag, className, ownText: String(text), children: [], events: {}, attributes: {}, disabled: false, hidden: false});}
  append(...nodes) {nodes.forEach(node => {node.parent = this; this.children.push(node);});}
  replaceChildren(...nodes) {this.children.forEach(node => {node.parent = null;}); this.children = []; this.ownText = ''; this.append(...nodes);}
  get textContent() {return this.ownText + this.children.map(node => node.textContent).join('');}
  set textContent(value) {this.replaceChildren(); this.ownText = String(value);}
  setAttribute(key, value) {this.attributes[key] = String(value);}
  addEventListener(event, action) {this.events[event] = action;}
  get isConnected() {return Boolean(this.connected || this.parent?.isConnected);}
  all(match) {return this.children.flatMap(node => [...(match(node) ? [node] : []), ...node.all(match)]);}
  async fire(event = 'click', args = {}) {if (!this.disabled) return this.events[event]?.({target: this, preventDefault() {}, ...args});}
  focus() {this.focused = true;}
}
const el = (...args) => new Node(...args);
const cls = (root, name) => root.all(node => node.className.split(' ').includes(name))[0];
const all = (root, name) => root.all(node => node.className.split(' ').includes(name));
const button = (root, label) => root.all(node => node.tag === 'button' && node.textContent === label)[0];
const rowKeys = ['tier0', 'between0', 'tier1', 'between1', 'tier2', 'between2', 'tier3', 'between3', 'tier4'];
const rows = () => Object.fromEntries(rowKeys.map(key => [key, []]));
const me = {rows: rows(), submittedToday: false, nextVoteAt: Date.parse('2026-10-01T16:00:00Z'), updatedAt: null, rankedCharacters: 0, challengeAction: 'submit_tier_ranking'};
const record = (id, patch = {}) => ({id, compositeScore: 4.5, row: 'tier0', placementAverage: 4.5, placementVoters: 2, ratingAverage: 4.5, ratingVoters: 3, missingSources: [], ...patch});
const data = {characters: [{id: 'c1', name: '甲', element: '火'}, {id: 'c2', name: '乙', element: '水'}, {id: 'c3', name: '丙', element: '火'}]};
const aggregate = (items = [record('c1'), record('c2'), record('c3')]) => ({items, formula: {placementWeight: 0.7, ratingWeight: 0.3}});
function setup(handler = async pathname => pathname.endsWith('/me') ? me : aggregate(), options = {}) {
  const calls = [], dialogs = [], challenges = [], transitions = []; let configCalls = 0, portraitsCreated = 0;
  const C = {client: {request: async (...args) => {calls.push(args); return handler(...args);}, config: async () => {configCalls++; return options.config ? options.config() : {enabled: true};}}, message: error => error.message};
  C.dialog = () => {const modal = {element: el('dialog'), cleanup(callback) {this.clean = callback;}, close() {this.clean?.(); this.element.connected = false;}}; modal.element.connected = true; dialogs.push(modal); return modal;};
  C.challenge = (_host, _config, action, _ui, onChange) => {
    const challenge = {action, resets: 0, destroyed: false, token: '', ready(token = 'one-use') {this.token = token; onChange(true);},
      take() {const token = this.token; this.token = ''; onChange(false); return token;}, reset() {this.resets++; onChange(false);}, destroy() {this.destroyed = true;}};
    challenges.push(challenge); return challenge;
  };
  const window = {WFCommunity: C, location: {protocol: options.protocol || 'https:'}, WFCatalogAvatars: {
    create({host}) {portraitsCreated++; host.append(el('div', 'avatar-control')); return {picture: character => el('span', 'portrait', character.name)};},
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../wiki/tier-list-community.js'), 'utf8'), {window, Date});
  const host = el('main'); host.connected = true; let localRows = rows();
  const state = {getRows: () => JSON.parse(JSON.stringify(localRows))};
  const controller = window.WFTierListCommunity.create({host, data, state, ui: {el, nativeIcon: (_group, value) => el('img', 'element-icon', value)}, onViewChange: value => transitions.push(value)});
  return {host, controller, calls, dialogs, challenges, transitions, setRows: value => {localRows = value;}, portraitsCreated: () => portraitsCreated, configCalls: () => configCalls};
}

test('my view and unsent local edits do not fetch rankings, request verification or submit votes', async () => {
  const x = setup(); assert.deepEqual(x.calls, []); assert.equal(x.portraitsCreated(), 0); assert.equal(x.challenges.length, 0);
  const local = rows(); local.tier0 = ['c1']; x.setRows(local); x.controller.refreshState();
  assert.match(x.host.textContent, /本地已排 1 位角色/); assert.deepEqual(x.calls, []); assert.equal(x.configCalls(), 0);
  assert.equal(x.controller.mineHost.hidden, false); assert.equal(cls(x.host, 'tier-public-view').hidden, true);
});

test('public view lazily reads authoritative scores, sources and counts without inventing scores for missing data', async () => {
  const value = aggregate([record('c1'), record('c2', {compositeScore: 0, row: 'tier4', placementAverage: null, placementVoters: 0, ratingAverage: 0, ratingVoters: 1, missingSources: ['placement']})]);
  const x = setup(async () => value); x.controller.setView('community'); await tick();
  assert.equal(x.calls.length, 1); assert.equal(x.calls[0][0], '/tier-rankings'); assert.equal(x.portraitsCreated(), 1);
  const cards = all(x.host, 'tier-public-card'); assert.equal(cards.length, 2);
  assert.equal(cards[0].href, '#character/c1'); assert.match(cards[0].textContent, /4\.50.*手排 2 人 · 评分 3 人/);
  assert.match(cards[1].textContent, /0\.00.*仅评分 · 暂无手排/); assert.doesNotMatch(cards[1].title, /手排均分 0/);
  assert.equal(x.controller.mineHost.hidden, true); assert.equal(button(x.host, '大家排行').attributes['aria-selected'], 'true');
});

test('element tabs filter cached rows without requests and preserve server tie order', async () => {
  const x = setup(async () => aggregate([record('c3'), record('c1'), record('c2')])); x.controller.setView('community'); await tick();
  const fire = x.host.all(node => node.attributes['aria-label'] === '火属性排行')[0]; await fire.fire();
  assert.deepEqual(all(x.host, 'tier-public-card').map(card => card.href), ['#character/c3', '#character/c1']); assert.equal(x.calls.length, 1);
  assert.match(cls(x.host, 'tier-public-status').textContent, /火属性榜 · 2/);
  await x.host.all(node => node.attributes['aria-label'] === '暗属性排行')[0].fire();
  assert.equal(all(x.host, 'tier-public-card').length, 0); assert.match(cls(x.host, 'tier-public-status').textContent, /暗属性暂时还没有/);
  await button(x.host, '总榜').fire(); assert.equal(all(x.host, 'tier-public-card').length, 3); assert.equal(x.calls.length, 1);
});

test('late or detached public responses never overwrite another view; returning requests current data', async () => {
  const waiting = []; const x = setup(() => new Promise(resolve => waiting.push(resolve)));
  x.controller.setView('community'); x.controller.setView('mine'); waiting[0](aggregate()); await tick();
  assert.equal(all(x.host, 'tier-public-card').length, 0); assert.equal(x.controller.mineHost.hidden, false);
  x.controller.setView('community'); assert.equal(x.calls.length, 2); x.host.connected = false; waiting[1](aggregate()); await tick();
  assert.equal(all(x.host, 'tier-public-card').length, 0);
});

test('failed or malformed aggregate reads have an explicit retry instead of a fake empty score', async () => {
  let reads = 0; const x = setup(async () => ++reads === 1 ? aggregate([record('c1', {compositeScore: null})]) : aggregate());
  x.controller.setView('community'); await tick(); assert.equal(all(x.host, 'tier-public-card').length, 0);
  assert.match(cls(x.host, 'tier-public-status').textContent, /资料异常.*重试/);
  await button(x.host, '刷新大家排行').fire(); assert.equal(all(x.host, 'tier-public-card').length, 3);
  const empty = setup(async () => aggregate([])); empty.controller.setView('community'); await tick();
  assert.equal(all(empty.host, 'tier-public-card').length, 0); assert.match(cls(empty.host, 'tier-public-status').textContent, /还没有玩家提交/);
});

test('submit requires a one-use challenge and explicit confirmation, uses a board snapshot, then reads the updated public board', async () => {
  const x = setup(async (pathname, body) => pathname === '/tier-rankings/me' ? me : body
    ? {...me, rows: body.rows, submittedToday: true, rankedCharacters: 1} : aggregate());
  const local = rows(); local.between0 = ['c1']; x.setRows(local);
  await button(x.host, '提交我的排行').fire(); await tick(); const modal = x.dialogs[0], confirm = button(modal.element, '验证后确认提交');
  assert.equal(x.challenges[0].action, 'submit_tier_ranking'); assert.equal(confirm.disabled, true);
  await confirm.fire(); assert.equal(x.calls.filter(call => call[1]).length, 0);
  x.setRows(rows()); x.challenges[0].ready('verified'); await confirm.fire();
  const post = x.calls.find(call => call[1]); assert.equal(post[1].turnstileToken, 'verified'); assert.deepEqual(post[1].rows.between0, ['c1']);
  assert.match(modal.element.textContent, /排行已提交/); assert.equal(confirm.disabled, true); assert.equal(x.challenges[0].resets, 1);
  modal.close(); assert.equal(x.challenges[0].destroyed, true); x.controller.setView('community'); await tick();
  assert.equal(x.calls.filter(call => call[0] === '/tier-rankings' && !call[1]).length, 1); assert.equal(all(x.host, 'tier-public-card').length, 3);
});

test('a daily block prevents verification and resubmission, and 409 responses also lock the dialog', async () => {
  const locked = {...me, submittedToday: true}; const x = setup(async () => locked);
  await button(x.host, '提交我的排行').fire(); await tick(); assert.equal(x.challenges.length, 0);
  assert.match(x.dialogs[0].element.textContent, /今天已提交过排行/); assert.equal(x.calls.length, 1);
  const y = setup(async (_pathname, body) => {if (body) throw Object.assign(new Error('already'), {code: 'already_ranked', status: 409, data: locked}); return me;});
  await button(y.host, '提交我的排行').fire(); await tick(); y.challenges[0].ready();
  await button(y.dialogs[0].element, '验证后确认撤回').fire(); assert.match(y.dialogs[0].element.textContent, /今天已提交过排行/);
  assert.equal(button(y.dialogs[0].element, '验证后确认撤回').disabled, true);
});

test('canceling during personal-state or verification reads does not create a late challenge', async () => {
  let resolve; const x = setup(() => new Promise(done => {resolve = done;}));
  await button(x.host, '提交我的排行').fire(); x.dialogs[0].close(); resolve(me); await tick(); assert.equal(x.challenges.length, 0);
  const y = setup(async () => me, {config: () => new Promise(done => {resolve = done;})});
  await button(y.host, '提交我的排行').fire(); await tick(); y.dialogs[0].close(); resolve({enabled: true}); await tick(); assert.equal(y.challenges.length, 0);
});

test('empty-board withdrawal is an explicit verified whole-board replacement', async () => {
  const x = setup(async (_pathname, body) => body ? {...me, rows: body.rows, submittedToday: true} : me);
  await button(x.host, '提交我的排行').fire(); await tick(); assert.match(x.dialogs[0].element.textContent, /撤回你之前全部手排票/);
  x.challenges[0].ready(); await button(x.dialogs[0].element, '验证后确认撤回').fire();
  const post = x.calls.find(call => call[1]); assert.equal(Object.values(post[1].rows).flat().length, 0);
  assert.match(x.dialogs[0].element.textContent, /已撤回之前的手排票/);
});

test('an uncertain submit is never reported as accepted and reconnect checks the daily record before a new challenge', async () => {
  let submitted = false;
  const x = setup(async (_pathname, body) => {
    if (body) {submitted = true; throw new Error('连接超时');}
    return {...me, submittedToday: submitted};
  });
  await button(x.host, '提交我的排行').fire(); await tick(); x.challenges[0].ready();
  const dialog = x.dialogs[0].element; await button(dialog, '验证后确认撤回').fire();
  assert.match(dialog.textContent, /连接超时/); assert.doesNotMatch(dialog.textContent, /已撤回之前/);
  assert.equal(button(dialog, '验证后确认撤回').disabled, true);
  await button(dialog, '重新连接排行服务').fire();
  assert.match(dialog.textContent, /今天已提交过排行/); assert.equal(x.challenges.length, 1);
  assert.equal(x.challenges[0].destroyed, true); assert.equal(x.calls.filter(call => call[1]).length, 1);
});

test('offline mode keeps local editing available and never fetches or starts verification', async () => {
  const x = setup(async () => {throw new Error('must not fetch');}, {protocol: 'file:'});
  assert.equal(button(x.host, '提交我的排行').disabled, true); x.controller.setView('community'); await tick();
  assert.deepEqual(x.calls, []); assert.match(cls(x.host, 'tier-public-status').textContent, /离线版无法读取/);
  x.controller.setView('mine'); assert.equal(x.controller.mineHost.hidden, false);
});
