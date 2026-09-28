"""独立核验 equipment-sort-pin 输出 SWF：结构、字节级保持、可复现、比较矩阵、全序模拟、负对照与变异体。

    python -X utf8 client-patch/equipment-sort-pin/verify.py <out.swf> --base <equipment-awakening-material.swf>

比较矩阵直接执行 SWF 里的**真实字节码**：``EquipmentListScene.compareByEquipmentStatus`` 与
``EquipmentSelectThumbnailListRepository.sortByRarity``（sort_interp = v1 的 look_interp，同一模块对象），
每个场景两个方法 × 两个顺序（compare(a, b) 与 compare(b, a)）。替身：``this.globalLogic.getLogicAssets()`` →
一个只认 ``getMasterTableMaybe`` 的容器（``getMasterTable`` 一调用就报错）；装备是 OwnedEquipmentPeek
（``id`` / ``get_stack()`` / ``get_rarity()``）。

全序模拟：一份 70 件的背包（我方 46 件 + 官方 ★5/★4/★3 共 24 件，stack 各不相同），用真实字节码比较函数排序：
前 46 位必须按序号严格排列（PARADOX → 29 把诅咒 → 15 把深渊 → 死亡使者），其余 24 件的相对顺序与未打补丁的
基线逐项相同；比较函数在 30 件子集上两两满足反对称与传递（AS3 的不稳定排序因此不会让顺序跳动）。

负对照：同一矩阵在未打补丁的基线（equipment-awakening-material 产物 22292c21）上全部是原生结果、从不访问
custom_ability_string；变异体（删置顶判断 / 互换 -1 与 1 / 删规范整数判定 / 删正数判定 / 置顶放到第一比较键之后 /
删相等回落 / 前缀写错 / 删表判定 / p2 的序号读成 p1）必须让断言变红。
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCH_ROOT = HERE.parent
for path in (str(PATCH_ROOT / 'battle-rules'), str(PATCH_ROOT / 'abcasm')):
    if path not in sys.path:
        sys.path.insert(0, path)

import asm  # noqa: E402
import bodies  # noqa: E402
from swfabc import SwfAbc  # noqa: E402


def _load(name, path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


rules = _load('equipment_sort_pin_rules', HERE / 'rules.py')
sort_interp = _load('equipment_sort_pin_interp', HERE / 'sort_interp.py')
AvmThrow, Cls, SortInterp, slice_method = (sort_interp.AvmThrow, sort_interp.Cls, sort_interp.SortInterp,
                                           sort_interp.slice_method)

BASE_ABC_SHA = '22292c21361fa505bccd563852810e6fb1d696ae03823f05ff694a74fbdf2ec1'
METHODS = rules.TARGETS

PARADOX, DEATHBRINGER = 5920001, 5900101
CURSED = tuple(range(5910101, 5910130))
ABYSS = tuple(range(8000101, 8000116))
#: 数据合同（与 mod-tools/wf_weapon_sort_pin.py 的 PINS 逐项相同，测试核对）。
PINS = {PARADOX: 1000, **{eid: 2001 + i for i, eid in enumerate(CURSED)},
        **{eid: 3001 + i for i, eid in enumerate(ABYSS)}, DEATHBRINGER: 3100}
ROWS = {rules.pin_key(eid): str(pin) for eid, pin in PINS.items()}

#: 设计上的方法体 header（maxstack, localcount, initscope, maxscope）：两个方法相同。
EXPECTED_HEADERS = {label: [3, 12, 1, 1] for label in METHODS}
ALLOWED_CALLS = {rules.GET_LOGIC_ASSETS, rules.MAYBE, 'get_data', 'getMaybe'}
ALLOWED_LEX = {rules.CAS}
EXPECTED_STRINGS = [rules.PREFIX, rules.PREFIX]
RETURNS_IN_BLOCK = 3              # pa - pb / -1 / 1


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode(abc, label):
    return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])


# ---------------------------------------------------------------------------
# 比较环境
# ---------------------------------------------------------------------------

def peek(eid, stack=0, rarity=5):
    """OwnedEquipmentPeek：原生按全名 OwnedEquipmentPeek::get_stack / GeneralEquipmentPeek::get_rarity 调用。"""
    return {'_type': 'OwnedEquipmentPeek', 'id': eid, 'get_stack': lambda: stack, 'get_rarity': lambda: rarity,
            '_spec': (eid, stack, rarity)}


class SortWorld:
    """``this``（场景 / 仓库）+ 一张 custom_ability_string + 探针。env：ok / no_global / no_assets。"""

    def __init__(self, abc, rows=None, loaded=True, env='ok'):
        self.abc = abc
        self.rows = dict(ROWS if rows is None else rows)
        self.loaded = loaded
        self.maybe_calls, self.lookups = 0, []
        self.cls = Cls(rules.CAS)
        self.assets = {'_type': 'ILogicAssetContainer', 'getMasterTableMaybe': self.table_maybe,
                       'getMasterTable': self.forbidden}
        global_logic = None if env == 'no_global' else {
            '_type': 'GlobalLogic', 'getLogicAssets': (lambda: None) if env == 'no_assets' else (lambda: self.assets)}
        self.this = {'_type': 'EquipmentListScene', 'globalLogic': global_logic}
        self.lex = {rules.CAS: self.cls}
        self.code = {label: decode(abc, label) for label in METHODS}

    def table_maybe(self, cls):
        self.maybe_calls += 1
        if cls is not self.cls:
            raise AssertionError(f'unexpected master table {cls!r}')
        return {'get_data': lambda: {'getMaybe': self.get_maybe}} if self.loaded else None

    def get_maybe(self, key):
        self.lookups.append(key)
        return {'string': self.rows[key]} if key in self.rows else None

    @staticmethod
    def forbidden(*_args):
        raise AssertionError('getMasterTable must not be called (it throws when a table is missing)')

    def compare(self, label, a, b, code=None):
        return SortInterp(self.abc, self.lex, max_steps=10 ** 9).run(code or self.code[label], [self.this, a, b])


def native_value(label, a, b):
    """原生比较（负对照在基线字节码上逐项核对它）：一览 = stack 降序 → 稀有度降序 → id 升序；编成 = 稀有度 → id。"""
    (ia, sa, ra), (ib, sb, rb) = a['_spec'], b['_spec']
    if label == rules.LIST and sa != sb:
        return sb - sa
    if ra != rb:
        return rb - ra
    return ia - ib


def pinned_value(pa, pb):
    """补丁规则：两件都有且不等 → pa - pb；只有一件有 → ∓1；其余 None（= 原生）。"""
    if pa and pb:
        return None if pa == pb else pa - pb
    if pa:
        return -1
    if pb:
        return 1
    return None


# ---------------------------------------------------------------------------
# 场景矩阵
# ---------------------------------------------------------------------------

OFFICIAL5, OFFICIAL5B, OFFICIAL5C, OFFICIAL4 = 5100020, 5100001, 5100002, 4100010
KA = rules.pin_key(5910101)
#: 非法值（客户端当作「无序号」→ 原生）：值 -> 场景名后缀。
BAD_VALUES = {
    '': 'empty', None: 'null', '0': 'zero', '-5': 'negative', '1.5': 'decimal', '02001': 'leading_zero',
    '+2001': 'plus', ' 2001': 'leading_space', '2001 ': 'trailing_space', '2e3': 'exponent', '0x7d1': 'hex',
    '2001,1': 'comma', 'abc': 'text', '99999999999': 'overflow',
}
#: 名称: dict(a=(id, stack, rarity), b=..., pins=(pa, pb) 客户端应解析出的序号, rows, loaded, env)
SCENARIOS = {
    'cursed_stack0_before_official_stack7': dict(a=(5910101, 0, 5), b=(OFFICIAL5, 7, 5), pins=(2001, 0)),
    'paradox_before_cursed': dict(a=(PARADOX, 0, 5), b=(5910101, 3, 5), pins=(1000, 2001)),
    'abyss_last_before_deathbringer': dict(a=(8000115, 0, 5), b=(DEATHBRINGER, 2, 5), pins=(3015, 3100)),
    'cursed_last_before_abyss_first': dict(a=(5910129, 0, 5), b=(8000101, 0, 5), pins=(2029, 3001)),
    'pinned_star4_before_official_star5': dict(a=(8000101, 0, 4), b=(OFFICIAL5B, 0, 5), pins=(3001, 0)),
    'official_star4_after_pinned': dict(a=(OFFICIAL4, 5, 4), b=(5910101, 0, 5), pins=(0, 2001)),
    'official_stack_differs': dict(a=(OFFICIAL5, 3, 5), b=(OFFICIAL5B, 0, 5), pins=(0, 0)),
    'official_rarity_differs': dict(a=(OFFICIAL4, 0, 4), b=(OFFICIAL5B, 0, 5), pins=(0, 0)),
    'official_same_tier': dict(a=(OFFICIAL5C, 0, 5), b=(OFFICIAL5B, 0, 5), pins=(0, 0)),
    'table_not_loaded': dict(a=(5910101, 0, 5), b=(OFFICIAL5, 7, 5), pins=(0, 0), loaded=False),
    'no_global_logic': dict(a=(5910101, 0, 5), b=(OFFICIAL5, 7, 5), pins=(0, 0), env='no_global'),
    'no_logic_assets': dict(a=(5910101, 0, 5), b=(OFFICIAL5, 7, 5), pins=(0, 0), env='no_assets'),
    'missing_row': dict(a=(5910101, 0, 5), b=(OFFICIAL5, 7, 5), pins=(0, 0), rows={}),
    'equal_pins_fall_back_to_native': dict(a=(5910102, 0, 5), b=(5910101, 0, 5), pins=(2001, 2001),
                                           rows={KA: '2001', rules.pin_key(5910102): '2001'}),
    'one_bad_one_good': dict(a=(5910101, 0, 5), b=(5910102, 0, 5), pins=(0, 7),
                             rows={KA: '0x7d1', rules.pin_key(5910102): '7'}),
    'large_values': dict(a=(5910101, 0, 5), b=(5910102, 0, 5), pins=(999999999, 1),
                         rows={KA: '999999999', rules.pin_key(5910102): '1'}),
    'int32_max_does_not_overflow': dict(a=(5910101, 0, 5), b=(5910102, 0, 5), pins=(2147483647, 1),
                                        rows={KA: '2147483647', rules.pin_key(5910102): '1'}),
}
for _value, _suffix in BAD_VALUES.items():
    SCENARIOS['bad_value_' + _suffix] = dict(a=(5910101, 0, 5), b=(OFFICIAL5, 7, 5), pins=(0, 0), rows={KA: _value})


def _lookups(spec):
    """补丁在表可用时对 a、b 各查一次键（顺序 compare(a,b) 先 a 后 b）。"""
    if not spec.get('loaded', True) or spec.get('env', 'ok') != 'ok':
        return []
    return [rules.pin_key(spec['a'][0]), rules.pin_key(spec['b'][0])]


def expected(name):
    """{方法: (compare(a,b), compare(b,a))} + 探针。"""
    spec = SCENARIOS[name]
    a, b = peek(*spec['a']), peek(*spec['b'])
    pa, pb = spec['pins']
    out = {}
    for label in METHODS:
        ab, ba = pinned_value(pa, pb), pinned_value(pb, pa)
        out[label] = (native_value(label, a, b) if ab is None else ab, native_value(label, b, a) if ba is None else ba)
    keys = _lookups(spec)
    out['lookups'] = keys + keys[::-1]                          # 每个方法两次调用：(a,b) 与 (b,a)
    out['maybe_calls'] = 2 if spec.get('env', 'ok') == 'ok' else 0   # 表没加载时取表那一步仍然调用了
    return out


def native(name):
    spec = SCENARIOS[name]
    a, b = peek(*spec['a']), peek(*spec['b'])
    out = {label: (native_value(label, a, b), native_value(label, b, a)) for label in METHODS}
    out['lookups'], out['maybe_calls'] = [], 0
    return out


DIFFERS_FROM_NATIVE = frozenset(name for name in SCENARIOS if expected(name) != native(name))
#: 看得见的差别：至少一个方法的比较结果与原生不同。
HITS = frozenset(name for name in SCENARIOS
                 if any(expected(name)[label] != native(name)[label] for label in METHODS))


def run_scenario(abc, name, code=None):
    """每个方法各用一个新环境（探针按方法分开计，再合并成「每个方法两次调用」的形状核对）。"""
    spec = SCENARIOS[name]
    out, lookups, maybe = {}, None, None
    for label in METHODS:
        world = SortWorld(abc, spec.get('rows'), spec.get('loaded', True), spec.get('env', 'ok'))
        a, b = peek(*spec['a']), peek(*spec['b'])
        try:
            pair = (world.compare(label, a, b, code and code[label]), world.compare(label, b, a, code and code[label]))
            # 截断执行的哨兵返回 this：记作「到达原生入口」
            result = tuple('native_entry' if v is world.this else v for v in pair)
        except AvmThrow as thrown:
            value = thrown.value
            result = ('throw', value.get('code') if isinstance(value, dict) else repr(value))
        except (AssertionError, KeyError, TypeError, ValueError, AttributeError, IndexError, RecursionError) as exc:
            result = ('error', type(exc).__name__, str(exc)[:160])
        out[label] = result
        probe = (world.lookups, world.maybe_calls)
        if lookups is None:
            lookups, maybe = probe
        elif probe != (lookups, maybe):
            out['probe_mismatch_between_methods'] = [probe, (lookups, maybe)]
    out['lookups'], out['maybe_calls'] = list(lookups), maybe
    return out


def sort_matrix(abc):
    return {name: run_scenario(abc, name) for name in SCENARIOS}


# ---------------------------------------------------------------------------
# 全序模拟
# ---------------------------------------------------------------------------

def inventory():
    """70 件：我方 46 件（stack 0–3 交错）+ 官方 ★5 ×12、★4 ×8、★3 ×4（stack 0–7 交错）。输入顺序打乱且固定。"""
    ours = [(eid, (i * 7) % 4, 5) for i, eid in enumerate([PARADOX, *CURSED, *ABYSS, DEATHBRINGER])]
    official = ([(5100001 + i, (i * 5) % 8, 5) for i in range(12)] + [(4100001 + i, (i * 3) % 6, 4) for i in range(8)]
                + [(3100001 + i, i % 3, 3) for i in range(4)])
    items = ours + official
    return [items[(i * 37) % len(items)] for i in range(len(items))]


def sort_with(abc, label, items, rows=None):
    world = SortWorld(abc, rows)
    code = world.code[label]
    peeks = [peek(*spec) for spec in items]

    def cmp(a, b):
        value = world.compare(label, a, b, code)
        return (value > 0) - (value < 0)
    return [p['_spec'] for p in sorted(peeks, key=functools.cmp_to_key(cmp))]


PIN_ORDER = sorted(PINS, key=PINS.get)


def total_order(abc, base_abc=None):
    """{方法: {前 46 位按序号, 其余相对顺序 == 原生, 反对称, 传递}}。"""
    items = inventory()
    ours = set(PINS)
    report = {}
    for label in METHODS:
        got = sort_with(abc, label, items)
        head = [eid for eid, _s, _r in got[:len(PINS)]]
        rest = [spec for spec in got if spec[0] not in ours]
        native_rest = sorted(rest, key=functools.cmp_to_key(
            lambda x, y: native_value(label, peek(*x), peek(*y))))
        item = {'head_is_pin_order': head == PIN_ORDER, 'rest_is_native_order': rest == native_rest,
                'first_after_pins': got[len(PINS)][0] if len(got) > len(PINS) else None}
        if base_abc is not None:
            base_sorted = sort_with(base_abc, label, [spec for spec in items if spec[0] not in ours])
            item['rest_matches_base_bytecode'] = rest == base_sorted
        subset = items[:30]
        world = SortWorld(abc)
        code = world.code[label]
        signs = {}
        for x in subset:
            for y in subset:
                if x is y:
                    continue
                value = world.compare(label, peek(*x), peek(*y), code)
                signs[x, y] = (value > 0) - (value < 0)
        item['antisymmetric'] = all(signs[x, y] == -signs[y, x] and signs[x, y] != 0 for x, y in signs)
        item['transitive'] = all(not (signs[x, y] < 0 and signs[y, z] < 0 and signs[x, z] >= 0)
                                 for x in subset for y in subset for z in subset
                                 if x is not y and y is not z and x is not z)
        item['ok'] = all(v for k, v in item.items() if k != 'first_after_pins')
        report[label] = item
    report['ok'] = all(report[label]['ok'] for label in METHODS)
    return report


# ---------------------------------------------------------------------------
# 截断执行：只跑插入段（哨兵返回 this），原生场景必须到达原生入口，置顶场景自己返回
# ---------------------------------------------------------------------------

def fallthrough(abc):
    code = {}
    for label in METHODS:
        ins = decode(abc, label)
        entry = rules.INSERTED_COUNT if len(ins) > rules.NATIVE_LENGTHS[label] else 0
        code[label] = slice_method(ins, 0, entry, asm.assemble([('getlocal_0',), ('returnvalue',)]))
    out = {}
    for name in SCENARIOS:
        result = run_scenario(abc, name, code)
        out[name] = {label: result[label] for label in METHODS}
    return out


def fallthrough_expected(name):
    spec = SCENARIOS[name]
    pa, pb = spec['pins']
    ab, ba = pinned_value(pa, pb), pinned_value(pb, pa)
    pair = ('native_entry' if ab is None else ab, 'native_entry' if ba is None else ba)
    return {label: pair for label in METHODS}


# ---------------------------------------------------------------------------
# 静态证明
# ---------------------------------------------------------------------------

def _stack_empty_at(body_after, entry, multinames):
    """整方法可算通；在原生入口前插一条 pop 必然在该处下溢 => 所有到达原生入口的路径栈深都为 0。"""
    patched = asm.decode(body_after[5])
    asm.simulate([asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in patched],
                 body_after[3], multinames)
    probe = list(body_after)
    try:
        _code, _exc, merged = asm.splice(probe, entry, [asm.Instruction(0x29)], incoming=asm.ENTER)
        asm.simulate(merged, body_after[3], multinames)
    except asm.AsmError as exc:
        return f'stack underflow at #{entry} ' in str(exc)
    return False


def _stack_clean_at_branches(block, abc):
    targets = {x.target for x in block if x.target is not None}
    depth, dirty = 0, []
    for i, x in enumerate(block):
        if i in targets and depth:
            dirty.append(i)
            depth = 0
        pops, pushes = asm._effect(x, abc.multinames)  # noqa: SLF001
        if pops > depth:
            raise AssertionError(f'block #{i} {x.name} pops {pops} from a stack of {depth}')
        depth += pushes - pops
        if x.op in (0x47, 0x48):
            depth = 0
        if x.target is not None and depth:
            dirty.append(i)
    return dirty


def static_proof(base_abc, out_abc):
    locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))
    report = {}
    for label in METHODS:
        before = base_abc.bodies[bodies.resolve(base_abc, label)]
        after = out_abc.bodies[bodies.resolve(out_abc, label)]
        native_ins, patched = asm.decode(before[5]), asm.decode(after[5])
        n = len(patched) - len(native_ins)
        at = rules.ANCHORS[label]
        entry = at + n
        block = patched[at:entry]
        restored = asm.unsplice(after[5], at, n)
        written, read, calls, lex, strings = set(), set(), set(), set(), []
        for x in block:
            if x.op in (0x63, 0xD4, 0xD5, 0xD6, 0xD7):
                written.add(x.args[0] if x.op == 0x63 else x.op - 0xD4)
            elif x.op in (0x62, 0xD0, 0xD1, 0xD2, 0xD3):
                read.add(x.args[0] if x.op == 0x62 else x.op - 0xD0)
            elif x.op in (0x92, 0x94, 0xC2, 0xC3, 0x08, 0x32):
                written.add(-1)
            if x.name in ('callproperty', 'callpropvoid', 'callproplex', 'constructprop'):
                calls.add(out_abc.mn_name(x.args[0]))
            elif x.name in ('callsuper', 'callsupervoid', 'callmethod', 'callstatic', 'call', 'construct',
                            'constructsuper', 'newfunction', 'newclass'):
                calls.add(x.name)
            if x.name in ('getlex', 'findpropstrict', 'findproperty'):
                lex.add(out_abc.mn_name(x.args[0]))
            if x.name == 'pushstring':
                strings.append(out_abc.strings[x.args[0]].decode('utf8'))
        new_locals = set(rules.LOCALS.values())
        inner_targets = [x.target for x in block if x.target is not None]
        item = {
            'anchor': at, 'inserted': n,
            'native_restored_byte_identical': sha(restored) == locks[label]['sha'] == sha(before[5]),
            'header_before': list(before[1:5]), 'header_after': list(after[1:5]),
            'writes_only_new_locals': written == new_locals,
            'reads_only_params_and_new_locals': read <= set(rules.READS) | new_locals,
            'new_locals_start_at_old_localcount': min(new_locals) == locks[label]['header'][1] == before[2],
            'calls': sorted(calls),
            'calls_whitelisted': calls <= ALLOWED_CALLS,
            'never_calls_throwing_getters': rules.GET_MASTER not in calls,
            'lex': sorted(lex),
            'lex_whitelisted': lex <= ALLOWED_LEX,
            'no_property_writes': not [x for x in block if x.name in ('setproperty', 'initproperty', 'setslot',
                                                                       'setsuper', 'deleteproperty', 'setglobalslot')],
            'no_void_calls': not [x for x in block if x.name in ('callpropvoid', 'callsupervoid')],
            'stack_empty_at_every_branch': not _stack_clean_at_branches(block, out_abc),
            'strings': strings,
            'strings_expected': strings == EXPECTED_STRINGS,
            'branches_stay_in_block_or_exit_to_native_entry': all(at <= t <= entry for t in inner_targets),
            'no_outside_branch_into_block': not [i for i, x in enumerate(patched)
                                                 if not at <= i < entry and (
                                                     (x.target is not None and at <= x.target < entry) or
                                                     (x.cases and any(at <= t < entry
                                                                      for t in [x.default, *x.cases])))],
            'no_scope_or_exception_change': not [x for x in block if x.op in (0x1C, 0x1D, 0x30, 0x03)]
            and after[6] == before[6] == [] and after[7] == before[7],
            'returns_in_block': sum(1 for x in block if x.op in (0x47, 0x48)),
            'stack_empty_at_native_entry': _stack_empty_at(after, entry, out_abc.multinames),
        }
        item['ok'] = (n == rules.INSERTED_COUNT and item['native_restored_byte_identical']
                      and item['header_after'] == EXPECTED_HEADERS[label] and item['writes_only_new_locals']
                      and item['reads_only_params_and_new_locals'] and item['new_locals_start_at_old_localcount']
                      and item['calls_whitelisted'] and item['never_calls_throwing_getters']
                      and item['lex_whitelisted'] and item['no_property_writes'] and item['no_void_calls']
                      and item['stack_empty_at_every_branch'] and item['strings_expected']
                      and item['branches_stay_in_block_or_exit_to_native_entry']
                      and item['no_outside_branch_into_block'] and item['no_scope_or_exception_change']
                      and item['returns_in_block'] == RETURNS_IN_BLOCK and item['stack_empty_at_native_entry'])
        report[label] = item
    report['ok'] = all(report[label]['ok'] for label in METHODS)
    return report


# ---------------------------------------------------------------------------
# 结构 / 保持 / 复现
# ---------------------------------------------------------------------------

def _independent():
    return _load('equipment_sort_pin_independent_abc', PATCH_ROOT / 'rank-scene-p2/independent/myabc.py')


def stacked_labels():
    """叠加链上必须逐字节不变的既有补丁方法体：觉醒专属素材补丁登记的整条叠加链 + 它自己的体。"""
    awaken_verify = _load('equipment_awakening_material_verify', PATCH_ROOT / 'equipment-awakening-material/verify.py')
    return tuple(awaken_verify.stacked_labels()) + tuple(awaken_verify.rules.TARGETS)


def preservation(base: SwfAbc, out: SwfAbc):
    m = _independent()
    a, b = m.parse_abc(base.abc.serialize()), m.parse_abc(out.abc.serialize())
    locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))
    locked = sorted(v['index'] for v in locks.values())
    changed = [i for i, (x, y) in enumerate(zip(a['bodies'], b['bodies'])) if x != y]
    labels = {}
    for label in stacked_labels():
        try:
            index = bodies.resolve(base.abc, label)
        except asm.AsmError:
            labels[label] = 'absent'
            continue
        labels[label] = 'identical' if a['bodies'][index] == b['bodies'][index] else 'CHANGED'
    pools = {}
    for key, values in a['pools'].items():
        after = b['pools'][key]
        pools[key] = {'prefix_identical': repr(values) == repr(after[:len(values)]),
                      'appended': [v.decode('utf8', 'replace') if isinstance(v, bytes) else v
                                   for v in after[len(values):]]}
    tables = {k: a[k] == b[k] for k in ('methods', 'instances', 'classes', 'scripts', 'metadata', 'minor', 'major')}
    same_container = (base.body[:base._offset] == out.body[:out._offset]
                      and base.body[base._offset + base._length:] == out.body[out._offset + out._length:])
    appended_ok = all(v['prefix_identical'] for v in pools.values()) and \
        pools['strs']['appended'] == list(rules.ADDED_STRINGS) and \
        all(not v['appended'] for k, v in pools.items() if k != 'strs')
    return {'changed_bodies': changed, 'locked_bodies': locked, 'total_bodies': len(b['bodies']),
            'added_bodies': len(b['bodies']) - len(a['bodies']),
            'unchanged_bodies': len(a['bodies']) - len(changed),
            'tables_identical': tables, 'pools': pools, 'non_abc_tags_identical': same_container,
            'stacked_patch_bodies': labels,
            'ok': changed == locked and len(a['bodies']) == len(b['bodies']) and all(tables.values())
            and appended_ok and same_container and set(labels.values()) == {'identical'}}


def reproduce(base_path: Path, out: SwfAbc):
    overlay = _load('equipment_sort_pin_overlay', HERE / 'overlay.py')
    rebuilt = SwfAbc(base_path)
    overlay.patch_editor(rebuilt)
    return rebuilt.abc.serialize() == out.abc.serialize()


# ---------------------------------------------------------------------------
# 变异体（负对照）
# ---------------------------------------------------------------------------

def _drop(sequence, occurrence=0):
    def mutate(e, label, code):
        seq = sequence(e)
        hits = [i for i in range(len(code) - len(seq) + 1) if code[i:i + len(seq)] == seq]
        if len(hits) <= occurrence:
            raise AssertionError(f'{label}: mutant sequence not found: {seq}')
        i = hits[occurrence]
        return code[:i] + code[i + len(seq):]
    return mutate


def _replace(old, new):
    def mutate(e, label, code):
        a, b = old(e), new(e)
        hits = [i for i in range(len(code) - len(a) + 1) if code[i:i + len(a)] == a]
        if len(hits) != 1:
            raise AssertionError(f'{label}: expected one {a}, found {hits}')
        i = hits[0]
        return code[:i] + b + code[i + len(a):]
    return mutate


def _chain(*mutators):
    def mutate(e, label, code):
        for m in mutators:
            code = m(e, label, code)
        return code
    return mutate


L = rules.LOCALS


def mutant_swap_signs(e, label, code):
    """只有一件有序号时互换 -1 / 1：置顶件沉到最后。"""
    minus, plus = e.number(-1), e.number(1)
    hits = [i for i, item in enumerate(code) if item in (minus, plus)]
    if len(hits) != 2:
        raise AssertionError(f'{label}: expected -1 and 1, found {hits}')
    out = list(code)
    for i in hits:
        out[i] = plus if code[i] == minus else minus
    return out


def mutant_pin_after_first_key(e, label, code):
    """把原生第一比较键（一览 = stack，编成 = 稀有度）挪到置顶判断之前：官方重复件 / ★5 又压过置顶件。"""
    getter = e.q(rules.GET_STACK if label == rules.LIST else rules.GET_RARITY)
    first = [('getlocal_1',), ('callproperty', getter, 0), ('convert_i',),
             ('getlocal_2',), ('callproperty', getter, 0), ('convert_i',), ('ifeq', 'MUT_GO'),
             ('getlocal_2',), ('callproperty', getter, 0), ('convert_i',),
             ('getlocal_1',), ('callproperty', getter, 0), ('convert_i',), ('subtract_i',), ('returnvalue',),
             ('label', 'MUT_GO')]
    return first + list(code)


def _both(sequence_for):
    """对 PA / PB 两段各删一次同形片段（done 标签不同）。"""
    return _chain(_drop(lambda e: sequence_for(e, 'PA_DONE')), _drop(lambda e: sequence_for(e, 'PB_DONE')))


MUTANTS = {
    # 删掉置顶判断：一律原生
    'drop_pin_check': _replace(lambda e: [('getlocal', L['pa']), ('iffalse', 'NO_A')],
                               lambda e: [('jump', 'NATIVE'), ('getlocal', L['pa']), ('iffalse', 'NO_A')]),
    # 互换 -1 / 1
    'swap_signs': mutant_swap_signs,
    # 删掉规范整数判定：前导 0 / 正号 / 空白 / 小数 / 指数 / 十六进制都成了序号
    'drop_canonical_check': _both(lambda e, done: [('getlocal', L['value']), ('convert_s',), ('getlocal', L['text']),
                                                    ('ifstrictne', done)]),
    # 删掉正数判定：负数成了最前的序号
    'drop_positive_check': _both(lambda e, done: [('getlocal', L['value']), ('pushbyte', 0), ('ifngt', done)]),
    # 置顶放到第一比较键之后
    'pin_after_first_key': mutant_pin_after_first_key,
    # 删掉「相等回落原生」：同序号的两件比较结果为 0
    'drop_equal_native': _drop(lambda e: [('getlocal', L['pa']), ('getlocal', L['pb']), ('ifeq', 'NATIVE')]),
    # 前缀写错：谁都没有序号
    'wrong_prefix': _chain(_replace(lambda e: [('getlocal', L['data']), e.string(rules.PREFIX), ('getlocal_1',)],
                                    lambda e: [('getlocal', L['data']), e.string('equipment_sort_pins_'),
                                               ('getlocal_1',)]),
                           _replace(lambda e: [('getlocal', L['data']), e.string(rules.PREFIX), ('getlocal_2',)],
                                    lambda e: [('getlocal', L['data']), e.string('equipment_sort_pins_'),
                                               ('getlocal_2',)])),
    # 删掉表判定：表没加载时解引用 null
    'drop_table_guard': _drop(lambda e: [('getlocal', L['table']), ('iffalse', 'NATIVE')]),
    # p2 的序号读成 p1 的
    'pb_reads_p1': _replace(lambda e: [e.string(rules.PREFIX), ('getlocal_2',)],
                            lambda e: [e.string(rules.PREFIX), ('getlocal_1',)]),
}
_BAD_CANONICAL = ['bad_value_leading_zero', 'bad_value_plus', 'bad_value_leading_space', 'bad_value_trailing_space',
                  'bad_value_decimal', 'bad_value_exponent', 'bad_value_hex']
MUTANT_TARGETS = {
    'drop_pin_check': ['cursed_stack0_before_official_stack7', 'paradox_before_cursed',
                       'abyss_last_before_deathbringer'],
    'swap_signs': ['cursed_stack0_before_official_stack7', 'official_star4_after_pinned'],
    'drop_canonical_check': _BAD_CANONICAL,
    'drop_positive_check': ['bad_value_negative'],
    'pin_after_first_key': ['cursed_stack0_before_official_stack7', 'pinned_star4_before_official_star5'],
    'drop_equal_native': ['equal_pins_fall_back_to_native'],
    'wrong_prefix': ['cursed_stack0_before_official_stack7', 'paradox_before_cursed'],
    'drop_table_guard': ['table_not_loaded'],
    'pb_reads_p1': ['paradox_before_cursed', 'official_star4_after_pinned'],
}


def red_assertions(abc):
    results = sort_matrix(abc)
    return [name for name in SCENARIOS if results[name] != expected(name)]


def mutant_matrix(base_path: Path):
    overlay = _load('equipment_sort_pin_overlay', HERE / 'overlay.py')
    out = {}
    for name, mutate in MUTANTS.items():
        swf = SwfAbc(base_path)
        overlay.patch_editor(swf, mutate=mutate)
        red = red_assertions(swf.abc)
        out[name] = {'red': red, 'red_count': len(red),
                     'targets_red': all(t in red for t in MUTANT_TARGETS[name])}
    return out


# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------

def verify(out_path, base_path=None, mutants=True):
    out_path = Path(out_path)
    out = SwfAbc(out_path)
    report = {'output': str(out_path), 'output_sha256': sha(out_path.read_bytes()),
              'output_abc_sha256': sha(out.abc.serialize())}
    results = sort_matrix(out.abc)
    report['matrix_size'], report['hit_count'] = len(results), len(HITS)
    report['differs_from_native_count'] = len(DIFFERS_FROM_NATIVE)
    report['mismatches'] = {k: [results[k], expected(k)] for k in SCENARIOS if results[k] != expected(k)}
    report['never_calls_get_master_table'] = True          # SortWorld.forbidden 一调用就让场景报错
    fall = fallthrough(out.abc)
    report['fallthrough_mismatches'] = {k: [v, fallthrough_expected(k)] for k, v in fall.items()
                                        if v != fallthrough_expected(k)}
    ok = not (report['mismatches'] or report['fallthrough_mismatches'])
    if base_path is not None:
        base_path = Path(base_path)
        base = SwfAbc(base_path)
        report['base_sha256'] = sha(base_path.read_bytes())
        report['base_abc_sha256'] = sha(base.abc.serialize())
        report['preservation'] = preservation(base, out)
        report['static_proof'] = static_proof(base.abc, out.abc)
        report['reproducible_from_base'] = reproduce(base_path, out)
        report['total_order'] = total_order(out.abc, base.abc)
        native_results = sort_matrix(base.abc)
        report['negative_control'] = {
            'hits_passing_on_base': sorted(k for k in DIFFERS_FROM_NATIVE if native_results[k] == expected(k)),
            'base_not_native': {k: [native_results[k], native(k)] for k in SCENARIOS
                                if native_results[k] != native(k)},
            'base_touches_custom_ability_string': sorted(k for k, v in native_results.items()
                                                         if v['maybe_calls'] or v['lookups']),
        }
        neg = report['negative_control']
        ok = ok and report['base_abc_sha256'] == BASE_ABC_SHA and report['preservation']['ok'] \
            and report['static_proof']['ok'] and report['reproducible_from_base'] and report['total_order']['ok'] \
            and not any(neg.values())
        if mutants:
            report['mutants'] = mutant_matrix(base_path)
            ok = ok and all(m['red_count'] and m['targets_red'] for m in report['mutants'].values())
    else:
        report['total_order'] = total_order(out.abc)
        ok = ok and report['total_order']['ok']
    report['ok'] = ok
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('output', type=Path)
    p.add_argument('--base', type=Path)
    p.add_argument('--no-mutants', action='store_true', help='跳过变异体（需要 --base）')
    a = p.parse_args()
    report = verify(a.output, a.base, mutants=not a.no_mutants)
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main()
