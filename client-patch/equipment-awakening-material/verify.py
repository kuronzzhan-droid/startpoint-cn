"""独立核验 equipment-awakening-material 输出 SWF：结构、字节级保持、可复现、行为矩阵、负对照与变异体。

    python -X utf8 client-patch/equipment-awakening-material/verify.py <out.swf> --base <equipment-enhanced-party-frame.swf>

行为矩阵直接执行 SWF 里的**真实字节码** ``OwnedEquipmentLogic.getUseableAwakingCrystal(repo, time)``（awaken_interp
= v1 的 look_interp，同一模块对象）。它调用的对象用替身：

* ``this``（OwnedEquipmentLogic）：``id`` / ``hasStack()`` / ``get_rarity()`` / ``logicAssets``；
* ``repo``（OwnedItemRepository）：``getEquipmentAwakingCrystal(rarity)`` 按原生 ``OwnedItemRepository.as:210-247``
  的规则挑道具（c6=6、持有数 > 0、按 c10 升序；``c11 && rarity <= c10`` 或 ``rarity == c10``）；
  ``get(id)`` 按原生构造（``ItemLogic`` 构造取 ``ItemTable.get(id)``，缺行 = null 行，随后解引用出错）；
  ``logicAssets`` 与 ``this.logicAssets`` 是同一个容器；
* 道具 ``isAvailable(time)`` 按 start ≤ time ≤ end。

探针：``getMasterTableMaybe`` 取了哪些表、``custom_ability_string`` 的 ``getMaybe`` 键、道具表的 ``getMaybe`` 键、
``repo.get`` 的 ID、原生 ``getEquipmentAwakingCrystal`` 被调用几次；假容器的 ``getMasterTable`` 一调用就报错。

负对照：同一矩阵在未打补丁的基线（equipment-enhanced-party-frame 产物 2a9583cd）上全部是原生结果，
从不访问 custom_ability_string、从不查道具表、从不调用 ``repo.get``；变异体（回落原生 / 删规范整数判定 /
删正数判定 / 删道具行判定 / 删持有数判定 / 删有效期判定 / 缺素材改给星铁钢 / 表缺失改成 None /
前缀写错 / 删行判定）必须让断言变红。
"""
from __future__ import annotations

import argparse
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


rules = _load('equipment_awakening_material_rules', HERE / 'rules.py')
awaken_interp = _load('equipment_awakening_material_interp', HERE / 'awaken_interp.py')
AvmThrow, Cls, AwakenInterp, slice_method = (awaken_interp.AvmThrow, awaken_interp.Cls, awaken_interp.AwakenInterp,
                                             awaken_interp.slice_method)

BASE_ABC_SHA = '2a9583cddd47786844b9ce5fe2b99aff4e8b5f727e95e757fded99940688a1ad'

STEEL = 10000311                  # 禁忌星铁（c6=1，不是觉醒晶）
EXPIRED = 10000398                # 替身：c6=1、有效期已过的道具
CRYSTAL4, CRYSTAL5 = 12001, 12002  # ★4 / ★5 星铁钢（c6=6）
CURSED, CURSED_LAST, PARADOX = 5910101, 5910129, 5920001
OFFICIAL5, OFFICIAL4, OFFICIAL3 = 5100020, 4100010, 3100010
RESTRICTED = tuple(range(5910101, 5910130)) + (PARADOX,)
NOW = 1_800_000_000_000.0         # getUseableAwakingCrystal 的 time 参数（毫秒）
ITEM_ROWS = {                     # 道具表：id -> 行（effect = c6，target = c10，below = c11，start/end = 有效期）
    CRYSTAL4: {'effect': 6, 'target': 4, 'below': True, 'start': 0.0, 'end': None},
    CRYSTAL5: {'effect': 6, 'target': 5, 'below': False, 'start': 0.0, 'end': None},
    STEEL: {'effect': 1, 'target': None, 'below': False, 'start': 0.0, 'end': None},
    EXPIRED: {'effect': 1, 'target': None, 'below': False, 'start': 0.0, 'end': NOW - 1},
}
HELD_ALL = {CRYSTAL4: 50, CRYSTAL5: 10000, STEEL: 4}
HELD_CRYSTALS = {CRYSTAL4: 50, CRYSTAL5: 10000}
ROWS = {rules.material_key(eid): str(STEEL) for eid in RESTRICTED}

