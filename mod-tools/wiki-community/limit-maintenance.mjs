// Counters remain per request. Only removal of already expired rows is deferred.
export const LIMIT_MAINTENANCE_MS = 30 * 60_000;
export const LIMIT_CLEANUP_ROWS = 1000;

export function createLimitMaintenance() {
  const instances = new WeakMap();
  return async function maintainLimits(db, now) {
    let state = instances.get(db);
    if (!state) {state = {nextRun:0, pending:null}; instances.set(db,state);}
    if (state.pending) return state.pending;
    if (now < state.nextRun) return;
    const nextRun = Math.floor(now / LIMIT_MAINTENANCE_MS) * LIMIT_MAINTENANCE_MS + LIMIT_MAINTENANCE_MS;
    const job = (async () => {
      // The persisted gate arbitrates cold workers too. A losing worker writes no row.
      const lease = await db.prepare(`INSERT INTO community_maintenance(key,next_run) VALUES('limits',?)
        ON CONFLICT(key) DO UPDATE SET next_run=excluded.next_run
        WHERE community_maintenance.next_run<=? RETURNING next_run`).bind(nextRun,now).first();
      if (lease) await db.prepare(`DELETE FROM community_limits WHERE key IN (
        SELECT key FROM community_limits WHERE expires_at<=? ORDER BY expires_at LIMIT ?)`)
        .bind(now,LIMIT_CLEANUP_ROWS).run();
      state.nextRun = nextRun;
    })();
    state.pending = job;
    try {await job;} finally {if (state.pending === job) state.pending = null;}
  };
}

export const maintainLimits = createLimitMaintenance();
