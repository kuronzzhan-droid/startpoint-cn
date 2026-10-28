"""Run the real patched MemberImpl/wfxDirectFactor body in the AVM interpreter."""
import json, sys
import bootstrap
from bootstrap import ROOT, sha
from swfabc import SwfAbc
sys.path.insert(0, str(ROOT))
from vm.test_vm import World, VM

def run(swf, rows, combo, debuff=0):
    w = World(SwfAbc(swf).abc)
    w.lex['MaskGeneral'] = {'maskBit': 0}
    this = {'conditionSlot': {'wfxRows': lambda code, flag: [list(r) for r in rows] if code == 24 else []},
            'wfxDirectTargetUnique': lambda t: 0,
            'comboCalculator': {'getCombo': lambda: combo}}
    return w.run('MemberImpl/wfxDirectFactor', this, None)

new = ROOT / 'build' / 'p8-leaderkinds.swf'; old = bootstrap.INPUTS['p8'][0]
cases = []
kyle = [[0, 15000, 0], [1, 100, 99]]
for rows, combo in [(kyle, 0), (kyle, 50), (kyle, 99), (kyle, 250), ([[0, 15000, 0], [1, 100, 0]], 250),
                    ([[1, 100, 99], [1, 200, 30]], 100), ([[0, 10000, 0]], 300), ([], 10)]:
    a, b = run(old, rows, combo), run(new, rows, combo)
    capped = [r[2] for r in rows if r[0] == 1 and r[2] > 0]
    c = min(combo, min(capped)) if capped else combo
    B = sum(r[1] for r in rows if r[0] == 0); C = sum(r[1] for r in rows if r[0] == 1)
    want = (1 if not rows else max(0, 1 + B / 10000) * (1 + C * c / 10000))
    assert abs(b - want) < 1e-9, (rows, combo, b, want)
    if not capped: assert a == b, (rows, combo, a, b)
    cases.append({'rows': rows, 'combo': combo, 'old': a, 'new': b})
print(json.dumps({'swf_sha256': sha(new.read_bytes()), 'cases': cases, 'pass': True}, ensure_ascii=False))