NONE_OPTION = {'index': 1, 'params': [], '_type': 'Option'}
#: 设计上的方法体 header（maxstack, localcount, initscope, maxscope）：只多了 9 个局部。
EXPECTED_HEADERS = {rules.LABEL: [2, 14, 1, 2]}
#: 插入段允许出现的调用（callproperty 的多名全名）；getMasterTable / getEquipmentAwakingCrystal 不在其中。
ALLOWED_CALLS = {rules.MAYBE, 'get_data', 'getMaybe', 'get', 'isAvailable', 'Some'}
ALLOWED_LEX = {rules.CAS, rules.ITEM_TABLE, rules.OPTION}
EXPECTED_STRINGS = [rules.PREFIX]
RETURNS_IN_BLOCK = 2              # Some(item) / None


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def some(value):
    return {'index': 0, 'params': [value], '_type': 'Option'}


def decode(abc, label):
    return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])


# ---------------------------------------------------------------------------
# 一件装备 + 背包
# ---------------------------------------------------------------------------

class AwakenWorld:
    """``this`` = 一件持有装备；``repo`` = 背包；两张表（custom_ability_string / ItemTable）+ 探针。"""

    def __init__(self, equipment, held=None, rows=None, cas_loaded=True, items_loaded=True):
        eid, rarity, stack = equipment
        self.held = dict(HELD_ALL if held is None else held)
        self.rows = dict(ROWS if rows is None else rows)
        self.cas_loaded, self.items_loaded = cas_loaded, items_loaded
        self.maybe_tables, self.lookups, self.item_lookups, self.gets = [], [], [], []
        self.native_picks = 0
        self.cas_cls, self.item_cls = Cls(rules.CAS), Cls(rules.ITEM_TABLE)
        self.assets = {'_type': 'ILogicAssetContainer', 'getMasterTableMaybe': self.table_maybe,
                       'getMasterTable': self.forbidden}
        self.this = {'_type': 'OwnedEquipmentLogic', 'id': eid, 'logicAssets': self.assets,
                     'hasStack': lambda: stack > 0, 'get_rarity': lambda: rarity}
        self.repo = {'_type': 'OwnedItemRepository', 'logicAssets': self.assets,
                     'getEquipmentAwakingCrystal': self.native_pick, 'get': self.get}
        self.lex = {rules.OPTION: Cls(rules.OPTION, **{'None': NONE_OPTION, 'Some': some}),
                    rules.CAS: self.cas_cls, rules.ITEM_TABLE: self.item_cls}

    # -- 两张表 ------------------------------------------------------------------
    def table_maybe(self, cls):
        if cls is self.cas_cls:
            self.maybe_tables.append('CustomAbilityStringTable')
            return {'get_data': lambda: {'getMaybe': self.cas_get}} if self.cas_loaded else None
        if cls is self.item_cls:
            self.maybe_tables.append('ItemTable')
            return {'get_data': lambda: {'getMaybe': self.item_get}} if self.items_loaded else None
        raise AssertionError(f'unexpected master table {cls!r}')

    def cas_get(self, key):
        self.lookups.append(key)
        return {'string': self.rows[key]} if key in self.rows else None

    def item_get(self, key):
        self.item_lookups.append(key)
        return ITEM_ROWS.get(key) if isinstance(key, int) and not isinstance(key, bool) else None

    @staticmethod
    def forbidden(*_args):
        raise AssertionError('getMasterTable must not be called (it throws when a table is missing)')

    # -- 背包 --------------------------------------------------------------------
    def logic(self, item_id):
        """OwnedItemLogic：ItemLogic 构造 values = ItemTable.get(id)（缺行 null）后立即读 values.select_bonus_id。"""
        row = ITEM_ROWS.get(item_id)
        if row is None:
            raise AvmThrow({'code': 'TypeError', 'message': f'ItemLogic({item_id}): values is null'})
        return {'_type': 'OwnedItemLogic', 'id': item_id, 'number': self.held.get(item_id, 0),
                'isAvailable': lambda t, r=row: r['start'] <= t and (r['end'] is None or t <= r['end'])}

    def get(self, item_id):
        self.gets.append(item_id)
        return self.logic(item_id)

    def native_pick(self, rarity):
        """OwnedItemRepository.getEquipmentAwakingCrystal(rarity)：只看稀有度，不看装备 ID。"""
        self.native_picks += 1
        found = [self.logic(i) for i, r in ITEM_ROWS.items() if r['effect'] == 6 and self.held.get(i, 0) > 0]
        found.sort(key=lambda item: ITEM_ROWS[item['id']]['target'])
        for item in found:
            row = ITEM_ROWS[item['id']]
            if (row['below'] and rarity <= row['target']) or rarity == row['target']:
                return some(item)
        return NONE_OPTION

    def run(self, abc, code=None):
        code = code if code is not None else decode(abc, rules.LABEL)
        return AwakenInterp(abc, self.lex).run(code, [self.this, self.repo, NOW])

    def probe(self):
        return {'maybe_tables': list(self.maybe_tables), 'lookups': list(self.lookups),
                'item_lookups': list(self.item_lookups), 'gets': list(self.gets), 'native_picks': self.native_picks}


