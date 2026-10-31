"""141-143号本地归档，共用本轮完整可复现源码。"""
import json
from bootstrap import ROOT, output_path
from framework import sha
from make_registry import ENTRIES, implementation_group, requirement_decisions
from task_contract import PRE_CT_SWF_SHA

EVIDENCE_FILES = (
    'baseline-locks.json', 'release-locks.json', 'input-provenance.json',
    'build-report.json', 'verify-report.json', 'verification-source-locks.json',
    'framework-report.json', 'framework-source-locks.json',
    'readonly-source-locks.json', 'readonly-source-report.json',
    'registry-draft.json', 'final-pcode/manifest.json',
    'task-evidence/TASK11-before-ruling.md', 'task-evidence/TASK11-before-ct.md',
    'task-evidence/TASK11-current.md',
    'task-evidence/TASK11-readonly-ack.md', 'task-evidence/known-external-changes.json',
    'task-evidence/readonly-source-before-ack.json',
    'task-evidence/decision-status.json',
    'direct_count/verify-report.json', 'heal_any/verify-report.json',
    'audit/cross-review-report.json', 'audit/native-evidence.json',
    'audit/native-contract-review.md', 'audit/ruling-delta-report.json',
    'audit/ct-delta-report.json', 'audit/ct-native-evidence.json', 'audit/ct-review-report.json',
    'audit-ruling-framework.json',
)


def archive_sources():
    excluded = {'work', 'apk-patches-additions', '__pycache__'}
    paths = set(ROOT.rglob('*.py')) | set(ROOT.rglob('cross-review-*-probe.txt'))
    paths.update((ROOT/'audit/native-pcode').glob('*.txt'))
    paths.update((ROOT/'audit/ct-native-pcode').glob('*.txt'))
    paths.update(ROOT/name for name in EVIDENCE_FILES)
    return [p for p in sorted(paths) if not excluded.intersection(p.relative_to(ROOT).parts)]


