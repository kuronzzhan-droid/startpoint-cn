"""Run the real patched LeaderAbilityValues parser bodies in the AVM interpreter."""
import json, sys
import bootstrap
from bootstrap import ROOT, sha
from swfabc import SwfAbc
sys.path.insert(0, str(ROOT))
from vm.test_vm import World, VM

old = VM._lookup
def lookup(obj, key):
    short = key.split('::')[-1] if isinstance(key, str) else key
    if isinstance(obj, list):
        if short == 'slice': return lambda start=0: obj[int(start):]
        if short == 'splice':
            def sp(start, count, *items):
                start, count = int(start), int(count); out = obj[start:start+count]; obj[start:start+count] = list(items); return out
            return sp
    return old(obj, key)
VM._lookup = lookup

src = ROOT / 'build' / 'p8-leaderkinds.swf'
w = World(SwfAbc(src).abc)
seen = []
w.lex['AbilityValues'] = {'parseAt109': lambda row: seen.append(('109', list(row))) or {'tag': 'AB109'},
                          'parseAt47': lambda row: seen.append(('47', list(row))) or {'tag': 'AB47'}}
checks = []
for label, col, kind, tag in [('LeaderAbilityValues$/parseAt107', 107, '422', 'AB109'), ('LeaderAbilityValues$/parseAt45', 45, '724', 'AB47')]:
    row = [f'v{i}' for i in range(124)]; row[0] = 'code'; row[col] = kind
    before = list(row); seen.clear()
    out = w.run(label, {}, row)
    assert out == {'tag': tag}, out
    assert row == before, 'master row mutated'
    got = seen[0][1]
    assert len(got) == 126 and got[0] == 'code' and got[1:3] == ['', ''] and got[3:] == row[1:], 'shift'
    assert got[col + 2] == kind
    checks.append({'parser': label, 'kind': kind, 'routed_to': tag, 'shift_ok': True, 'row_unchanged': True})
    # native kind must not route
    row[col] = '0'; seen.clear()
    try:
        w.run(label, {}, row)
    except Exception as ex:
        pass
    assert not seen, 'native kind was routed'
    checks.append({'parser': label, 'kind': '0', 'native_path': True})
print(json.dumps({'swf_sha256': sha(src.read_bytes()), 'checks': checks, 'pass': True}, ensure_ascii=False, indent=1))