def outcome(value, world):
    if isinstance(value, dict) and value.get('_type') == 'Option':
        if value['index'] == 1:
            return ('None',)
        item = value['params'][0]
        return ('Some', item['id'] if isinstance(item, dict) else repr(item))
    if value is world.this:
        return ('native_entry',)
    return ('other', repr(value)[:80])


# ---------------------------------------------------------------------------
# 场景矩阵
# ---------------------------------------------------------------------------

K = rules.material_key(CURSED)
#: 非法值（客户端判「受限但值坏」→ None，绝不回落星铁钢）：值 -> 场景名后缀。
BAD_VALUES = {
    '': 'empty', None: 'null', '0': 'zero', '-1': 'negative', '+10000311': 'plus', '010000311': 'leading_zero',
    ' 10000311': 'leading_space', '10000311 ': 'trailing_space', '10000311.0': 'decimal',
    '1.0000311e7': 'exponent', hex(STEEL): 'hex', '10000311,1': 'comma', 'abc': 'text',
    '99999999999': 'overflow', '10000999': 'missing_item',
}
#: 名称: dict(equipment=(id, 稀有度, 重复数), held, rows, cas_loaded, items_loaded)
SCENARIOS = {
    'official5_offers_star_steel': dict(equipment=(OFFICIAL5, 5, 0)),
    'official4_offers_4star_steel': dict(equipment=(OFFICIAL4, 4, 0)),
    'official3_offers_4star_steel': dict(equipment=(OFFICIAL3, 3, 0)),
    'official5_no_crystal': dict(equipment=(OFFICIAL5, 5, 0), held={STEEL: 4}),
    'official5_has_stack': dict(equipment=(OFFICIAL5, 5, 1)),
    'cursed_offers_forbidden_steel': dict(equipment=(CURSED, 5, 0)),
    'cursed_last_offers_forbidden_steel': dict(equipment=(CURSED_LAST, 5, 0)),
    'paradox_offers_forbidden_steel': dict(equipment=(PARADOX, 5, 0)),
    'cursed_steel_zero_never_star_steel': dict(equipment=(CURSED, 5, 0), held=HELD_CRYSTALS),
    'cursed_nothing_held': dict(equipment=(CURSED, 5, 0), held={}),
    'cursed_has_stack_uses_stack': dict(equipment=(CURSED, 5, 2)),
    'paradox_has_stack_uses_stack': dict(equipment=(PARADOX, 5, 1), held=HELD_CRYSTALS),
    'cas_table_not_loaded_is_native': dict(equipment=(CURSED, 5, 0), cas_loaded=False),
    'item_table_not_loaded_is_none': dict(equipment=(CURSED, 5, 0), items_loaded=False),
    'expired_material_is_none': dict(equipment=(CURSED, 5, 0), rows={K: str(EXPIRED)},
                                     held={EXPIRED: 3, CRYSTAL5: 10}),
    'value_names_official_crystal': dict(equipment=(CURSED, 5, 0), rows={K: str(CRYSTAL5)}),
    'official_with_all_keys_is_native': dict(equipment=(OFFICIAL5, 5, 0), held=HELD_CRYSTALS),
}
for _value, _suffix in BAD_VALUES.items():
    SCENARIOS['bad_value_' + _suffix] = dict(equipment=(CURSED, 5, 0), rows={K: _value})

