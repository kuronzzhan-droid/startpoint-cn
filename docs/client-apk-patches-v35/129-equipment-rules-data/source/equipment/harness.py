"""使用前两轮解释器执行完整方法，外部资产/对象工厂只提供受控边界。"""
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parents[2] / 'run2'))
from party.runtime import Harness, VM, some, none

OLD = ['wfIsCursedSoul', 'wfIsDecaySoul', 'wfCountEquipment', 'wfTierAbility',
       'wfEquipmentRule', 'wfPreloadEquipmentTiers', 'wfxPartyRead']
NEW = ['wfxEquipmentConfig', 'wfxEquipmentParam']


class World(Harness):
    def __init__(self, abc, table=None, loaded=True, soul_keys=(), enh_keys=()):
        super().__init__(abc, table, loaded)
        self.keys = {'AbilitySoulTable': set(soul_keys),
                     'EquipmentEnhancementAbilityTable': set(enh_keys)}
        self.unloaded = set()
        self.table_reads = []
        self.asset['getMasterTable'] = self.strict_master
        for name in self.keys:
            self.lex[name] = VM.Cls(name)
        self.lex['AbilitySoulAbilityLogic'] = VM.Cls('AbilitySoulAbilityLogic', self.new_soul)
        self.lex['EquipmentAbilityLogic'] = VM.Cls('EquipmentAbilityLogic', self.new_equip)
        self.lex['EquipmentEnhancementAbilityLogic'] = VM.Cls(
            'EquipmentEnhancementAbilityLogic', createForEquipment=self.new_enh)
        self.character = {'logicAssets': self.asset, 'equipment': none(),
                          'getAbilitySoulAbility': lambda: none()}
        self.bind(self.character, 'BattleCharacterLogic', OLD + NEW)

    def master(self, cls):
        if cls.name in getattr(self, 'keys', {}):
            self.table_reads.append(cls.name)
            if cls.name in self.unloaded:
                return None
            return {'get_data': lambda: {'exists': lambda key: key in self.keys[cls.name]}}
        return super().master(cls)

    def strict_master(self, cls):
        result = self.master(cls)
        if result is None:
            raise AssertionError('unsafe getMasterTable on unloaded ' + cls.name)
        return result

    def new_soul(self, number, sid, calc, is_equipment, assets):
        return {'_type': 'AbilitySoulAbilityLogic', 'number': number, 'id': int(sid),
                'power': {'calculateMethod': calc}, 'isEquipment': is_equipment,
                'logicAssets': assets}

    def new_equip(self, soul, enhancement, assets):
        return {'_type': 'EquipmentAbilityLogic', 'abilitySoulAbility': soul,
                'enhancementAbility': enhancement, 'logicAssets': assets}

    def new_enh(self, eid, current, maximum, assets):
        return {'_type': 'EquipmentEnhancementAbilityLogic', 'id': int(eid),
                'currentLevel': current, 'maxLevel': maximum, 'logicAssets': assets}

    def soul(self, sid):
        return self.new_soul(17, sid, {'index': 2}, False, self.asset)

    def equip(self, sid, enhancement=True, enh_id=None):
        soul = self.soul(sid)
        soul['isEquipment'] = True
        enh = some(self.new_enh(enh_id or sid, 3, 5, self.asset)) if enhancement else none()
        return self.new_equip(soul, enh, self.asset), soul

    def party(self, ids):
        # Order: main0.weapon, main0.soul, main1.weapon, main1.soul, ...
        items = [none() if sid is None else some({'id': sid, 'get_abilitySoulId': lambda s=sid: s}) for sid in ids]
        items += [none()] * (6 - len(items))
        return {'getBattleEquipment': lambda index: items[index * 2],
                'getAbilitySoul': lambda index: items[index * 2 + 1]}

    def call(self, name, *args):
        return self.run('BattleCharacterLogic/' + name, self.character, *args)

    def rule(self, sid, ids, weapon=False, enhancement=True):
        if weapon:
            peek, soul = self.equip(sid, enhancement)
        else:
            soul = self.soul(sid)
            peek = soul
        return self.call('wfEquipmentRule', peek, soul, self.party(ids))

    def preload(self, weapon=None, soul_id=None):
        if weapon is not None:
            peek, _ = self.equip(weapon)
            self.character['equipment'] = some({'getCurrentAbility': lambda: peek})
        if soul_id is not None:
            soul = self.soul(soul_id)
            self.character['getAbilitySoulAbility'] = lambda: some(soul)
        result = []
        self.call('wfPreloadEquipmentTiers', lambda value: result.append(summary(value)))
        return result


def summary(obj):
    if obj is None:
        return None
    if obj.get('_type') == 'EquipmentAbilityLogic':
        enh = obj['enhancementAbility']
        return {'soul': obj['abilitySoulAbility']['id'],
                'enhancement': None if enh['index'] else [enh['params'][0][k] for k in ('id', 'currentLevel', 'maxLevel')]}
    return {'soul': obj['id']}
