"""N5 opt-in config parser and exact own-ball PF liveness guard."""
from dual_pf.common import HEAD, field, at
from dual_pf_preload.code import class_q, ASSETS, MAP

BALL = 'pinball.scene.battle.battle.squad.ball::BallImpl'
SQUAD = 'pinball.scene.battle.battle.squad::SquadImpl'


def config(e, x, parse):
    # this=ball; member=1; row/string/parts=2; interval=3.
    q = e.q
    return HEAD + [
        *field(1, 'logicAssets', q), ('getlex', class_q(e, 'CustomAbilityStringTable')),
        ('callproperty', q(ASSETS + 'getMasterTableMaybe'), 1), ('setlocal_2',),
        ('getlocal_2',), ('iffalse', 'NONE'),
        ('getlocal_2',), ('callproperty', q('get_data'), 0),
        e.string('wfx_summon_flip_pf_'), ('getlocal_0',),
        ('callproperty', q('getMultiballId'), 0), ('convert_s',), ('add',),
        ('callproperty', q(MAP + 'getMaybe'), 1), ('setlocal_2',),
        ('getlocal_2',), ('iffalse', 'NONE'),
        ('getlex', q(BALL)), *field(2, 'string', q), ('callproperty', parse, 1), ('returnvalue',),
        ('label', 'NONE'), ('pushbyte', 255), ('returnvalue',),
    ]


def interval(e, x):
    # static: string=1; parts=2; canonical nonnegative int=3.
    q = e.q
    return HEAD + [
        ('getlocal_1',), ('iffalse', 'NONE'),
        ('getlocal_1',), e.string(':'),
        ('callproperty', q('http://adobe.com/AS3/2006/builtin::split'), 1), ('setlocal_2',),
        *at(2, 0, x), e.string('1'), ('ifstrictne', 'NONE'),
        *field(2, 'length', q), ('pushbyte', 1), ('ifne', 'INTERVAL'),
        ('pushbyte', 0), ('returnvalue',),
        ('label', 'INTERVAL'), *field(2, 'length', q), ('pushbyte', 2), ('ifne', 'NONE'),
        *at(2, 1, x), ('convert_i',), ('setlocal_3',),
        ('getlocal_3',), ('pushbyte', 0), ('iflt', 'NONE'),
        ('getlocal_3',), ('convert_s',), *at(2, 1, x), ('ifstrictne', 'NONE'),
        ('getlocal_3',), ('returnvalue',),
        ('label', 'NONE'), ('pushbyte', 255), ('returnvalue',),
    ]



def ongoing(e, x):
    # this=ball; linked node=1; evaluator/type=2.
    q = e.q
    return HEAD + [
        *field(0, 'zoneManager', q), ('callproperty', q('getCurrentZone'), 0),
        ('getproperty', q('actionManager')), ('getproperty', q('actionEvaluatorManager')),
        ('getproperty', q('evaluators')), ('getproperty', q('h')), ('setlocal_1',),
        ('label', 'LOOP'), ('avm_label',), ('getlocal_1',), ('iffalse', 'NO'),
        *field(1, 'item', q), ('setlocal_2',), *field(1, 'next', q), ('setlocal_1',),
        ('getlocal_2',), ('callproperty', q('get_type'), 0), ('setlocal_2',),
        *field(2, 'index', q), ('pushbyte', 2), ('ifne', 'LOOP'),
        *field(2, 'params', q), ('pushbyte', 0), ('getproperty', x),
        ('getlocal_0',), ('ifstrictne', 'LOOP'),
        ('pushtrue',), ('returnvalue',),
        ('label', 'NO'), ('pushfalse',), ('returnvalue',),
    ]


def eligible(e, x):
    # this=ball; squad=1; manager=2; first member=3.
    q = e.q
    return HEAD + [
        *field(0, 'squad', q), ('setlocal_1',),
        *field(1, 'kind', q), ('getproperty', q('index')), ('pushbyte', 1), ('ifne', 'NONE'),
        *field(1, 'squadManager', q), ('setlocal_2',),
        *field(0, 'battle', q), ('getproperty', q('squadManager')),
        ('getlocal_2',), ('ifstrictne', 'NONE'),
        *field(2, 'primary', q), ('getproperty', q('squadManager')),
        ('getlocal_2',), ('ifstrictne', 'NONE'),
        ('getlocal_1',), ('callproperty', q('isActive'), 0), ('iffalse', 'NONE'),
        ('getlocal_1',), ('callproperty', q('willRemove'), 0), ('iftrue', 'NONE'),
        ('getlocal_1',), ('callproperty', q('getFirstMember'), 0), ('setlocal_3',),
        *field(3, 'index', q), ('pushbyte', 0), ('ifne', 'NONE'),
        *field(3, 'params', q), ('pushbyte', 0), ('getproperty', x), ('setlocal_3',),
        ('getlocal_3',), ('callproperty', q('isDead'), 0), ('iftrue', 'NONE'),
        *field(3, 'squadManager', q), ('getlocal_2',), ('ifstrictne', 'NONE'),
        *field(3, 'squad', q), ('getlocal_1',), ('ifstrictne', 'NONE'),
        *field(3, 'ball', q), ('getlocal_0',), ('ifstrictne', 'NONE'),
        ('getlocal_3',), ('returnvalue',),
        ('label', 'NONE'), ('pushnull',), ('returnvalue',),
    ]
