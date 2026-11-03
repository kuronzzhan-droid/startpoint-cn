"""对 avm_interp 的最小测试扩展；执行 SWF 原始字节码，不替换 WFX 算法。

增加 in 指令和 AS3 集合/字符串内建；字典/数组在 AS3 中即使为空仍为真。
"""
import inspect
import math
import types
import avm_interp as original
import asm
import bodies


def _load():
    source = inspect.getsource(original)
    needle = "            elif op == 'not':\n"
    assert source.count(needle) == 1
    source = source.replace(needle,
        "            elif op == 'in':\n"
        "                obj, key = stack.pop(), stack.pop()\n"
        "                stack.append(key in obj)\n" + needle)
    source = source.replace(needle,
        "            elif op == 'hasnext2':\n"
        "                obj = regs[a[0]]\n"
        "                n = int(regs[a[1]]) + 1\n"
        "                regs[a[1]] = n\n"
        "                stack.append(n <= len(obj))\n"
        "            elif op == 'nextvalue':\n"
        "                n, obj = int(stack.pop()), stack.pop()\n"
        "                stack.append(list(obj.values())[n-1] if isinstance(obj,dict) else obj[n-1])\n" + needle)
    needle = "stack.append(float('nan') if value is None else float(value))"
    assert source.count(needle) == 1
    source = source.replace(needle, "stack.append(_to_number(value))")
    source = source.replace("                if isinstance(obj, dict):\n                    obj[short(key)] = value\n                else:\n                    setattr(obj, short(key), value)",
        "                if isinstance(obj, list):\n                    obj[int(key)] = value\n                elif isinstance(obj, dict):\n                    obj[short(key) if isinstance(key, str) else key] = value\n                else:\n                    setattr(obj, short(key), value)")
    mod = types.ModuleType('wfx_avm_runtime')
    exec(compile(source, '<avm_interp + in/AS3 conversion>', 'exec'), mod.__dict__)
    fallback = mod._lookup

    def lookup(obj, key):
        if isinstance(key, str):
            short = key.split('::')[-1]
            if isinstance(obj, str):
                if short == 'split':
                    return obj.split
                if short == 'length':
                    return len(obj)
            if isinstance(obj, list) and short == 'push':
                return obj.append
            if isinstance(obj, list) and short == 'copy':
                return obj.copy
            if isinstance(obj, list) and short == 'remove':
                return lambda key: obj.remove(key) if key in obj else False
            if isinstance(obj, list) and short == 'indexOf':
                return lambda key: next((i for i,v in enumerate(obj) if v is key),-1)
        if isinstance(obj, dict) and key in obj:
            return obj[key]
        return fallback(obj, key)

    def truthy(v):
        if isinstance(v, (dict, list, mod.Cls)):
            return True
        return False if v is None or isinstance(v, float) and math.isnan(v) else bool(v)

    def number(v):
        try:
            return 0.0 if v is None or v == '' else float(v)
        except (TypeError, ValueError):
            return math.nan

    mod._lookup, mod._truthy, mod._to_number = lookup, truthy, number
    return mod


VM = _load()
CODE_CACHE = {}


