"""从固定v35e提取原生724、槽处理和同步链的完整P-code，输出限本模块。"""
import hashlib, json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import bootstrap
from bootstrap import BASE, BASE_SHA
from swfabc import SwfAbc
from common import listing
import bodies

LABELS = [
    'AbilityValues$/parseAt47', 'InstantAbilitySource$/resolveInstantContent',
    'AbilitySlotImpl/applyInstantBattle', 'ZoneImpl/addFeverPoint',
    'FeverPointGaugeImpl/addFeverPoint', 'FeverPointGaugeImpl/isChangeable',
    'FeverPointGaugeImpl/isFeverMode', 'FeverPointGaugeImpl/update',
    'FeverPointGaugeImpl/startFever', 'FeverPointGaugeImpl/applySynchronize',
    'FeverPointGaugeImpl/enterFeverState', 'FeverPointGaugeImpl/changeState',
    'FeverPointGaugeImpl/wfxSuperEnergy', 'FeverPointGaugeImpl/extendfeverDebugStats',
    'ClosedInterval/add', 'ClosedInterval/set', 'ClosedInterval/getRatio',
    'ClosedInterval/subtract', 'ClosedInterval/isMaximum',
    'Decimal_Impl_$/fromFloat', 'Decimal_Impl_$/fromInt', 'Decimal_Impl_$/toFloat', 'Decimal_Impl_$/_new',
]


def export():
    assert hashlib.sha256(BASE.read_bytes()).hexdigest() == BASE_SHA, '固定输入SHA不符，停止'
    abc = SwfAbc(BASE).abc
    dest = HERE/'native-pcode'; dest.mkdir(exist_ok=True)
    records = []
    for label in LABELS:
        index = bodies.resolve(abc, label); body = abc.bodies[index]
        name = label.replace('/', '__')+'.pcode.txt'
        digest = hashlib.sha256(body[5]).hexdigest()
        (dest/name).write_text(f'# {label}; body={index}; sha256={digest}; header={body[1:5]}\n' +
                               '\n'.join(listing(abc, body[5]))+'\n', encoding='utf-8')
        records.append({'label':label, 'body':index, 'sha256':digest, 'header':body[1:5],
                        'file':'native-pcode/'+name})
    (HERE/'native-evidence.json').write_text(json.dumps({'input_sha256':BASE_SHA, 'methods':records},
                                           ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return records


if __name__ == '__main__':
    print(json.dumps({'methods':len(export())}))