_SOME_STEEL, _NONE = ('Some', STEEL), ('None',)
_OFFICIAL = {'official5_offers_star_steel': (OFFICIAL5, ('Some', CRYSTAL5)),
             'official4_offers_4star_steel': (OFFICIAL4, ('Some', CRYSTAL4)),
             'official3_offers_4star_steel': (OFFICIAL3, ('Some', CRYSTAL4)),
             'official5_no_crystal': (OFFICIAL5, _NONE),
             'official_with_all_keys_is_native': (OFFICIAL5, ('Some', CRYSTAL5))}
_CAS, _ITEM = 'CustomAbilityStringTable', 'ItemTable'


def _restricted(key, value, item_id=STEEL, *, item_lookups=None, gets=None):
    """受限装备走完插入段：查一次 CAS，按值是否规范决定是否查道具表 / 调用 repo.get。"""
    tables = [_CAS] + ([_ITEM] if item_lookups is not None else [])
    return dict(result=value, maybe_tables=tables, lookups=[key], item_lookups=item_lookups or [],
                gets=gets or [], native_picks=0)


def _native_after_probe(key, value):
    return dict(result=value, maybe_tables=[_CAS], lookups=[key], item_lookups=[], gets=[], native_picks=1)


def _untouched(value, native_picks=0):
    return dict(result=value, maybe_tables=[], lookups=[], item_lookups=[], gets=[], native_picks=native_picks)


def _expected_table():
    out = {}
    for name, (eid, value) in _OFFICIAL.items():
        out[name] = _native_after_probe(rules.material_key(eid), value)
    out['official5_has_stack'] = _untouched(_NONE)
    for name, eid in (('cursed_offers_forbidden_steel', CURSED), ('cursed_last_offers_forbidden_steel', CURSED_LAST),
                      ('paradox_offers_forbidden_steel', PARADOX)):
        out[name] = _restricted(rules.material_key(eid), _SOME_STEEL, item_lookups=[STEEL], gets=[STEEL])
    for name in ('cursed_steel_zero_never_star_steel', 'cursed_nothing_held'):
        out[name] = _restricted(K, _NONE, item_lookups=[STEEL], gets=[STEEL])
    out['cursed_has_stack_uses_stack'] = _untouched(_NONE)
    out['paradox_has_stack_uses_stack'] = _untouched(_NONE)
    out['cas_table_not_loaded_is_native'] = dict(_untouched(('Some', CRYSTAL5), native_picks=1), maybe_tables=[_CAS])
    out['item_table_not_loaded_is_none'] = dict(_restricted(K, _NONE), maybe_tables=[_CAS, _ITEM])
    out['expired_material_is_none'] = _restricted(K, _NONE, item_lookups=[EXPIRED], gets=[EXPIRED])
    out['value_names_official_crystal'] = _restricted(K, ('Some', CRYSTAL5), item_lookups=[CRYSTAL5], gets=[CRYSTAL5])
    for value, suffix in BAD_VALUES.items():
        if suffix == 'missing_item':
            out['bad_value_' + suffix] = _restricted(K, _NONE, item_lookups=[10000999])
        else:
            out['bad_value_' + suffix] = _restricted(K, _NONE)
    return out