class Harness:
    """原生数据对象/边界服务替身；追加方法及关键官方方法始终执行真字节码。"""
    def __init__(self, abc, table=None, loaded=True, overrides=None):
        self.abc, self.overrides = abc, overrides or {}
        self.calls = dict(table=0, exists=0, get=0, debuff=0, query=0)
        self.table, self.loaded = table or {}, loaded
        self.lex = {
            'ConditionSlot': {'wfxSpecCache': None, 'wfxSpecAsset': None},
            'UniqueConditionTable': object(),
            'Decimal_Impl_': {'fromInt': lambda x: x * 100000, 'fromFloat': lambda x: x * 100000},
            'FloatInt_Impl_': {'fromInt': float},
            'OrCharacterGroup_Impl_': {'_new': lambda x: x},
            'MaskGeneral': {'maskBit': 137},
            'BattleConstants': {'MIN_STAT_MODIFIER_SKILL_GAUGE_CHARGING': -90000,
                                'MAX_STAT_MIDIFIER_SKILL_GAUGE_CHARGING': 100000},
            'ConditionTargetKind': {'Unique': lambda uid: uid, 'Piercing': 1, 'Flying': 2},
            'Option': {'None': {'index': 1}, 'Some': lambda a: {'index': 0, 'params': [a]}},
            'NormalAttackReferenceParameter': {'Default': 0},
            'ImpactSourceContent': {'NormalAttack': lambda a: a},
            'ImpactHitEffectPosition': {'PointOfContact': lambda a: a},
            'StringMap': {'reserved': {}},
            'ConditionTools': {'getDirection': lambda cond: cond.get('direction', {'index': 1})},
            'Math': {'NaN': math.nan},
        }
        self.asset = {'getMasterTableMaybe': self._table}
        self.lex['ConditionSlot']['wfxSpec'] = lambda uid, asset: self.run('ConditionSlot$/wfxSpec', self.lex['ConditionSlot'], uid, asset)

    def _table(self, cls):
        self.calls['table'] += 1
        if not self.loaded:
            return None
        return {'get_data': lambda: {'exists': self._exists, 'get': self._get}}

    def _exists(self, uid):
        self.calls['exists'] += 1
        return uid in self.table

    def _get(self, uid):
        self.calls['get'] += 1
        return {'string_id': self.table[uid]}  # 缺键真抛：可发现删掉 exists 守卫。

    def run(self, label, this, *args):
        code = self.overrides.get(label)
        if code is None:
            key = id(self.abc)
            if key not in CODE_CACHE:
                CODE_CACHE[key] = (self.abc, {v: k for k, v in bodies.label_map(self.abc).items()}, {})
            _, labels, decoded = CODE_CACHE[key]
            if label not in decoded:
                decoded[label] = asm.decode(self.abc.bodies[labels[label]][5])
            code = decoded[label]
        return VM.Interp(self.abc, self.lex).run(code, [this, *args])

    def bind(self, obj, cls, names):
        for name in names:
            obj[name] = lambda *args, n=name: self.run(cls + '/' + n, obj, *args)

    def condition(self, uid, layers=1, stackable=True, content=31, hostile=False, direction=1):
        cond = {'content': {'index': content, 'params': [uid]}, 'maxAccumulation': 99 if stackable else 1,
                'magnificationFromPrimary': layers, 'magnificationFromOther': layers,
                'isFromHostile': hostile, 'isQuestInitial': False, 'direction': {'index': direction}}
        self.bind(cond, 'Condition', ['get_currentAccumulation', 'get_accumulatable', 'get_magnification'])
        return cond

    def slot(self, conditions=(), invisible=False, squad=None, legacy=None):
        vals = {str(i): v for i, v in enumerate(conditions)}
        result = {'conditions': {'_keys': list(vals), 'map': {'get': vals.get, 'h': vals}},
                  'asset': self.asset, 'invisibleSlot': None,
                  'squadSlot': {'index': 1} if squad is None else {'index': 0, 'params': [squad]},
                  'get_isInvisibleSlot': lambda: invisible, 'owner': {'index': 2},
                  'exceptsReductionForStatistics': False,
                  'getConditionAccumulationCount': lambda uid: (legacy or {}).get(uid, 0),
                  'getTotalSkillGaugeCharging': lambda: 0, 'isParalytic': lambda: False}
        if not invisible:
            result['invisibleSlot'] = self.slot(invisible=True)
        self.bind(result, 'ConditionSlot', ['wfxCollect', 'wfxRows', 'wfxSum', 'wfxAbilityResistance', 'getTotalDebuffCounts'])
        return result

    def member(self, conditions=(), legacy=None, leader=False, name='other', segments=1, combo=0, debuffs=0):
        slot = self.slot(conditions)
        enemy_slot = self.slot([self.condition(0, content=0) for _ in range(debuffs)])
        enemy = {'conditionSlot': enemy_slot}
        def count():
            self.calls['debuff'] += 1
            return self.run('EnemyImpl/getTotalDebuffCounts', enemy)
        enemy['getTotalDebuffCounts'] = count
        unit = {'parent': enemy, 'enemyParts': 0}
        scheduled, counts, combos = [], [], [combo]
        def create():
            combos[0] += 1
        member = {'conditionSlot': slot, 'source': {'mainCharacterStringId': name},
                  'isLeader': lambda: leader, 'isDead': lambda: False, 'isMultiball': lambda: False,
                  'getConditionAccumulationCount': lambda uid: (legacy or {}).get(uid, 0),
                  'comboCalculator': {'getCombo': lambda: combos[0] ^ 137, 'createCombo': create},
                  'xdebugSettings': {'playerSuppressDirectAttacks': False},
                  'squad': {'kind': {'index': 0}, 'get_summonsMultiballCount': lambda: None},
                  'getAdditionalDirectAttack': lambda: {'directAttackTimes': segments, 'directAttackDamage': 50000},
                  'directAttackScheduler': {'canSchedule': lambda u: True, 'schedule': lambda *v: scheduled.append(v)},
                  'abilityTrigger': {'countUp': lambda *v: counts.append(('count', v[1:])),
                                     'oneOfEnemyCountUp': lambda *v: counts.append(('one', v[1:]))},
                  'stats': {'directAttackCount': 0, 'directAttackCountInFever': 0,
                            'maxStatModifierSkillGaugeCharging': 10**20},
                  'zoneManager': {'isFeverMode': lambda: True}, 'battle': {'__isMyBattle__': lambda: True},
                  'ball': {'x': 20, 'y': 30, 'getMultiballId': lambda: None},
                  'isInPrimarySquad': lambda: True, 'matchCondition': lambda k: False,
                  'directAttackExecutionCount': 0, 'originMemberIndex': 0, 'getElement': lambda: 1,
                  'getSquadKind': lambda: {'index': 0},
                  'abilityTotalizer': {'getTotalSkillGaugeCharging': lambda: 0}}
        self.bind(member, 'MemberImpl', ['wfxDirectFactor', 'wfxMergeDirect', 'wfxChargeCap'])
        return member, unit, scheduled, counts, combos
