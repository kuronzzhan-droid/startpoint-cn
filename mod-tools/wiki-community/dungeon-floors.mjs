// Floor ranges verified in the 2026-09-30 gray-server dungeon snapshot.
// These are guide scopes, not game quest IDs. Existing mode-wide IDs stay unchanged.
export const FLOOR_MODES = Object.freeze({
  'event-rush-700098': {count: 15, extra: 'practice'},
  'event-rush-700099': {count: 30, extra: 'endless'},
  'event-rush-700100': {count: 30, extra: 'endless'},
});

export function floorParent(id) {
  if (typeof id !== 'string') return null;
  const match = id.match(/^(event-rush-\d+)-floor-([1-9]\d*|endless|practice)$/);
  const mode = match && Object.hasOwn(FLOOR_MODES, match[1]) && FLOOR_MODES[match[1]];
  if (!mode || !(match[2] === mode.extra || (/^[1-9]\d*$/.test(match[2]) && Number(match[2]) <= mode.count))) return null;
  return match[1];
}
