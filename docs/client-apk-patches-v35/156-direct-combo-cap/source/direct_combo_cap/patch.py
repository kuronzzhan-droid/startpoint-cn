"""wfx 码24 arg1（每1连击倍率）加连击计入上限：flags>0 时连击按 min(连击, flags) 计。

v35 的 MemberImpl/wfxDirectFactor：M = max(0, 1 + (B24 + ...)/10000) * (1 + C24*combo/10000)。
这里只在三处插入：开头把上限局部变量置 0；每读到一条 arg1 行且其 flags>0 时取所有 arg1 上限里最小的；
最后相乘前若上限>0 就把 combo 钳到上限。没有 flags（旧数据都是 0）= 旧行为，任何角色都能用。
"""
from common import describe
import asm

LABEL = 'MemberImpl/wfxDirectFactor'
TARGETS = [LABEL]


def locate(e):
    b = e.body(LABEL)
    s = [describe(e.abc, x) for x in asm.decode(b[5])]
    # 1) combo 局部清零处：开头 `pushbyte [0]; setlocal_3`（combo 初值）
    init = next(i for i, t in enumerate(s) if t == 'pushbyte [0]' and s[i + 1] == 'setlocal_3 []')
    # 2) arg1 分支：`getlocal [kind]; pushbyte [1]; ifeq -> #X` 的 X，X 处是 `getlocal [C24]; getlocal [value]; add`
    j = next(i for i, t in enumerate(s) if t == 'pushbyte [1]' and s[i + 1].startswith('ifeq') and s[i - 1].startswith('getlocal ['))
    arg1 = int(s[j + 1].split('#')[1])
    c24 = s[arg1]
    assert c24.startswith('getlocal [') and s[arg1 + 2] == 'add []', s[arg1:arg1 + 4]
    # 当前行数组所在局部：分支前 `getlocal_2; getlocal [i]; getproperty <L>; setlocal [row]`
    row = next(int(s[i].split('[')[1].rstrip(']')) for i in range(j, 0, -1)
               if s[i].startswith('setlocal [') and s[i - 1].startswith("getproperty ['<mn kind 0x1b>']") and s[i - 3] == 'getlocal_2 []')
    # 3) 最后相乘：`getlocal [M]; pushbyte [1]; getlocal [C24]; getlocal_3; multiply`
    fin = next(i for i, t in enumerate(s) if t == 'pushbyte [1]' and s[i + 1] == c24 and s[i + 2] == 'getlocal_3 []' and s[i + 3] == 'multiply []') - 1
    return init, arg1, fin, row, b[2]


def install(e):
    init, arg1, fin, row, base = locate(e)
    cap, tmp = base, base + 1
    x = next(i for i, r in enumerate(e.abc.multinames) if r[0] == 0x1b)
    n = e.number
    e.insert(LABEL, init, [n(0), ('setlocal', cap)])
    e.insert(LABEL, arg1, [
        ('getlocal', row), n(2), ('getproperty', x), ('convert_i',), ('setlocal', tmp),
        ('getlocal', tmp), n(0), ('ifngt', 'DONE'),
        ('getlocal', cap), n(0), ('ifeq', 'SET'),
        ('getlocal', tmp), ('getlocal', cap), ('ifge', 'DONE'),
        ('label', 'SET'), ('getlocal', tmp), ('setlocal', cap),
        ('label', 'DONE')])
    e.insert(LABEL, fin, [
        ('getlocal', cap), n(0), ('ifngt', 'KEEP'),
        ('getlocal_3',), ('getlocal', cap), ('ifle', 'KEEP'),
        ('getlocal', cap), ('setlocal_3',),
        ('label', 'KEEP')])
    return {'init': init, 'arg1': arg1, 'final': fin, 'row_local': row, 'cap_local': cap}


def build(editor):
    where = install(editor)
    return {'capability': 'direct-combo-cap-v1', 'wfx_code': 24, 'arg': 1,
            'semantics': 'flags>0 on any arg1 row caps the combo count used by all per-combo terms (smallest positive flags wins); flags=0 unchanged',
            'where': where}
