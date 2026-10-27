"""执行完整显示/计数及状态查询字节码；仅集合、字符串和主表边界用夹具。"""
import copy
import functools
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2] / 'run1'))
from core_combat.runtime import Harness, VM

LIST = 'MemberImpl/getConditionsIncludingOuterEnvironments'
TOTAL = 'MemberImpl/getTotalConditions'
SPEC = 'ConditionSlot$/wfxSpec'
ROWS = 'ConditionSlot/wfxRows'

# 复用第一轮解释器，补充真实方法调用的 AS3 内建；不实现任何过滤判断。
_base_lookup = VM._lookup


def _lookup(obj, key):
    short = key.split('::')[-1] if isinstance(key, str) else key
    if isinstance(obj, str) and short == 'indexOf':
        return lambda value, start=0: obj.find(value, max(0, start))
    if isinstance(obj, str) and short == 'substr':
        return lambda start, count=None: obj[start:] if count is None else obj[start:start + count]
    if isinstance(obj, str) and short == 'charCodeAt':
        return lambda index: ord(obj[index]) if 0 <= index < len(obj) else float('nan')
    if isinstance(obj, list):
        if short == 'concat':
            return lambda other: obj + other
        if short == 'sort':
            return lambda compare: obj.sort(key=functools.cmp_to_key(compare))
    return _base_lookup(obj, key)


VM._lookup = _lookup


class Parts(list):
    """记录 wfxSpec 实际读取的分段下标，不拦截或替代字节码逻辑。"""
    def __init__(self, values, reads):
        super().__init__(values)
        self.reads = reads

    def __getitem__(self, key):
        self.reads.append(key)
        return super().__getitem__(key)


class StringProbe(str):
    def __new__(cls, value, reads):
        result = super().__new__(cls, value)
        result.reads = reads
        return result

    def split(self, sep=None):
        return Parts(super().split(sep), self.reads)


def _iterator(ordered):
    state = [0]

    def next_item():
        key = ordered['_keys'][state[0]]
        state[0] += 1
        return ordered['get'](key)

    return {'hasNext': lambda: state[0] < len(ordered['_keys']), 'next': next_item}


def plain(value):
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items() if not callable(item)}
    if isinstance(value, list):
        return [plain(item) for item in value]
    return value


class World(Harness):
    def __init__(self, abc, table=None, loaded=True, overrides=None):
        super().__init__(abc, table, loaded, overrides)
        self.executed, self.events, self.parts_reads = set(), [], []
        self.lex['OrderedMapIterator'] = VM.Cls('OrderedMapIterator', ctor=_iterator)
        self.logic_asset = {'getMasterTable': self._display_table}

    def run(self, label, this, *args):
        self.executed.add(label)
        self.events.append(label)
        return super().run(label, this, *args)

    def _display_table(self, cls):
        self.events.append('asset.getMasterTable')
        if not self.loaded:
            return None

        def get_row(uid):
            self.events.append('display.table.get:' + str(uid))
            return {'string_id': self.table[uid]} if uid in self.table else None

        return {'get_data': lambda: {'get': get_row}}

    def slot(self, *args, **kwargs):
        result = super().slot(*args, **kwargs)
        ordered = result['conditions']
        ordered['get'] = ordered['map']['h'].get
        result['_sortByAddedTime'] = None
        self.bind(result, 'ConditionSlot', ['getConditionsIncludingOuterEnvironments',
                  'getTotalNumberOfConditionsIncludingOuterEnvironments',
                  'getTotalNumberOfConditions', 'sortByAddedTime',
                  'getConditionAccumulationCount', '_getConditionAccumulationCount'])
        return result

    def condition(self, uid, layers=1, stackable=True, content=31, hostile=False,
                  direction=1, tag=None, added=0, initial=False):
        result = super().condition(uid, layers, stackable, content, hostile, direction)
        result.update(_fixture_tag=str(uid) if tag is None else tag,
                      addedTime=added, isQuestInitial=initial)
        return result

    def member_for_display(self, conditions=(), outer=(), invisible=(), outer_invisible=()):
        squad = self.slot(outer) if outer or outer_invisible else None
        if squad is not None:
            squad['invisibleSlot'] = self.slot(outer_invisible, invisible=True)
        slot = self.slot(conditions, squad=squad)
        slot['invisibleSlot'] = self.slot(invisible, invisible=True)
        member = {'conditionSlot': slot, 'logicAssets': self.logic_asset}
        self.bind(member, 'MemberImpl', ['getConditionsIncludingOuterEnvironments', 'getTotalConditions'])
        return member


def state(member):
    slot = member['conditionSlot']
    result = {}
    slots = [('own', slot), ('invisible', slot['invisibleSlot'])]
    if slot['squadSlot']['index'] == 0:
        squad = slot['squadSlot']['params'][0]
        slots.extend([('squad', squad), ('squad_invisible', squad['invisibleSlot'])])
    for name, current in slots:
        ordered = current['conditions']
        result[name] = {'keys': list(ordered['_keys']),
                        'condition_ids': [id(ordered['map']['h'][key]) for key in ordered['_keys']],
                        'values': [plain(ordered['map']['h'][key]) for key in ordered['_keys']]}
    return result


def observe(world, member, label):
    before = copy.deepcopy(state(member))
    start = len(world.events)
    try:
        value = world.run(label, member)
        if label == LIST:
            source = {item['_fixture_tag']: item for area in state(member).values()
                      for item in area['values']}
            assert all(item['_fixture_tag'] in source for item in value)
            values = [item['_fixture_tag'] for item in value]
            # 指令必须返回原状态对象，不能通过复制或重建状态改变身份。
            known_ids = {i for area in before.values() for i in area['condition_ids']}
            assert all(id(item) in known_ids for item in value)
        else:
            values = value
        outcome = {'status': 'value', 'value': values}
    except Exception as exc:
        outcome = {'status': 'error', 'error': type(exc).__name__, 'message': str(exc)}
    assert state(member) == before, '显示调用改动了状态/层数/来源或状态对象身份'
    outcome['events'] = world.events[start:]
    return outcome