EXPECTED = _expected_table()
FIELDS = ('result', 'maybe_tables', 'lookups', 'item_lookups', 'gets', 'native_picks')


def expected(name):
    return dict(EXPECTED[name])


#: 原生（未打补丁）结果：按稀有度挑星铁钢；从不查表、不调用 repo.get。
def native(name):
    spec = SCENARIOS[name]
    eid, rarity, stack = spec['equipment']
    if stack > 0:
        return _untouched(_NONE)
    world = AwakenWorld(spec['equipment'], spec.get('held'), spec.get('rows'))
    option = world.native_pick(rarity)
    value = _NONE if option['index'] == 1 else ('Some', option['params'][0]['id'])
    return _untouched(value, native_picks=1)


#: 与原生结果不同（含只多查一次表）的场景。
DIFFERS_FROM_NATIVE = frozenset(name for name in SCENARIOS if expected(name) != native(name))
#: 看得见的差别：返回的道具与原生不同（原生提供星铁钢或 None，补丁改给禁忌星铁或 None）。
HITS = frozenset(name for name in SCENARIOS if expected(name)['result'] != native(name)['result'])


def run_scenario(abc, name, code=None):
    spec = SCENARIOS[name]
    world = AwakenWorld(spec['equipment'], spec.get('held'), spec.get('rows'), spec.get('cas_loaded', True),
                        spec.get('items_loaded', True))
    try:
        result = outcome(world.run(abc, code), world)
    except AvmThrow as thrown:
        value = thrown.value
        result = ('throw', value.get('code') if isinstance(value, dict) else repr(value))
    except (AssertionError, KeyError, TypeError, ValueError, AttributeError, IndexError, RecursionError) as exc:
        result = ('error', type(exc).__name__, str(exc)[:160])
    return dict(result=result, **world.probe())


def awaken_matrix(abc):
    return {name: run_scenario(abc, name) for name in SCENARIOS}


# ---------------------------------------------------------------------------
# 截断执行：只跑插入段（哨兵返回 this），未受限必须到达原生入口，受限必须自己返回
# ---------------------------------------------------------------------------

def native_entry(abc):
    """补丁体里原生入口的位置（=插入段末尾）；未打补丁时为锚点。"""
    ins = decode(abc, rules.LABEL)
    for entry in (rules.ANCHOR, rules.ANCHOR + rules.INSERTED_COUNT):
        x = ins[entry] if entry < len(ins) else None
        y = ins[entry + 1] if entry + 1 < len(ins) else None
        if x is not None and x.name == 'getlocal_1' and y is not None and y.name == 'findproperty' \
                and abc.mn_name(y.args[0]) == 'get_rarity':
            return ins, rules.ANCHOR, entry
    raise AssertionError('native entry not found')


#: 截断执行只跑「没有重复本体」的场景（有重复本体时原方法根本不进插入段）。
FALLTHROUGH_SCENARIOS = tuple(name for name, spec in SCENARIOS.items() if spec['equipment'][2] == 0)


def fallthrough_expected(name):
    """未受限（没有这一行 / 表没加载）→ 原生入口；受限 → 插入段自己返回，结果与整方法相同。"""
    want = expected(name)
    return ('native_entry',) if want['native_picks'] else want['result']


def fallthrough(abc):
    ins, at, entry = native_entry(abc)
    code = slice_method(ins, at, entry, asm.assemble([('getlocal_0',), ('returnvalue',)]))
    return {name: run_scenario(abc, name, code)['result'] for name in FALLTHROUGH_SCENARIOS}


