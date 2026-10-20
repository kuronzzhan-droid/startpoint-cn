"""只读 v35j，固定输入哈希后把本轮原生链证据写入本 audit 目录。"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'run10' / 'vendor'))
from swfabc import SwfAbc
from common import listing
import bodies

LABELS = [
    'MemberImpl/applyHeal', 'MemberImpl/wfxHealSample',
    'MemberImpl/applyRegeneration', 'MemberImpl/applyFeverDifference',
    'MemberImpl/applyImpact', 'MemberImpl/getSquadForImpact',
    'MemberImpl/isInPrimarySquad', 'MemberImpl/isHostile',
    'MemberImpl/getAdditionalDirectAttack', 'MemberImpl/scheduleDirectAttack',
    'MemberImpl/wfxMergeDirect', 'MemberImpl/wfxHealFever',
    'MemberImpl/wfxHealDamageRecord', 'MemberImpl/wfxHealDamageEmit',
    'SquadImpl/getMember', 'SquadImpl/getMemberAt', 'SquadImpl/isPrimary',
    'SquadImpl/applyImpact', 'SquadImpl/iter', 'SquadImpl/isHostile',
    'ConditionSlot/wfxRows', 'ConditionSlot/getAdditionalDirectAttack',
    'MemberAbilityTotalizerImpl/getAdditionalDirectAttack',
    'AdditionalDirectAttackContent$/getBetter',
    'FeverPointGaugeImpl/addFeverPoint', 'ZoneImpl/addFeverPoint',
    'DirectAttackScheduler/run', 'DirectAttackScheduler/schedule',
    'Battle/applyCoopCommand', 'ImpactManagerImpl/processImpactResult',
    'ImpactManagerImpl/processImpact', 'ImpactManagerImpl/mergeAndApplyImpact',
    'ImpactManagerImpl/applyImpact', 'ImpactManagerImpl/applyImpactImmediately',
    'NormalHealCalculator/calculate', 'FixedHealCalculator/calculate',
    'RatioHealCalculator/calculate', 'ContinuationRatioHealCalculator/calculate',
    'MemberImpl/applyRegenerationHandler', 'ImpactResult/toCoopCommand',
    'SquadManagerImpl/summerizeHealResult',
    'Battle/get_id', 'Battle/__isMyBattle__', 'Mate/applyImpact',
    'ImpactManagerImpl/processImpacts', 'ImpactManagerImpl/_add',
    'ImpactManagerImpl$/shouldSync', 'MemberImpl/applyCureDifference',
    'BattleScenePlayingStateImpl/distributeCoopCommand',
    'ImpactManagerImpl/add', 'ActionEvaluator/addImpactToSubject',
    'ActionEvaluator/calculateImpactId', 'ActionEvaluator/evalCommand',
]


def main():
    source = ROOT / 'run10' / 'v35j.swf'
    expected = source.with_suffix('.swf.sha256').read_text('utf-8').split()[0]
    actual = hashlib.sha256(source.read_bytes()).hexdigest()
    assert actual == expected, (actual, expected)
    abc = SwfAbc(source).abc
    folder = HERE / 'native-pcode'
    folder.mkdir(parents=True, exist_ok=True)
    rows = []
    for label in LABELS:
        index = bodies.resolve(abc, label)
        body = abc.bodies[index]
        name = label.replace('/', '__') + '.pcode.txt'
        digest = hashlib.sha256(body[5]).hexdigest()
        (folder / name).write_text(
            f'# {label}; body={index}; sha256={digest}; header={body[1:5]}\n'
            + '\n'.join(listing(abc, body[5])) + '\n', encoding='utf-8')
        rows.append({'label': label, 'body': index, 'sha256': digest,
                     'header': body[1:5], 'file': 'native-pcode/' + name})
    (HERE / 'native-evidence.json').write_text(json.dumps(
        {'input': str(source), 'sha256': actual, 'methods': rows},
        ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': True, 'methods': len(rows), 'sha256': actual}))


if __name__ == '__main__':
    main()
