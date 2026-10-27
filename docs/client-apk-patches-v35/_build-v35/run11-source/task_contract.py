"""锁定原任务、联机/Fever裁定及5s CT追加；不覆盖最初只读快照。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BEFORE_SHA = 'e7f8bdde6450e4d2ea27835ac906ace322dfd0e1c34e64fc38f0d1692483aeea'
PRE_CT_SHA = '8b52c8b03f023e4c3fed5c1fd8e087ae447478a6785dc92996636dc0839154c3'
CURRENT_SHA = '69c0c9b27f479d7270618776be22b5ef371b21c5061d255877d8ce05e9b57851'
ACK_SHA = '853334b785967246db68f8c7d01f5180caf87ae7bd86b861963b1439d7eee15b'
ACK_BYTES = 11268
PRE_CT_SWF_SHA = '608bf66914dc5e0a0b8c16e795b88692f67b2b9a23a898be4254c42710e4353b'
ANSWERS = {'cross_player_stats_id': 'B', 'fever_batch_boundary': 'A'}
CT_REQUIREMENT = {
    'code': 34, 'arg_formula': 'category + 10 * tier_percent + 1000 * ct_seconds',
    'tier_percent_range': [0, 99], 'example_arg': 5050, 'example_ct_seconds': 5,
    'window_logic_frames': 30, 'minimum_ct_logic_frames': 30,
    'ct_start': 'damage_emission', 'ct_heals': 'discard_without_carry',
    'ct_scope': 'one_per_holder_shared_effective_and_overheal',
    'pause': 'no_logic_frames_no_ct_progress',
    'arg_below_1000': 'bytecode_behavior_identical_to_pre_ct',
    'code35': 'unchanged_no_ct',
}


def verify():
    previous = (ROOT/'task-evidence/TASK11-before-ruling.md').read_bytes()
    pre_ct = (ROOT/'task-evidence/TASK11-before-ct.md').read_bytes()
    current = (ROOT/'task-evidence/TASK11-current.md').read_bytes()
    assert hashlib.sha256(previous).hexdigest() == BEFORE_SHA, '裁定前任务快照漂移'
    assert hashlib.sha256(pre_ct).hexdigest() == PRE_CT_SHA, 'CT前第二版任务快照漂移'
    assert hashlib.sha256(current).hexdigest() == CURRENT_SHA, '已授权CT补充快照漂移'
    assert pre_ct.startswith(previous), '裁定必须仅追加到原任务末尾'
    assert current.startswith(pre_ct), 'CT补充必须仅追加到第二版任务末尾'
    acknowledged = (ROOT/'task-evidence/TASK11-readonly-ack.md').read_bytes()
    assert hashlib.sha256(acknowledged).hexdigest() == ACK_SHA, '外部只读变化确认快照漂移'
    assert len(acknowledged) == ACK_BYTES and acknowledged.startswith(current), '只读确认必须仅追加到CT任务末尾'
    assert (ROOT.parent/'TASK11.md').read_bytes() == acknowledged, '当前任务发生未核对变化'
    decisions = json.loads((ROOT/'task-evidence/decision-status.json').read_text(encoding='utf-8'))
    assert decisions['status'] == 'resolved', '裁定未解决'
    assert decisions['source'] == 'TASK11-current.md' and decisions['source_sha256'] == CURRENT_SHA
    assert len(decisions['questions']) == len(ANSWERS)
    assert {r['id']: r['answer'] for r in decisions['questions']} == ANSWERS, '裁定答案漂移'
    assert decisions['revision'] == 3 and decisions['ct_supplement'] == CT_REQUIREMENT, 'CT补充口径漂移'
    provenance = json.loads((ROOT/'input-provenance.json').read_text(encoding='utf-8'))
    assert provenance['task_sha256'] == CURRENT_SHA and provenance['previous_task_sha256'] == BEFORE_SHA
    assert provenance['pre_ct_task_sha256'] == PRE_CT_SHA
    assert provenance['pre_ct_swf'] == 'work/pre-ct/v35k.swf'
    assert provenance['pre_ct_swf_sha256'] == PRE_CT_SWF_SHA
    pre_ct_swf = ROOT/provenance['pre_ct_swf']
    assert hashlib.sha256(pre_ct_swf.read_bytes()).hexdigest() == PRE_CT_SWF_SHA, '第二版SWF留档漂移'
    assert (pre_ct_swf.with_suffix('.swf.sha256')).read_text(encoding='ascii').split()[0] == PRE_CT_SWF_SHA
    return decisions


def accepted_task_change(old, new):
    verify()
    assert old == {'sha256': BEFORE_SHA, 'bytes': 8561}, '原始TASK11锁不符'
    assert new == {'sha256': ACK_SHA, 'bytes': ACK_BYTES}, '仅接受已核对裁定、CT补充及只读确认精确内容'
    return {'path': 'TASK11.md', 'before': old, 'after': new,
            'intermediate': {'sha256': PRE_CT_SHA, 'bytes': 9169},
            'ct_task': {'sha256': CURRENT_SHA, 'bytes': 10585},
            'reason': '保留联机B、Fever A及5s CT补充；仅追加2026-10-19外部只读变化确认，既有实现裁定不变',
            'snapshot': 'task-evidence/TASK11-readonly-ack.md',
            'ct_snapshot': 'task-evidence/TASK11-current.md',
            'pre_ct_snapshot': 'task-evidence/TASK11-before-ct.md'}
