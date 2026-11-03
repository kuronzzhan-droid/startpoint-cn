"""独立锁定原生逻辑帧证据；只输出 run11/audit/ct-*。"""
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import bootstrap
import asm
import bodies
from bootstrap import BASE, BASE_SHA, output_path
from common import listing
from swfabc import SwfAbc

LOCKS = {
    'ElapsedTimeCalculatorImpl/advanceTime': (
        'bc91f39cfbd9d9455e2cd708ca2876b29b19b121d305520543dbea48ac9bf0b4', [4, 2, 1, 2]),
    'ActionSkillReportTools$/frameToSecondsString': (
        'a369f9b457b4e33394c5106aa08860bc522afe2bcbaa6ea0ee51eef010c95310', [3, 2, 1, 1]),
    'SquadManagerImpl/updatePhase': (
        '316f4438216de54b72782f724db60ee7ff3959b62a04e98c01c8b67a879be532', [3, 2, 1, 2]),
    'Battle/stepLifeCycleAsAllEntitiesMode': (
        'd835de896b6136369a019adc8fbdb092592925f911cbe86cb363dc72d5cbb511', [4, 5, 1, 2]),
    'Battle/stepLifeCycleAsOnlySquadMode': (
        '27a5eadca6c4595ab64c9d357a91031765df4040e1d58b03db63732e71fed571', [2, 3, 1, 2]),
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def inspect(source=BASE, write=True):
    source = Path(source)
    assert digest(source.read_bytes()) == BASE_SHA, 'CT native evidence must use pinned v35j'
    abc = SwfAbc(source).abc
    result = {}
    decoded = {}
    for label, (expected_sha, header) in LOCKS.items():
        body = abc.bodies[bodies.resolve(abc, label)]
        assert digest(body[5]) == expected_sha and body[1:5] == header, label
        decoded[label] = asm.decode(body[5])
        name = label.replace('/', '__').replace('$', '_static') + '.pcode.txt'
        result[label] = {'sha256': expected_sha, 'header': header,
                         'file': 'audit/ct-native-pcode/' + name}
        if write:
            output_path(ROOT/result[label]['file']).write_text(
                '\n'.join([f'# {label}; code_sha256={expected_sha}; header={header}',
                           *listing(abc, body[5])]) + '\n', encoding='utf-8')
    advance = decoded['ElapsedTimeCalculatorImpl/advanceTime']
    assert advance[5].name == 'pushbyte' and advance[5].args == [1]
    assert advance[6].name == 'add_i'
    assert advance[12].name == 'pushdouble'
    assert abc.doubles[advance[12].args[0]] == 1000/60
    seconds = decoded['ActionSkillReportTools$/frameToSecondsString']
    assert seconds[2].name == 'pushbyte' and seconds[2].args == [60]
    assert seconds[3].name == 'divide'
    phase = decoded['SquadManagerImpl/updatePhase']
    assert phase[5].name == 'pushbyte' and phase[5].args == [1]
    assert phase[6].name == 'add_i'
    assert abc.mn_name(phase[7].args[0]) == 'currentFrame'
    assert abc.mn_name(phase[33].args[0]) == 'wfxHealDamageTick'
    for label, at in [('Battle/stepLifeCycleAsAllEntitiesMode', 60),
                      ('Battle/stepLifeCycleAsOnlySquadMode', 15)]:
        call = decoded[label][at]
        assert call.name == 'callpropvoid' and call.args[1] == 1
        assert abc.mn_name(call.args[0]) == 'updatePhase'
    report = {
        'schema_version': 1, 'status': 'passed',
        'input_swf_sha256': BASE_SHA, 'logic_frames_per_second': 60,
        'ct_5_seconds_frames': 300, 'aggregation_window_frames': 30,
        'methods': result,
        'evidence': [
            'advanceTime #2-7: rawFrame += 1; #12: 1000/60 milliseconds per frame',
            'frameToSecondsString #1-3: frame / 60',
            'updatePhase #2-7: currentFrame += 1; #31-33: wfxHealDamageTick',
            'AllEntitiesMode #56-60 and OnlySquadMode #12-15 call squad updatePhase once',
            'CT reads squad currentFrame; without logical frame advance it cannot expire',
        ],
        'scope': '固定 SWF 原生字节码证据；完整 AIR/设备暂停表现未核实',
        'source_sha256': digest(Path(__file__).read_bytes()),
    }
    if write:
        output_path(ROOT/'audit/ct-native-evidence.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    print(json.dumps(inspect(), ensure_ascii=False, indent=2))
