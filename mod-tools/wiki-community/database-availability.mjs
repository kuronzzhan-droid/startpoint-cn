// D1's daily account quota affects every database-backed feature. Classify only
// the known upstream error; never return raw exceptions, SQL or secret bindings.
export function quotaFailure(error, now = Date.now()) {
  const seen = new Set();
  for (let current = error, depth = 0; current && depth < 5 && !seen.has(current); current = current.cause, depth++) {
    seen.add(current);
    if (typeof current.message !== 'string' || !/D1's free tier daily row (?:read|write) limit/i.test(current.message)) continue;
    const resetAt = new Date(Math.floor(now / 86400_000) * 86400_000 + 86400_000).toISOString();
    return {error:'database_quota_exceeded',
      message:`社区今日数据库额度已用完，暂时无法读取或保存在线资料。额度将在 ${resetAt.slice(0,10)} 08:00（北京时间）重置；升级套餐后也可恢复。`,
      resetAt, retryAfter:300};
  }
  return null;
}