# ---------------------------------------------------------------------------
# 静态证明：只写新局部、只调白名单、没有属性写、出口只有两处返回与原生入口；原生部分逐字节可还原
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
    """段内每条分支指令执行后、每个标签处栈都为空（线性走一遍：本段没有回跳）。"""
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
    label = rules.LABEL
    before = base_abc.bodies[bodies.resolve(base_abc, label)]
    after = out_abc.bodies[bodies.resolve(out_abc, label)]
    native_ins, patched = asm.decode(before[5]), asm.decode(after[5])
    n = len(patched) - len(native_ins)
    at = rules.ANCHOR
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
            written.add(-1)                          # 不允许任何原地改局部的指令
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
    incoming = [i for i, x in enumerate(patched) if not at <= i < entry and x.target == at]
    item = {
        'anchor': at, 'inserted': n,
        'native_restored_byte_identical': sha(restored) == locks[label]['sha'] == sha(before[5]),
        'header_before': list(before[1:5]), 'header_after': list(after[1:5]),
        'writes_only_new_locals': written == new_locals,
        'reads_only_params_and_new_locals': read <= set(rules.READS) | new_locals,
        'new_locals_start_at_old_localcount': min(new_locals) == locks[label]['header'][1] == before[2],
        'calls': sorted(calls),
        'calls_whitelisted': calls <= ALLOWED_CALLS,
        'never_calls_throwing_getter_or_native_pick': not {rules.GET_MASTER, rules.NATIVE_PICK} & calls,
        'lex': sorted(lex),
        'lex_whitelisted': lex <= ALLOWED_LEX,
        'no_property_writes': not [x for x in block if x.name in ('setproperty', 'initproperty', 'setslot', 'setsuper',
                                                                   'deleteproperty', 'setglobalslot')],
        'no_void_calls': not [x for x in block if x.name in ('callpropvoid', 'callsupervoid')],
        'stack_empty_at_every_branch': not _stack_clean_at_branches(block, out_abc),
        'strings': strings,
        'strings_expected': strings == EXPECTED_STRINGS,
        'branches_stay_in_block_or_exit_to_native_entry': all(at <= t <= entry for t in inner_targets),
        'no_outside_branch_into_block': not [i for i, x in enumerate(patched)
                                             if not at <= i < entry and (
                                                 (x.target is not None and at < x.target < entry) or
                                                 (x.cases and any(at < t < entry for t in [x.default, *x.cases])))],
        'hasstack_guard_enters_block': incoming == list(rules.INCOMING),
        'no_scope_or_exception_change': not [x for x in block if x.op in (0x1C, 0x1D, 0x30, 0x03)]
        and after[6] == before[6] == [] and after[7] == before[7],
        'returns_in_block': sum(1 for x in block if x.op in (0x47, 0x48)),
        'stack_empty_at_native_entry': _stack_empty_at(after, entry, out_abc.multinames),
    }
    item['ok'] = (n == rules.INSERTED_COUNT and item['native_restored_byte_identical']
                  and item['header_after'] == EXPECTED_HEADERS[label] and item['writes_only_new_locals']
                  and item['reads_only_params_and_new_locals'] and item['new_locals_start_at_old_localcount']
                  and item['calls_whitelisted'] and item['never_calls_throwing_getter_or_native_pick']
                  and item['lex_whitelisted'] and item['no_property_writes'] and item['no_void_calls']
                  and item['stack_empty_at_every_branch'] and item['strings_expected']
                  and item['branches_stay_in_block_or_exit_to_native_entry']
                  and item['no_outside_branch_into_block'] and item['hasstack_guard_enters_block']
                  and item['no_scope_or_exception_change']
                  and item['returns_in_block'] == RETURNS_IN_BLOCK and item['stack_empty_at_native_entry'])
    return {label: item, 'ok': item['ok']}


# ---------------------------------------------------------------------------
# 结构 / 保持 / 复现
# ---------------------------------------------------------------------------

