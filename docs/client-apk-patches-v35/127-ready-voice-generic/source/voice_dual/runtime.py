"""执行最终 SWF 的整方法；只替换游戏资产、音频、动画和 DSL 外围服务。"""
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parents[2] / 'run1'))
from core_combat.runtime import Harness, VM
import asm
import bodies

_lookup = VM._lookup


def lookup(obj, key):
    short = str(key).split('::')[-1]
    if isinstance(obj, str):
        if short == 'charCodeAt':
            return lambda n: ord(obj[int(n)])
        if short == 'substr':
            return lambda start, count: obj[int(start):int(start+count)]
        if short == 'indexOf':
            return obj.find
    if isinstance(obj, list) and short == 'indexOf':
        return lambda v: obj.index(v) if v in obj else -1
    return _lookup(obj, key)


VM._lookup = lookup
NONE = {'index': 1, 'params': []}


def some(v):
    return {'index': 0, 'params': [v]}


class World(Harness):
    def __init__(self, abc, custom=None, loaded=True, overrides=None):
        super().__init__(abc, loaded=loaded, overrides=overrides)
        self.custom, self.reads, self.sounds, self.events = custom or {}, [], [], []
        self.lex.update({
            'Battle': {}, 'CustomAbilityStringTable': 'CustomAbilityStringTable',
            'BattleSoundMode': {'Me': 0}, 'ZoneManager': 'ZoneManager',
            'EffectKind': {'Simple': lambda *x: x},
            'SimpleEffectKind': {k: (lambda *x: x) for k in ['SkillReady', 'SkillReadyTop1', 'SkillReadyTop2', 'SkillReadyTop3']},
            'CutinKind': {'ActionSkill': lambda *x: x},
            'CutinActionSkillKind': {'Single': lambda *x: x, 'Double': lambda *x: x},
            'ActionType': {'ActionSkill': lambda *x: x},
            'ActionKind': {'ActionSkill': lambda *x: x},
            'SLvALv': {'Slv': lambda v: v},
            'ElementKind_Impl_': {'toColorlessable': lambda v: v},
            'ActionEvaluationResolver': VM.Cls('ActionEvaluationResolver', ctor=lambda *args: {'preresolve': lambda: None}),
            'ActionSkillInnovationData': VM.Cls('ActionSkillInnovationData', ctor=lambda *args: {'transferMovementId': lambda b: None}),
        })
        for n in ('wfxPfReadString', 'wfxPfParseUInt'):
            self.lex['Battle'][n] = lambda *args, n=n: self.run('Battle$/' + n, self.lex['Battle'], *args)

    def maybe(self, cls):
        self.reads.append(('table', cls))
        if not self.loaded:
            return None
        def exists(k):
            self.reads.append(('exists', k))
            return k in self.custom
        def get(k):
            self.reads.append(('get', k))
            return {'string': self.custom[k]}
        return {'_type': 'CustomAbilityStringTable', 'get_data': lambda: {'exists': exists, 'get': get}}

    def character(self, code, files=()):
        files = set(files)
        asset = {'getMasterTableMaybe': self.maybe, 'existsVoiceFileReader': files.__contains__}
        char = {'mainCharacterStringId': code, 'logic': {'logicAssets': asset},
                'selfActionSkill': {'get_program': lambda: {'params': [0, None]}, 'get_switchingProgram': lambda: None},
                'skillVoicePaths': ['normal_skill'], 'switchedSkillVoicePaths': ['fever_skill'],
                'skillReadyVoicePath': some(f'character/{code}/voice/battle/skill_ready'),
                'switchedSkillReadyVoicePath': some(f'character/{code}/voice/battle/matched_skill_ready'),
                'getUnisonCharacter': lambda: NONE, 'getSkillCutinImagePath': lambda: 'cutin',
                'getSelfActionSkillName': lambda: 'skill', 'mainActionSkillReference': {'ownerLevel': 1, 'actionSkillLevel': 1},
                'element': 1, 'controlBoardImagePath': 'board'}
        self.bind(char, 'CalculatedBattleCharacterLogic', ['wfxUsesFeverVoice'])
        return char

    def hud(self, code, files=(), fever=False, gameplay=False):
        char = self.character(code, files)
        obj = {'character': char, 'featuresPermit': {'displaysMemberStatus': True, 'playsSkillReady': True},
               'playheadHealthPointGaugeGlowAnimation': {'advanceFrame': lambda: None},
               'getSkillPointCycleInt': lambda: 1, 'prevSkillPointCycle': 0, 'hasKnockedOut': lambda: False,
               'features': {'skillEnabled': True}, 'member': {'index': 0, 'resolveConditionalKind': lambda *a: object() if gameplay else None},
               'gear': {'absorb': lambda *a: {'isFeverMode': lambda: fever}},
               'viewOrder': {'playSoundEffect': lambda *a: self.sounds.append(a[-1])},
               'effectManager': {'show': lambda *a: None}, 'geraldReadyNext': 0,
               'wtsReadyNormalNext': 0, 'wtsReadyFeverNext': 0}
        return obj

    def update(self, hud):
        hud['prevSkillPointCycle'] = 0
        self.run('HudMemberStatus/update', hud)
        return self.sounds[-1] if self.sounds else None

    def invoke(self, code, fever=False, gameplay=False):
        char = self.character(code)
        member = {'resolveConditionalKind': lambda *a: {'params': [0, None]} if gameplay else None,
                  'index': 0, 'x': 0, 'y': 0, 'originMemberIndex': 0, 'actionSkillExecutionCount': 0,
                  'ball': {'getMultiballId': lambda: None}, 'getSquadKind': lambda: {'index': 0},
                  'squad': {'get_summonsMultiballCount': lambda: None}, 'startSkillCutinAnimation': lambda p: None}
        zone = {'isFeverMode': lambda: fever, 'getCurrentZone': lambda: {}}
        manager = {'zoneManager': zone, 'viewOrder': {'playSoundEffect': lambda *a: self.sounds.append(a[-1])},
                   'skillVoiceRandom': {'randomRange': lambda *a: 0}, 'skillChainManager': {'createSkillChain': lambda v: None},
                   'camera': {'getX': lambda: 0, 'getY': lambda: 0}, 'cutinManager': {'show': lambda v: None},
                   'battle': {'zoneManager': zone}, 'primary': {'ball': {}, 'invokeActionSkill': lambda *a: None},
                   'stopForSkillCutin': lambda *a: None}
        self.run('SquadManagerImpl/invokeActionSkill', manager, {'character': char, 'get_member': lambda: member}, 0)
        return self.sounds[0]

    def draw(self, tags, active=()):
        calls, loaded = [], []
        def match(uid):
            calls.append(uid)
            return uid in active
        old = {'get_path': lambda: 'old', 'alpha': 0.6, 'visible': True}
        obj = {'member': {'getCharacter': lambda: {'characterTags': tags, 'mainCharacterStringId': 'hero'},
                          'matchCondition': match, 'getCharacterAnimation': lambda: 'normal', 'canDisplay': lambda: False},
               'character': old, 'asset': {'getAnimation': lambda path: loaded.append(path) or {'get_path': lambda: path}},
               'characterLayer': {'removeChild': lambda *a: None, 'addChild': lambda *a: None}, 'hide': lambda: None}
        self.bind(obj, 'MemberView', ['wfxDualFormUid'])
        self.run('MemberView/draw', obj)
        return {'uids': calls, 'loaded': loaded}

    def block(self, label, start, end, args, tail):
        code = self.overrides.get(label, asm.decode(self.abc.bodies[bodies.resolve(self.abc, label)][5]))
        ins = VM.slice_method(code, start, end, asm.assemble(tail))
        return VM.Interp(self.abc, self.lex).run(ins, args)
