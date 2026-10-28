"""Explicit raw-slot fixture shapes; never production gameplay replacements."""
import copy


def option(value=None):
    return {'_type': 'Option', 'tag': 'None' if value is None else 'Some',
            'index': 1 if value is None else 0, 'params': [] if value is None else [value]}


def condition_slot(frame=0):
    return {'_type': 'ConditionSlot', 'frameCount': frame, 'refreshIndex': 0,
        'conditions': {'_type': 'OrderedMap', '_keys': [], 'map': {'h': {}, 'rh': {}}},
        'reservedConditions': {'h': None, 'length': 0}, 'invisibleSlot': None}


def condition(name='defence', content=None):
    from enemy21_codec import CONDITION_FIELDS
    item = {name: 0 for name in CONDITION_FIELDS}
    item.update(_type='pinball.common.data.character.condition::Condition', id=name,
        content=content or {'_type': 'ConditionChangeContent', 'tag': 'DirectAttackDamageResistance', 'index': 4, 'params': [0.9]},
        endPowerFlipAcceptedLevels=[], timeLimit=600, _originalTimeLimit=600,
        maxAccumulation=1, magnificationFromPrimary=1, magnificationFromOther=1,
        cancelable=True, isEternal=False, isFromHostile=False, isQuestInitial=False,
        linkedTrialId=None, discriminationKey='defence', extensionId=None,
        statsBattleId='A', shouldCountForMission=False, blinkFrameCount=None)
    return item


def enrich(battle, zone, enemy):
    for branch in ('h', 'rh'):
        for item in (zone['enemyManager']['enemies'][branch] or {}).values():
            item.update(kind=1, x=0.0, y=60.0, z=0.0, spawnPoint=option(),
                frameCount=240, animationFrameCount=4, lastStateChangedFrameCount=236,
                enemyActionCount=1, advanceFrameCount=240, conditionSlot=condition_slot(240))
            item['reservedParalysisConditions'] = None
            if 'hitCountCheck' in item:
                item['hitCountCheck'].update(isGaugeAppeared=False, linkedConditionCount=0, prevPrevented=False)
    zone['impactManager']['calculator']['conditionChangeCalculator'] = {
        'random': {'_type': 'Xorshift', 'randomNum': -10}}
    zone['coffinManager'] = {'random': {'_type': 'Xorshift', 'randomNum': -11}}
    zone['actionManager']['actionEvaluatorManager'] = {'evaluators': {'h': None, 'length': 0}}
    return battle, zone, enemy


def detailed_fixture(count=7):
    from fp_fields_test import fixture, enum
    battle, zone, template = fixture()
    enemies = {}
    for i in range(count):
        item = copy.deepcopy(template)
        item.update(enemyId='mod_hp_pumpkin_p1_d_multi_' + str(i), kind=2,
            address=enum('EnemyAddress', 'Boss', 0, 'pumpkin', i, enum('ZoneAddress', 'ZoneAddress', 0, 0)),
            x=float(i * 15), y=80.0, stateFrame=105)
        item['conditionSlot']['conditions'] = {'_keys': ['guard', 'toString'], 'map': {
            'h': {'guard': condition()}, 'rh': {'$toString': condition('second')}}}
        item['conditionSlot']['invisibleSlot'] = condition_slot(200)
        item['conditionSlot']['invisibleSlot']['conditions'] = {'_keys': ['hidden'], 'map': {
            'h': {'hidden': condition('hidden')}, 'rh': {}}}
        item['spawnPoint'] = option({'_type': 'FunnelSpawnPointImpl', 'x': float(i), 'y': 80.0, 'available': False})
        enemies[str(i)] = item
    zone['enemyManager']['enemies'] = {'h': enemies, 'rh': {}}
    return battle, zone, next(iter(enemies.values()), None)
