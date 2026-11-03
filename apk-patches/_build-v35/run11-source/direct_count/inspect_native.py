"""只读 v35j；原生次数与解析器证据仅写 direct_count。"""
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path[:0] = [str(ROOT / 'run10'), str(ROOT / 'run10' / 'vendor')]
from swfabc import SwfAbc
from common import listing
import bodies


def main():
    source = ROOT / 'run10' / 'v35j.swf'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == '1414862f84a1895b0bea54613f92fd48a59d11544a6097ef4dd2627c0dfe2384'
    abc = SwfAbc(source).abc
    available = set(bodies.label_map(abc).values())
    labels = ['MemberImpl/scheduleDirectAttack', 'MemberImpl/getAdditionalDirectAttack',
              'ConditionSlot$/wfxSpec', 'ConditionSlot/wfxRows', 'ConditionSlot/wfxCollect',
              'EnemyImpl/getTotalDebuffCounts', 'ConditionSlot/getTotalDebuffCounts']
    labels += sorted(x for x in available if ('AdditionalDirectAttack' in x or 'DirectAttack2' in x or 'DirectAttack3' in x) and x not in labels)
    dest = HERE / 'native-evidence'
    dest.mkdir(exist_ok=True)
    result = {}
    for label in labels:
        body = abc.bodies[bodies.resolve(abc, label)]
        result[label] = {'sha': hashlib.sha256(body[5]).hexdigest(), 'header': body[1:5]}
        filename = label.replace('/', '__').replace('<','').replace('>','') + '.pcode.txt'
        (dest / filename).write_text('\n'.join([f'# {label}; {result[label]}', *listing(abc, body[5])]) + '\n', encoding='utf-8')
    (dest / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
