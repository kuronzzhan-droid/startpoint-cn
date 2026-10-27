"""真实724、Zone、Fever槽、状态和同步字节码；渲染与网络输出边界为夹具。"""
import sys, math
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parents[2] / 'run3'))
from superfever.runtime import Harness as Base, en, row, noop, VM


class World(Base):
    def __init__(self, abc, specs=None, state=1, maximum=100, value=0, loaded=True, overrides=None):
        super().__init__(abc, {uid: row(spec) for uid, spec in (specs or {}).items()}, loaded, overrides)
        self.lex['Math']['round'] = lambda n: math.floor(n + .5)
        self.lex['Decimal_Impl_']['RESOLTION'] = 100000
        self.lex['FloatInt_Impl_']['toFloat'] = float
        self.bind(self.lex['Decimal_Impl_'], 'Decimal_Impl_$', ['fromFloat', 'fromInt', 'toFloat', '_new'])
        self.coop = []
        self.triggers = []
        self.zone['feverPointGauge'] = en(0, self.gauge)
        self.bind(self.zone, 'ZoneImpl', ['addFeverPoint'])
        self.zone['enterFeverMode'] = lambda: self.events.append(('zone-enter-fever',))
        self.zone_manager['index'] = 2
        self.battle.update(currentFrame=123, shouldRejectImpactToEnemy=lambda: False)
        g = self.gauge
        g.update(state=en(state), feverModeCount=0, feverStartFrames=[], feverDebugStats=[],
                 battle=self.battle, zone=self.zone, zoneManager=self.zone_manager, alpha=0,
                 elapsedTimeCalculator={'rawFrame': 123}, output={'addCoopCommand': self.coop.append},
                 viewOrder={'playSoundEffect': lambda *a: self.events.append(('sound', a))},
                 abilityTotalizer={'getTotalFeverTimeExtension': lambda: 0})
        for name in ['playheadOverlayAnimation', 'playheadOverlayShadowAnimation', 'playheadGaugeAnimation']:
            g[name] = {'advanceFrame': noop, 'gotoAndPlay': noop}
        g['xdebugSettings'].update(zoneProhibitEntryToFeverMode=False, zoneSuppressFeverGaugeReduction=True)
        g['abilityTrigger']['countUp'] = lambda *a: self.triggers.append(a)
        self.bind(g, 'FeverPointGaugeImpl', ['isChangeable', 'update', 'startFever', 'extendfeverDebugStats',
                                           'enterFeverState', 'changeState', 'applySynchronize'])
        fp = g['feverPoint']; fp.update(min=0, max=maximum, value=value)
        self.bind(fp, 'ClosedInterval', ['getRatio', 'set', 'add', 'subtract', 'isMaximum', 'isMinimum'])
        self.lex.update(FeverPointGaugeState={'Fever': en(2)}, BattleSoundMode={'Me': en(0)},
                        BattleZoneCoopCommand={'FeverStart': lambda n: en(0, n)},
                        BattleCoopCommand={'OfZone': lambda i, command: en(1, i, command)})
        self.member = self.unit()
        if self.has('MemberImpl/wfxHealFever'):
            self.bind(self.member, 'MemberImpl', ['wfxHealFever'])
        self.ability_slot = {'zoneManager': self.zone_manager}

    def attach(self, uid, layers=1):
        return self.add_condition(self.member, uid, layers)

    def sample(self, eff, over):
        self.run('MemberImpl/wfxHealFever', self.member, eff, over)

    def native724(self, ratio, count=1):
        self.run('AbilitySlotImpl/applyInstantBattle', self.ability_slot, en(5, ratio * 100000), count)

    def native_add(self, points):
        self.run('AbilitySlotImpl/applyInstantBattle', self.ability_slot, en(0, points), 1)

    def snapshot(self):
        g = self.gauge
        return {'value': g['feverPoint']['value'], 'state': g['state']['index'], 'events': self.events.copy(),
                'triggers': self.triggers.copy(), 'coop': self.coop.copy(), 'count': g['feverModeCount'],
                'white': g['whiteGauge'], 'whiteStart': g['whiteGaugeStartFeverPointRate']}