def _independent():
    return _load('equipment_awakening_material_independent_abc', PATCH_ROOT / 'rank-scene-p2/independent/myabc.py')


def stacked_labels():
    """叠加链上必须逐字节不变的既有补丁方法体：编成槽框补丁登记的整条叠加链 + 它自己的体。"""
    party_verify = _load('equipment_enhanced_party_frame_verify', PATCH_ROOT / 'equipment-enhanced-party-frame/verify.py')
    return tuple(party_verify.stacked_labels()) + tuple(party_verify.rules.TARGETS)


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
    overlay = _load('equipment_awakening_material_overlay', HERE / 'overlay.py')
    rebuilt = SwfAbc(base_path)
    overlay.patch_editor(rebuilt)
    return rebuilt.abc.serialize() == out.abc.serialize()


# ---------------------------------------------------------------------------
# 变异体（负对照）
# ---------------------------------------------------------------------------

def _drop(sequence, occurrence=0):
    """删掉插入段里第 occurrence 处与 sequence 完全相同的连续片段（找不到就报错，变异体不许静默落空）。"""
    def mutate(e, label, code):
        seq = sequence(e)
        hits = [i for i in range(len(code) - len(seq) + 1) if code[i:i + len(seq)] == seq]
        if len(hits) <= occurrence:
            raise AssertionError(f'{label}: mutant sequence not found: {seq}')
        i = hits[occurrence]
        return code[:i] + code[i + len(seq):]
    return mutate


def _replace(old, new):
    """把插入段里唯一一处 old 片段换成 new。"""
    def mutate(e, label, code):
        a, b = old(e), new(e)
        hits = [i for i in range(len(code) - len(a) + 1) if code[i:i + len(a)] == a]
        if len(hits) != 1:
            raise AssertionError(f'{label}: expected one {a}, found {hits}')
        i = hits[0]
        return code[:i] + b + code[i + len(a):]
    return mutate


L = rules.LOCALS

MUTANTS = {
    # 值坏了回落原生：受限装备又被提供星铁钢
    'fallback_native_on_bad_value': _replace(
        lambda e: [('getlocal', L['text']), ('ifstrictne', 'NONE')],
        lambda e: [('getlocal', L['text']), ('ifstrictne', 'NATIVE')]),
    # 删掉规范整数判定：前导 0 / 正号 / 空白 / 小数 / 指数 / 十六进制都被当成禁忌星铁
    'drop_canonical_check': _drop(lambda e: [('getlocal', L['item_id']), ('convert_s',), ('getlocal', L['text']),
                                             ('ifstrictne', 'NONE')]),
    # 删掉正数判定：0 / 负数也去查道具表
    'drop_positive_check': _drop(lambda e: [('getlocal', L['item_id']), ('pushbyte', 0), ('ifngt', 'NONE')]),
    # 删掉道具行判定：指向不存在的道具时 repo.get 构造出错
    'drop_item_row_check': _drop(lambda e: [('getlocal', L['items']), ('callproperty', e.q('get_data'), 0),
                                            ('getlocal', L['item_id']), ('callproperty', e.q('getMaybe'), 1),
                                            ('iffalse', 'NONE')]),
    # 删掉持有数判定：没有禁忌星铁也提供它
    'drop_number_check': _drop(lambda e: [('getlocal', L['item']), ('getproperty', e.q('number')), ('pushbyte', 0),
                                          ('ifngt', 'NONE')]),
    # 删掉有效期判定
    'drop_available_check': _drop(lambda e: [('getlocal', L['item']), ('getlocal_2',),
                                             ('callproperty', e.q('isAvailable'), 1), ('iffalse', 'NONE')]),
    # 禁忌星铁用完就回落原生：提供星铁钢（违背「只能用本体或新材料」）
    'star_steel_when_out': _replace(
        lambda e: [('getlocal', L['item']), ('getproperty', e.q('number')), ('pushbyte', 0), ('ifngt', 'NONE')],
        lambda e: [('getlocal', L['item']), ('getproperty', e.q('number')), ('pushbyte', 0), ('ifngt', 'NATIVE')]),
    # 表没加载改成 None：官方装备也觉醒不了
    'cas_missing_to_none': _replace(lambda e: [('getlocal', L['table']), ('iffalse', 'NATIVE')],
                                    lambda e: [('getlocal', L['table']), ('iffalse', 'NONE')]),
    # 前缀写错：受限装备查不到行，回落原生
    'wrong_prefix': _replace(lambda e: [e.string(rules.PREFIX)], lambda e: [e.string('awakening_materials_')]),
    # 删掉行判定：官方装备的 null 行被解引用
    'drop_row_guard': _drop(lambda e: [('getlocal', L['row']), ('iffalse', 'NATIVE')]),
}
_BAD_CANONICAL = ['bad_value_plus', 'bad_value_leading_zero', 'bad_value_leading_space', 'bad_value_trailing_space',
                  'bad_value_decimal', 'bad_value_exponent', 'bad_value_hex']
