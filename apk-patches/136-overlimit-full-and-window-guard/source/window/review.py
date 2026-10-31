"""窗口作者对材料/台座的独立复审；不修改被审模块。"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import bootstrap
import asm
import bodies
from swfabc import SwfAbc
from materials.runtime import capture as material_capture, world as material_world
from pedestals.runtime import world as pedestal_world


def body(abc, label):
    return abc.bodies[bodies.resolve(abc, label)]


def run():
    before = SwfAbc(bootstrap.BASE).abc
    path = bootstrap.ROOT / 'v35h.swf'
    after = SwfAbc(path).abc
    rows = []

    def check(name, condition, details=None):
        assert condition, (name, details)
        rows.append({'name': name, 'status': 'pass', 'details': details})

    report = json.loads((bootstrap.ROOT / 'build-report.json').read_text(encoding='utf-8'))
    for label, record in report['changed'].items():
        raw = asm.unsplice_many(body(after, label)[5], record['insertions'])
        check('被改方法去插入恢复原始code: ' + label, raw == body(before, label)[5])
    for label in ['GeneralCharacterLogic/get_maxOverLimitStep',
                  'PixelArtCharacter/getPedestalImagePath',
                  'OverLimitWindowView/setupStatusInformationWindow']:
        check('完整未改原方法: ' + label, body(before, label) == body(after, label))
    # 逐一检查所有目标中的新助手调用，既有方法入口没有替换整段旧条件。
    from materials.patches import TARGETS as material_targets
    for label in material_targets:
        calls = [after.mn_name(x.args[0]) for x in asm.decode(body(after, label)[5])
                 if x.name in ('callproperty', 'callpropvoid')]
        check('全程守卫覆盖: ' + label, calls.count('wfxOverlimitFull') == 1)

    # 最高键120边界与字符串严格值在原字节码完整业务入口上验证。
    for highest in (119, 120, 121):
        for key in (None, '1', 1, '01'):
            args = dict(highest=highest, key=key, step=0, cid=129989)
            actual = material_capture(after, **args)[0]
            if key == '1' and highest >= 120:
                check('新材料阈值和严格值', actual['candidates'] == [10000320] and
                      [x['id'] for x in actual['status']['items']] == [10000320, 10000302], args)
            else:
                check('非生效角色全业务旧行为', actual == material_capture(before, **args)[0], args)
    e, char, *_ = material_world(after, key='1', step=0)
    check('辅助结果不跨数据变化缓存1', char['wfxOverlimitFull']() is True)
    e.table.clear()
    check('辅助结果不跨数据变化缓存2', char['wfxOverlimitFull']() is False)

    # 四个盘，原始节点键与multiplied_id不同；第四盘末节点缺失会阻止C款。
    boards = {1: {1: 101}, 2: {1: 201}, 3: {1: 301}, 4: {1: 401, 2: 402}}
    all_ids = [101, 201, 301, 401, 402]
    for awake in (0, 2):
        e, char, *_ = pedestal_world(after, boards=boards, learned=all_ids, awake=awake)
        check('四盘全学允许C且不依赖觉醒', char['getPedestalImagePath']().endswith('_7'), {'awake': awake})
        del char['abilities']['h'][402]
        check('第四盘末节点动态缺失降为B', char['getPedestalImagePath']().endswith('_6'))
        char['abilities']['h'][999999] = 99
        check('额外无关学习ID不能补缺节点', char['getHalfPedestalImagePath']().endswith('_6_half'))
        char['abilities']['h'][402] = 0
        check('原生已学值0满足学习且不要求觉醒', char['getHalfPedestalImagePath']().endswith('_7_half'))
    for cid in (111183, 141099, 129989):
        for step in range(9):
            outputs = []
            for abc in (before, after):
                e, char, *_ = pedestal_world(abc, cid=cid, key=None, step=step, awake=1)
                outputs.append([char['getPedestalImagePath'](), char['getHalfPedestalImagePath']()])
            check('无键全程台座独立逐项对照', outputs[0] == outputs[1], {'cid': cid, 'step': step})
    learned = asm.decode(body(before, 'BattleCharacterLogic/hasLearnedAllManaNodeOfManaBoard')[5])
    awake = asm.decode(body(before, 'BattleCharacterLogic/hasAwakedAllManaNodeOfManaBoard')[5])
    check('原生学习源是abilities.h成员存在',
          learned[56].name == 'getproperty' and before.mn_name(learned[56].args[0]) == 'abilities' and
          learned[61].name == 'getproperty' and before.mn_name(learned[61].args[0]) == 'h' and
          learned[62].name == 'in')
    check('原生觉醒源同为abilities.h且另查觉醒值',
          before.mn_name(awake[61].args[0]) == 'abilities' and
          before.mn_name(awake[66].args[0]) == 'h' and awake[67].name == 'in' and
          awake[77].name == 'greaterequals')
    sources = [HERE / 'review.py', *sorted((bootstrap.ROOT / 'materials').glob('*.py')),
               *sorted((bootstrap.ROOT / 'pedestals').glob('*.py'))]
    result = {'status': 'pass', 'after_swf_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
              'checks': len(rows), 'results': rows, 'findings': [],
              'read_scope': ['materials/helper.py', 'materials/patches.py', 'materials/runtime.py',
                             'materials/cases.py', 'pedestals/patches.py', 'pedestals/runtime.py',
                             'pedestals/cases.py', 'v35g/v35h actual ABC methods'],
              'resolved_review_note': '材料O5注释乱码已由作者修正；其死分支目标被追加真实label承接且原始字节可逆',
              'evidence_source_locks': [{'path': str(p.relative_to(bootstrap.ROOT)).replace('\\', '/'),
                                         'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sources],
              'boundary': '独立审阅与离线真实字节码探针；复用受控主表和对象夹具；AIR/真机未核实'}
    (HERE / 'review-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('status', 'checks', 'findings')}, ensure_ascii=False))
    return result


if __name__ == '__main__':
    run()
