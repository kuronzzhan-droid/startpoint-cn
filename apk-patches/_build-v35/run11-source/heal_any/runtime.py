"""真实applyHeal/助手/旧队列/伤害链；仅对象外围和集合内建为夹具。"""
import math
import sys
from pathlib import Path
import bootstrap
sys.path.append(str(bootstrap.ROOT.parent/'run6'))
from heal_damage.runtime import Harness as Base, VM, enum, clean
from heal_fever.runtime import World as FeverWorld

_lookup = VM._lookup


def lookup(obj, key):
    if isinstance(obj, list) and isinstance(key, str) and key.split('::')[-1] == 'indexOf':
        def indexof(value):
            return next((i for i, item in enumerate(obj) if item is value), -1)
        return indexof
    return _lookup(obj, key)


VM._lookup = lookup


class World(Base):
    def __init__(self, abc, table=None, native_fever=False, **kw):
        super().__init__(abc, table, **kw)
        self.executed = set()
        self.lex['Math'].update(floor=math.floor, min=min, max=max)
        self.battle['__isMyBattle__'] = lambda: True
        self.primary = self.manager['primary']
        self.primary.update(members=[], isPrimary=lambda: True,
                            get_summonsMultiballCount=lambda: None)
        static = self.lex['MemberImpl']
        static.update(wfxHealAnyCTBattle=None, wfxHealAnyCTPending=None)
        for name in ['wfxHealAnyCTQueue', 'wfxHealAnyCTTick']:
            if 'MemberImpl$/'+name in self.labels:
                self.bind(static, 'MemberImpl$', [name])
        self.native_fever = FeverWorld(abc, maximum=1000, value=0) if native_fever else None
        if self.native_fever:
            def add(*args):
                self.fever.append(args)
                self.native_fever.zone['addFeverPoint'](*args)
            self.zone['addFeverPoint'] = add

    def run(self, label, this, *args):
        if hasattr(self, 'executed'):
            self.executed.add(label)
        return super().run(label, this, *args)

    def unit(self, *args, **kw):
        obj = super().unit(*args, **kw)
        obj['squad'] = self.primary
        self.primary['members'].append(enum(0, obj))
        for name in ['wfxHealAnyValue', 'wfxHealAnyDamage', 'wfxHealAnyFever',
                     'wfxHealAnyMembers', 'wfxHealAnySample', 'wfxHealAnyCTRecord']:
            if 'MemberImpl/'+name in self.labels:
                self.bind(obj, 'MemberImpl', [name])
        return obj

    def amounts(self):
        return [round(s['strength']/100000, 10) for s in self.shots]

    def fever_ratios(self):
        return [round(f[0]/100000, 10) for f in self.fever]
