/* Codes are issued by the community service for connected game servers. */
((root) => {
  'use strict';
  const validCode = (value) => typeof value === 'string' && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(value);
  const publicCode = (item) => (!item.status || item.status === 'approved') && validCode(item.gameCode) ? item.gameCode : '';
  const explanation = '仅接入本站队伍码的游戏服务器可用。';
  function codeView(code, ui) {
    const {el} = ui, box = el('div', 'community-game-code');
    const label = el('label', 'community-game-code-label', '游戏队伍码');
    const input = el('input', 'community-game-code-value'); input.type = 'text'; input.readOnly = true; input.value = code;
    input.setAttribute('aria-label', '游戏队伍码，可选中文本复制'); input.spellcheck = false;
    input.addEventListener('click', () => input.select()); label.append(input);
    const copy = el('button', 'secondary-button', '复制游戏码'); copy.type = 'button';
    const status = el('span', 'community-game-code-copy-status'); status.setAttribute('role', 'status');
    copy.addEventListener('click', async () => {
      copy.disabled = true;
      try {
        if (!root.navigator?.clipboard?.writeText) throw new Error('clipboard unavailable');
        await root.navigator.clipboard.writeText(code); status.textContent = '已复制。';
      } catch {
        input.focus(); input.select(); status.textContent = '请复制上方已选中的队伍码。';
      } finally {copy.disabled = false;}
    });
    const actions = el('div', 'community-game-code-actions'); actions.append(copy, status);
    box.append(label, actions, el('p', 'muted community-game-code-note', explanation)); return box;
  }
  function readonly(item, ui) {const code = publicCode(item); return code ? codeView(code, ui) : null;}
  function controls(item, ui, request) {
    const {el} = ui, section = el('details', 'community-game-code-manager');
    section.append(el('summary', '', '游戏队伍码管理'));
    const status = el('p', 'community-game-code-status'); status.setAttribute('role', 'status');
    const preview = el('div'), actions = el('div', 'community-game-code-actions');
    const make = el('button', 'secondary-button', '生成游戏码'), revoke = el('button', 'secondary-button', '停用游戏码');
    const refresh = el('button', 'secondary-button', '刷新状态');
    [make, revoke, refresh].forEach((button) => {button.type = 'button';});
    actions.append(make, revoke, refresh); section.append(preview, status, actions);
    let state = {gameCode: null, active: false, teamRevision: Number(item.revision)}, busy = false, loaded = false, conflict = false;
    const base = `/admin/teams/${encodeURIComponent(item.id)}/game-code`;
    function paint() {
      make.disabled = busy || conflict || item.status !== 'approved';
      revoke.disabled = busy || conflict || !state.active; refresh.disabled = busy;
      make.textContent = state.active ? '复用当前游戏码' : '生成游戏码';
    }
    function accept(result) {
      if (!result || typeof result.active !== 'boolean' || (result.active && !validCode(result.gameCode))) {
        throw new Error('服务端未返回有效的游戏码状态，请刷新核实。');
      }
      const revision = Number(result.teamRevision);
      if (!Number.isSafeInteger(revision) || revision !== state.teamRevision) {
        throw Object.assign(new Error('队伍版本已变化，请重新加载管理列表。'), {code: 'edit_conflict'});
      }
      state = {gameCode: result.active ? result.gameCode : null, active: result.active, teamRevision: revision};
      item.revision = revision; item.gameCode = state.gameCode;
      preview.replaceChildren(); if (state.active) preview.append(codeView(state.gameCode, ui));
      loaded = true;
    }
    async function run(operation) {
      if (busy || (operation !== 'refresh' && conflict)) return;
      if (operation === 'make' && item.status !== 'approved') {status.textContent = '隐藏或未公开的盘子不能生成游戏码。'; return;}
      if (operation !== 'refresh' && !Number.isSafeInteger(state.teamRevision)) {status.textContent = '队伍版本缺失，请重新加载管理列表。'; return;}
      busy = true; paint(); status.textContent = '正在读取服务端游戏码…';
      try {
        const result = await request(operation === 'revoke' ? `${base}/revoke` : base,
          operation === 'refresh' ? undefined : {expectedRevision: state.teamRevision}, operation === 'refresh' ? 'GET' : 'POST');
        if (!section.isConnected) return;
        accept(result); conflict = false;
        status.textContent = item.status !== 'approved' ? '隐藏或未公开的盘子不能生成游戏码。'
          : operation === 'revoke' ? '游戏码已停用，旧码将不能再导入。'
            : state.active ? '这是服务端保存的有效游戏码。' : '尚无有效游戏码；由管理员生成后才会公开展示。';
      } catch (error) {
        if (!section.isConnected) return;
        conflict = error.code === 'edit_conflict';
        if (conflict) {preview.replaceChildren(); state.active = false; item.gameCode = null;}
        status.textContent = conflict ? '队伍已被修改，请重新加载管理列表后操作。' : root.WFCommunity.message(error);
      } finally {busy = false; if (section.isConnected) paint();}
    }
    section.addEventListener('toggle', () => {if (section.open && !loaded) run('refresh');});
    make.addEventListener('click', () => run('make')); revoke.addEventListener('click', () => run('revoke'));
    refresh.addEventListener('click', () => run('refresh')); paint();
    return section;
  }
  const api = {validCode, publicCode, readonly, controls}; root.WFCommunityGameCodes = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