#: 每个变异体至少要让这些场景变红（其余变红项也记录）。
MUTANT_TARGETS = {
    'fallback_native_on_bad_value': ['bad_value_empty', 'bad_value_null', 'bad_value_text', 'bad_value_overflow'],
    'drop_canonical_check': _BAD_CANONICAL,
    'drop_positive_check': ['bad_value_zero', 'bad_value_negative'],
    'drop_item_row_check': ['bad_value_missing_item'],
    'drop_number_check': ['cursed_steel_zero_never_star_steel', 'cursed_nothing_held'],
    'drop_available_check': ['expired_material_is_none'],
    'star_steel_when_out': ['cursed_steel_zero_never_star_steel'],
    'cas_missing_to_none': ['cas_table_not_loaded_is_native'],
    'wrong_prefix': ['cursed_offers_forbidden_steel', 'paradox_offers_forbidden_steel',
                     'cursed_steel_zero_never_star_steel'],
    'drop_row_guard': ['official5_offers_star_steel', 'official4_offers_4star_steel'],
}


def red_assertions(abc):
    """在给定 ABC 上跑矩阵，返回所有与期望不符的场景名。"""
    results = awaken_matrix(abc)
    return [name for name in SCENARIOS if results[name] != expected(name)]


def mutant_matrix(base_path: Path):
    overlay = _load('equipment_awakening_material_overlay', HERE / 'overlay.py')
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
    results = awaken_matrix(out.abc)
    report['matrix_size'], report['hit_count'] = len(results), len(HITS)
    report['differs_from_native_count'] = len(DIFFERS_FROM_NATIVE)
    report['mismatches'] = {k: [results[k], expected(k)] for k in SCENARIOS if results[k] != expected(k)}
    report['never_calls_get_master_table'] = True          # AwakenWorld.forbidden 一调用就让场景报错
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
        native_results = awaken_matrix(base.abc)
        report['negative_control'] = {
            'hits_passing_on_base': sorted(k for k in DIFFERS_FROM_NATIVE if native_results[k] == expected(k)),
            'base_not_native': {k: [native_results[k], native(k)] for k in SCENARIOS
                                if native_results[k] != native(k)},
            'base_touches_tables_or_repo_get': sorted(k for k, v in native_results.items()
                                                      if v['maybe_tables'] or v['lookups'] or v['item_lookups']
                                                      or v['gets']),
        }
        neg = report['negative_control']
        ok = ok and report['base_abc_sha256'] == BASE_ABC_SHA and report['preservation']['ok'] \
            and report['static_proof']['ok'] and report['reproducible_from_base'] \
            and not any(neg.values())
        if mutants:
            report['mutants'] = mutant_matrix(base_path)
            ok = ok and all(m['red_count'] and m['targets_red'] for m in report['mutants'].values())
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