def main():
    release = json.loads((ROOT/'release-locks.json').read_text(encoding='utf-8'))
    decisions = requirement_decisions()
    verified = json.loads((ROOT/'verify-report.json').read_text(encoding='utf-8'))
    assert verified['status'] == 'pass' and verified['output_swf_sha256'] == release['output_swf_sha256']
    assert verified['requirement_decisions'] == decisions, '验收报告与当前裁定不一致'
    registry = json.loads((ROOT/'registry-draft.json').read_text(encoding='utf-8'))
    assert registry['requirement_decisions'] == decisions, '累计登记与当前裁定不一致'
    ct = json.loads((ROOT/'audit/ct-delta-report.json').read_text(encoding='utf-8'))
    assert ct['status'] == 'passed' and ct['output_swf_sha256'] == release['output_swf_sha256'], 'CT增量报告未绑定本次产物'
    assert ct['previous_swf_sha256'] == PRE_CT_SWF_SHA, 'CT增量报告未绑定第二版'
    pcode = json.loads((ROOT/'final-pcode/manifest.json').read_text(encoding='utf-8'))
    groups = json.loads((ROOT/'build-report.json').read_text(encoding='utf-8'))['groups']
    archive = ROOT/'apk-patches-additions'
    copies = []
    for source in archive_sources():
        target = archive/'source'/source.relative_to(ROOT)
        raw = source.read_bytes()
        output_path(target).write_bytes(raw)
        copies.append({'source': source.relative_to(ROOT).as_posix(), 'path': target.relative_to(ROOT).as_posix(), 'sha256': sha(raw)})
    for key, (capability, name, summary) in ENTRIES.items():
        group = implementation_group(key)
        labels = set(groups[group]['changed']+groups[group]['added'])
        rows = [row for row in pcode if row['label'] in labels]
        assert {row['label'] for row in rows} == labels
        for row in rows:
            source = ROOT/'final-pcode'/row['file']
            target = archive/name/'pcode'/row['file']
            raw = source.read_bytes()
            output_path(target).write_bytes(raw)
            copies.append({'source': source.relative_to(ROOT).as_posix(), 'path': target.relative_to(ROOT).as_posix(), 'sha256': sha(raw)})
        output_path(archive/name/'manifest.json').write_text(json.dumps({
            'capability': capability, 'output_swf_sha256': release['output_swf_sha256'],
            'pcode': rows, 'shared_source': '../source', 'source_entrypoint': '../../build.py',
            'requirement_decisions': decisions,
            'decision_evidence': '../source/task-evidence/decision-status.json',
            'task_evidence': '../source/task-evidence/TASK11-current.md',
            'revision': 3, 'pre_ct_swf_sha256': PRE_CT_SWF_SHA,
            'verification_status': verified['status'],
            'external_readonly_ack': '../source/task-evidence/known-external-changes.json',
            'scope': '本地草稿；前十轮构造器与v34输入只读；AIR/真机未核实',
        }, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        output_path(archive/name/'README.md').write_text(f'''# {name}

`{capability}`：{summary}。

产物 SHA256：`{release['output_swf_sha256']}`。
总验收 **pass**；三项已知外部变化已按[精确哈希登记](../source/task-evidence/known-external-changes.json)，原始只读锁保留。
完整源码共用 [source](../source)，本条目的最终方法位于 [pcode](pcode)。
统一重放使用 [run11 构造器](../../build.py)，`--from-v34` 从 v34 串联十一轮。
路径边界绑定 run11，归档源码副本用于审计，不在副本位置执行。
见 [本轮说明](../../README.md)、[分组说明](../../{group}/README.md)、[验收报告](../../verify-report.json)。
本次 [任务快照](../source/task-evidence/TASK11-current.md) 与 [裁定记录](../source/task-evidence/decision-status.json) 已归档：联机 B、Fever A，无待澄清项。
第三版追加码34的5s CT：[追加前任务](../source/task-evidence/TASK11-before-ct.md)，[CT增量审计](../source/audit/ct-delta-report.json)。
码34示例为 `wfx:34:5050:100000:150000:hidden_wg_aqua_heal_damage_any`；arg=分类+10×档位百分比+1000×CT秒数。
按60逻辑帧/秒换算；30帧窗口发伤害时起算CT，CT内治疗丢弃，每个持有者独立且有效/溢出共用；码35不受CT限制。
码 34/35 只计本端成员实际执行的回复，允许跨玩家来源，转发/镜像不计；码 30/31 原跨 statsBattleId 排除不变。
Fever 按每名受治疗成员的每次实际 applyHeal 独立量化并各调用一次 API，不新增批次标记。
本地草稿；完整 AIR、真机、实际 UI、真实联机均未核实。
''', encoding='utf-8')
    text = '# 第十一轮新增补丁归档草稿\n\n'
    text += '\n'.join(f'- [{name}]({name}/README.md)：{summary}。' for _, name, summary in ENTRIES.values())
    text += '\n\n前十轮112–140条目保持在原轮目录，本轮只追加141–143号本地草稿。\n'
    text += '累计登记见 [registry-draft.json](source/registry-draft.json)，前十轮定义保持原值；共享源码附带任务裁定、验证报告和源码锁。\n'
    text += '裁定：[联机 B、Fever A](source/task-evidence/decision-status.json)，无待澄清项；真实双端联机仍未核实。\n'
    text += '第三版码34追加5s CT；第二版完整产物保存在 [work/pre-ct](../work/pre-ct)，档位和CT增量证据见 [CT审计](source/audit/ct-delta-report.json)。\n'
    text += '总验收 pass；[外部只读变化确认](source/task-evidence/TASK11-readonly-ack.md)与[三项精确登记](source/task-evidence/known-external-changes.json)已归档，原始只读锁保留。\n'
    output_path(archive/'README.md').write_text(text, encoding='utf-8')
    output_path(ROOT/'archive-source-manifest.json').write_text(json.dumps(copies, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
