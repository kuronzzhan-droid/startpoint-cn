/* One visible-page heartbeat serves every statistics view; no background polling. */
((root) => {
  'use strict';
  const interval = 30000, failureDelays = [30000,60000,120000,300000];
  function normalize(value) {
    if (!value || !['totalVoters','ratingVoters','tierVoters','onlineVisitors'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)
      || value.totalVoters < Math.max(value.ratingVoters,value.tierVoters) || value.totalVoters > value.ratingVoters + value.tierVoters
      || value.presenceWindowSeconds !== 120 || typeof value.asOf !== 'string' || !Number.isFinite(Date.parse(value.asOf)))
      throw new Error('统计数据暂时不可用。');
    return Object.freeze({totalVoters:value.totalVoters,ratingVoters:value.ratingVoters,tierVoters:value.tierVoters,onlineVisitors:value.onlineVisitors,
      asOf:value.asOf,presenceWindowSeconds:value.presenceWindowSeconds});
  }
  function create({client, protocol, document, events, now = Date.now, schedule = setTimeout, cancel = clearTimeout}) {
    const listeners = new Set();
    let status = protocol === 'file:' ? 'offline' : 'loading', data = null, pending = null, timer, started = false, lastAttempt = -Infinity;
    let failures = 0, retryAt = 0, errorCode = '';
    const visible = () => document.visibilityState !== 'hidden';
    const nextAttempt = () => Math.max(lastAttempt + interval, retryAt);
    function notify() {for (const fn of listeners) {try {fn({status,data,errorCode});} catch { /* An optional view cannot interrupt the heartbeat. */ }}}
    function queue() {
      cancel(timer); timer = null;
      if (started && visible() && !pending && status !== 'offline') timer = schedule(refresh, Math.max(0, nextAttempt() - now()));
    }
    async function heartbeat() {
      try {return await client.request('/presence', {}, 'POST');}
      catch (error) {
        if (error?.status !== 428 || error?.code !== 'visitor_required') throw error;
        // A long-lived tab may outlive its cookie. Recover once, without retry loops.
        await client.config({refresh:true});
        if (!started || !visible()) return null;
        return client.request('/presence', {}, 'POST');
      }
    }
    function refresh() {
      if (!started || !visible() || pending || status === 'offline') return pending;
      // All callers, including focus and explicit refresh, honor a failed request's cooldown.
      if (now() < retryAt) {queue(); return null;}
      cancel(timer); timer = null; lastAttempt = now();
      if (!data) {status = 'loading'; notify();}
      pending = Promise.resolve().then(() => client.config()).then(() => {
        if (!started || !visible()) return null;
        return heartbeat();
      }).then(value => {
        if (!started || value === null) return;
        data = normalize(value); status = 'ready'; failures = 0; retryAt = 0; errorCode = ''; notify();
      }).catch(error => {
        if (!started) return;
        const hint = Number(error?.retryAfter ?? error?.data?.retryAfter);
        const delay = failureDelays[Math.min(failures++, failureDelays.length - 1)];
        retryAt = now() + Math.max(delay, Number.isFinite(hint) ? Math.min(300, Math.max(0,hint)) * 1000 : 0);
        errorCode = error?.code === 'database_quota_exceeded' ? 'database_quota_exceeded' : '';
        status = 'error'; notify();
      })
        .finally(() => {pending = null; queue();});
      return pending;
    }
    function wake() {
      cancel(timer); timer = null;
      if (visible()) {if (now() >= nextAttempt()) refresh(); else queue();}
    }
    const api = {
      subscribe(fn) {listeners.add(fn); fn({status,data,errorCode}); return () => listeners.delete(fn);},
      refresh,
      start() {
        if (started) return; started = true;
        events.addEventListener('focus',wake); events.addEventListener('online',wake); document.addEventListener('visibilitychange',wake);
        if (status !== 'offline') refresh();
      },
      stop() {
        started = false; cancel(timer); timer = null;
        events.removeEventListener('focus',wake); events.removeEventListener('online',wake); document.removeEventListener('visibilitychange',wake);
      },
    };
    return api;
  }
  if (typeof module !== 'undefined') module.exports = {create,normalize};
  if (!root.WFCommunity?.client || !root.document) return;
  const api = root.WFSiteStats = create({client:root.WFCommunity.client,protocol:root.location.protocol,document:root.document,events:root});
  const host = root.document.getElementById('site-presence');
  if (host) {
    const label = root.document.createElement('span'), count = root.document.createElement('strong'), note = root.document.createElement('small');
    label.textContent = '在看'; host.append(label,count,note);
    api.subscribe(({status,data,errorCode}) => {
      count.textContent = data ? `${data.onlineVisitors.toLocaleString('zh-CN')} 人` : '—';
      note.textContent = status === 'offline' ? '离线版不统计访客' : status === 'loading' ? '正在连接统计'
        : status === 'error' ? (errorCode === 'database_quota_exceeded'
          ? (data ? '今日统计额度已用尽，显示上次统计' : '今日统计额度已用尽，稍后自动重试')
          : (data ? '连接中断，显示上次统计' : '统计暂不可用')) : '最近 2 分钟活跃访客 · 每 30 秒更新';
      host.dataset.status = status;
      host.setAttribute('aria-label', `当前浏览人数 ${data ? `${data.onlineVisitors} 人` : '暂无统计'}，${note.textContent}`);
      host.title = `${note.textContent}。按匿名访客去重，同一浏览器多个标签算一人；关闭或转入后台后将在 2 分钟内不再计入。不同设备可能重复计数。`;
    });
  }
  api.start();
})(typeof window === 'undefined' ? globalThis : window);
