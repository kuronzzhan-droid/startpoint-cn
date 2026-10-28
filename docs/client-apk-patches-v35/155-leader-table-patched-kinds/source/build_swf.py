"""Apply leader_kinds to an input SWF (method-level P-code splice only)."""
import argparse, json, sys
import bootstrap
from bootstrap import ROOT, INPUTS, sha, output_path
from framework import Editor
from swfabc import SwfAbc
import asm, bodies
from leader_kinds import patch as lk
from direct_combo_cap import patch as cc
MODS = [lk, cc]

class PatchEditor(Editor):
    def number(self, value):
        try: return super().number(value)
        except asm.AsmError: return ('pushint', self.pool.integer(value))

p = argparse.ArgumentParser(); p.add_argument('--input', default='p8'); a = p.parse_args()
src, expected = INPUTS[a.input]
assert sha(src.read_bytes()) == expected, 'unknown input'
abc = SwfAbc(src).abc
locks = {l: {'sha': sha(abc.bodies[bodies.resolve(abc, l)][5]), 'header': abc.bodies[bodies.resolve(abc, l)][1:5]} for m in MODS for l in m.TARGETS}
(ROOT / 'baseline-locks.json').write_text(json.dumps(locks, indent=2), 'utf-8')
e = PatchEditor(src, locks); detail = [m.build(e) for m in MODS]; e.apply()
raw = e.swf.serialize(); dest = output_path(ROOT / 'build' / f'{a.input}-leaderkinds.swf'); dest.write_bytes(raw)
re = SwfAbc(dest).abc; changed = set(e.report); lab = bodies.label_map(abc); kept = 0
for i, b in enumerate(abc.bodies):
    if lab.get(i) not in changed:
        assert re.bodies[i][:7] == b[:7], i; kept += 1
print(json.dumps({'out': str(dest), 'sha256': sha(raw), 'changed': {k: {kk: v[kk] for kk in ('before', 'after', 'after_header')} for k, v in e.report.items()}, 'kept': kept, 'detail': detail}, indent=1))
