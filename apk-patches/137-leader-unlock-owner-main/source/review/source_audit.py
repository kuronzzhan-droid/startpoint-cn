"""只读检查固定 v35h；证据只写本目录。"""
import hashlib
import json
import os
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(ROOT / 'run8' / 'vendor'))
import asm
import bodies
from common import ABC, abc_tags, listing

BASE = ROOT / 'run8' / 'v35h.swf'
EXPECTED = 'f1c3260d470f46a4364baddb85af48dc34a5c299bb025d123be085ad6f04e573'
TARGETS = {
    'InitialAbilityTriggerKindTools$/matchCharacter',
    'AbilityPreconditionMasterValueTools$/resolve',
    'BattleCharacterLogic/getElement',
    'BattleCharacterLogic/getInstantAbiltyCountWithoutLimit',
    'BattleCharacterLogic/getInstantAbiltyCount',
    'BattleCharacterLogic/getAvailableAbilities',
    'BattleCharacterLogic/getAvailableAbilitiesWithCond',
    'BattleCharacterLogic/wfxPartyRead',
    'BattleCharacterLogic/wfxPartyMask',
    'BattleCharacterLogic/wfxExtraLeaders',
    'BattleCharacterLogic/getOpitionAbilitiesWithoutAbilitySoul',
    'BattleAbilitySource/add',
    'AbilityDisabledReasonResolver/resolve',
    'AbilityDisabledReasonResolver/resolvePrecondition',
    'AbilityDisabledReasonResolver/resolveInitial',
    'TriggerableAbilityDialogAllAbilitiesGenerator/get',
    'TriggerableAbilityDialogAllAbilitiesGenerator/addAbility',
    'PartyRibbonSummarizer/resolveAbilityRibbons',
    'BattlePartyLogic/get_allCharacters',
    'BattlePartyLogic/get_mainCharacters',
    'BattlePartyLogic/get_unisonCharacters',
    'BattlePartyLogic/getNumberOfSameElement',
    'BattleCharacterLogic/get_element',
    'BattleCharacterLogic/<ctor>',
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def varint(n):
    encoded = bytearray()
    while n > 127:
        encoded.append((n & 127) | 128)
        n >>= 7
    encoded.append(n)
    return bytes(encoded)


def run():
    raw = BASE.read_bytes()
    assert sha(raw) == EXPECTED
    refs, owner_refs, manifest = [], [], {}
    total = 0
    for name, _, _, _, abc_raw in abc_tags(raw):
        abc = ABC(abc_raw)
        labels = bodies.label_map(abc)
        wanted = {i for i in range(1, len(abc.multinames))
                  if abc.mn_name(i).endswith('::InitialAbilityTriggerKindTools')}
        owner_names = {i for i in range(1, len(abc.multinames))
                       if abc.mn_name(i).split('::')[-1] == 'OwnerIsMain'}
        patterns = [b'\x60' + varint(i) for i in wanted]
        patterns += [b'\x66' + varint(i) for i in owner_names]
        for i, body in enumerate(abc.bodies):
            total += 1
            label = labels.get(i, f'<anonymous:{body[0]}>')
            if label in TARGETS:
                filename = label.replace('/', '__').replace('|', '_').replace('<', '').replace('>', '') + '.pcode.txt'
                (OUT / filename).write_text('\n'.join([
                    f'# v35h; {label}; header={body[1:5]}; SHA256={sha(body[5])}',
                    *listing(abc, body[5]), '']), encoding='utf-8')
                manifest[label] = {'abc': name.decode(), 'body': i,
                    'header': body[1:5], 'sha256': sha(body[5]), 'file': filename}
            if not any(p in body[5] for p in patterns):
                continue
            ins = asm.decode(body[5])
            indexes = [j for j, x in enumerate(ins)
                       if x.name == 'getlex' and x.args[0] in wanted]
            if indexes:
                refs.append({'abc': name.decode(), 'body': i, 'label': label,
                    'class_reference_instructions': indexes,
                    'evidence': [listing(abc, body[5])[max(0, n - 2):n + 7]
                                 for n in indexes]})
            reads = [j for j, x in enumerate(ins)
                     if x.name == 'getproperty' and x.args[0] in owner_names]
            if reads:
                text = listing(abc, body[5])
                owner_refs.append({'abc': name.decode(), 'body': i, 'label': label,
                    'owner_is_main_read_instructions': reads,
                    'evidence': [text[max(0, n - 4):n + 5] for n in reads]})
        bodies._CACHE.pop(id(abc), None)
    report = {'status': 'pass', 'input_sha256': EXPECTED,
        'scanned_bodies': total, 'match_character_class_references': refs,
        'owner_is_main_references': owner_refs,
        'pcode': manifest,
        'note': '遍历全部 DoABC；字节预筛仅减少解码，最终按真实 getlex 指令与 QName 检查。'}
    (OUT / 'native-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'pass', 'scanned_bodies': total, 'references': refs},
                     ensure_ascii=False))


if __name__ == '__main__':
    run()
