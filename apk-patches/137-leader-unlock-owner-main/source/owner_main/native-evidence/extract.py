"""只读锁定 v35h，将本轮设计依赖的真实方法保存到 run9。"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import bootstrap
import bodies
from common import listing
from swfabc import SwfAbc


def main():
    raw = bootstrap.BASE.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == bootstrap.BASE_SHA
    abc = SwfAbc(bootstrap.BASE).abc
    labels = [
        'InitialAbilityTriggerKindTools$/matchCharacter',
        'AbilityPreconditionMasterValueTools$/resolve',
        'AbilityDisabledReasonResolver/resolve',
        'AbilityDisabledReasonResolver/resolvePrecondition',
        'AbilityDisabledReasonResolver/resolveInitial',
        'AbilityDisabledReasonResolver/resolveInstant',
        'AbilityDisabledReasonResolver/<ctor>',
        'BattleCharacterLogic/wfxPartyRead',
        'BattleCharacterLogic/wfxPartyMask',
        'BattleCharacterLogic/wfxExtraLeaders',
        'BattleCharacterLogic/getOpitionAbilitiesWithoutAbilitySoul',
        'BattleCharacterLogic/getInstantAbiltyCount',
        'BattleCharacterLogic/getInstantAbiltyCountWithoutLimit',
        'BattleCharacterLogic/getAvailableAbilitiesWithCond',
        'BattleCharacterLogic/getElement',
        'BattleCharacterLogic/get_element',
        'BattleCharacterLogic/<ctor>',
        'BattlePartyLogic/getNumberOfSameElement',
        'BattlePartyLogic/get_mainCharacters',
        'BattlePartyLogic/get_unisonCharacters',
        'BattlePartyLogic/get_allCharacters',
        'BattlePartyLogic/get_leaderCharacter',
        'BattleAbilitySource/add',
        'TriggerableAbilityDialogAllAbilitiesGenerator/addAbility',
        'AbilityLogic/get_originKind',
        'AbilityLogic/get_isUnison',
        'AbilityOriginKind$/Character',
    ]
    manifest = {'input_swf_sha256': bootstrap.BASE_SHA, 'methods': []}
    for label in labels:
        index = bodies.resolve(abc, label)
        body = abc.bodies[index]
        filename = label.replace('/', '__').replace('$', '_static').replace('<', '').replace('>', '') + '.pcode.txt'
        text = '\n'.join([f'# {label}; body={index}; header={body[1:5]}',
                           f'# code_sha256={hashlib.sha256(body[5]).hexdigest()}',
                           *listing(abc, body[5])]) + '\n'
        destination = bootstrap.output_path(Path(__file__).parent / filename)
        destination.write_text(text, encoding='utf-8')
        manifest['methods'].append({'label': label, 'body': index, 'header': body[1:5],
                                    'code_sha256': hashlib.sha256(body[5]).hexdigest(),
                                    'file': filename, 'file_sha256': hashlib.sha256(text.encode()).hexdigest()})
    bootstrap.output_path(Path(__file__).parent / 'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'methods': len(labels), 'input_sha256': bootstrap.BASE_SHA}))


if __name__ == '__main__':
    main()
