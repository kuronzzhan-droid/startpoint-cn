"""第三版任务契约与交付绑定负控；只替换内存读取，不改只读输入。"""
import ast
import copy
import hashlib
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.dont_write_bytecode = True
import task_contract as contract
import source_guard


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    decisions = contract.verify()
    original_read_bytes, original_read_text = Path.read_bytes, Path.read_text
    checks = []
    paths = [ROOT/name for name in (
        'task-evidence/TASK11-before-ruling.md', 'task-evidence/TASK11-before-ct.md',
        'task-evidence/TASK11-current.md', 'task-evidence/decision-status.json',
        'task-evidence/TASK11-readonly-ack.md',
        'input-provenance.json', 'work/pre-ct/v35k.swf', 'work/pre-ct/v35k.swf.sha256',
    )] + [ROOT.parent/'TASK11.md']
    raw_cache = {p.resolve(): p.read_bytes() for p in paths}

    def accept(name, fn):
        fn()
        checks.append({'name': name, 'pass': True})

    def reject(name, fn):
        try:
            fn()
        except (AssertionError, KeyError, ValueError) as exc:
            checks.append({'name': name, 'rejected': True, 'reason': str(exc)})
            return
        raise AssertionError('负控未变红：'+name)

    def task_with(overrides):
        cache = dict(raw_cache)
        cache.update({(ROOT/name).resolve(): raw for name, raw in overrides.items()})

        def read_bytes(path):
            return cache[path.resolve()] if path.resolve() in cache else original_read_bytes(path)

        def read_text(path, *args, **kwargs):
            if path.resolve() in cache:
                encoding = kwargs.get('encoding') or (args[0] if args else 'utf-8')
                return cache[path.resolve()].decode(encoding)
            return original_read_text(path, *args, **kwargs)

        with patch.object(Path, 'read_bytes', read_bytes), patch.object(Path, 'read_text', read_text):
            return contract.verify()

    def altered_json(path, edit):
        data = json.loads(raw_cache[(ROOT/path).resolve()].decode('utf-8'))
        edit(data)
        return {path: json.dumps(data, ensure_ascii=False).encode('utf-8')}

    accept('current_task_contract', lambda: task_with({}))
    cases = [
        ('pending_status', lambda d: d.update(status='pending')),
        ('wrong_source', lambda d: d.update(source='TASK11-before-ct.md')),
        ('wrong_source_hash', lambda d: d.update(source_sha256=contract.PRE_CT_SHA)),
        ('wrong_revision', lambda d: d.update(revision=2)),
        ('wrong_ct_start', lambda d: d['ct_supplement'].update(ct_start='first_heal')),
        ('ct_carry', lambda d: d['ct_supplement'].update(ct_heals='carry')),
        ('wrong_ct_example', lambda d: d['ct_supplement'].update(example_arg=50)),
        ('duplicate_question', lambda d: d['questions'].append(d['questions'][0])),
    ]
    for index in range(2):
        cases.append(('wrong_answer_'+str(index), lambda d, i=index: d['questions'][i].update(answer='wrong')))
    for name, edit in cases:
        reject(name, lambda edit=edit: task_with(altered_json('task-evidence/decision-status.json', edit)))
    for path in paths:
        relative = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else '../TASK11.md'
        reject('mutated_bytes_'+relative, lambda relative=relative, path=path:
               task_with({relative: b'mutated\n'+raw_cache[path.resolve()]}))
    for field in ('task_sha256', 'previous_task_sha256', 'pre_ct_task_sha256',
                  'pre_ct_swf', 'pre_ct_swf_sha256'):
        reject('wrong_provenance_'+field, lambda field=field:
               task_with(altered_json('input-provenance.json', lambda d: d.update({field: 'wrong'}))))

    old = json.loads(source_guard.SNAPSHOT.read_text(encoding='utf-8'))
    current = copy.deepcopy(old)
    current['files']['TASK11.md'] = {'sha256': contract.ACK_SHA, 'bytes': contract.ACK_BYTES}
    external_changes = source_guard.acknowledged_changes()
    for row in external_changes:
        current['files'][row['path']] = copy.deepcopy(row['after'])

    def readonly(candidate):
        with patch.object(source_guard, 'inventory', return_value=candidate):
            return source_guard.verify()

    accept('exact_task_append_accepted_against_initial_lock', lambda: readonly(current))
    guard_cases = [
        ('other_changed_file', lambda d: d['files']['TASK1.md'].update(sha256='wrong')),
        ('new_file', lambda d: d['files'].update({'unauthorized.txt': {'sha256': 'wrong', 'bytes': 1}})),
        ('missing_file', lambda d: d['files'].pop('TASK1.md')),
        ('new_directory', lambda d: d['directories'].append('unauthorized')),
        ('missing_directory', lambda d: d['directories'].pop()),
        ('external_change', lambda d: next(iter(d['external'].values())).update(sha256='wrong')),
        ('task_size', lambda d: d['files']['TASK11.md'].update(bytes=10584)),
        ('task_hash', lambda d: d['files']['TASK11.md'].update(sha256=contract.PRE_CT_SHA)),
        ('old_task_restored', lambda d: d['files'].update({'TASK11.md': old['files']['TASK11.md']})),
    ]
    for name, edit in guard_cases:
        candidate = copy.deepcopy(current)
        edit(candidate)
        reject(name, lambda candidate=candidate: readonly(candidate))

    for row in external_changes:
        path = row['path']
        for field, value in (('sha256', 'wrong'), ('bytes', row['after']['bytes']+1)):
            candidate = copy.deepcopy(current)
            candidate['files'][path][field] = value
            reject('external_ack_'+path+'_'+field, lambda candidate=candidate: readonly(candidate))
        candidate = copy.deepcopy(current)
        candidate['files'].pop(path)
        reject('external_ack_missing_'+path, lambda candidate=candidate: readonly(candidate))
        if row['before'] is not None:
            candidate = copy.deepcopy(current)
            candidate['files'][path] = copy.deepcopy(row['before'])
            reject('external_ack_rollback_'+path, lambda candidate=candidate: readonly(candidate))
    registration = ROOT/source_guard.ACK_FILE
    original_digest = source_guard.digest
    with patch.object(source_guard, 'digest', side_effect=lambda path:
                      'wrong' if path == registration else original_digest(path)):
        reject('external_ack_registration_hash', lambda: readonly(current))
    accept('final_readonly_contract', lambda: readonly(current))

    tree = ast.parse((ROOT/'delivery_check.py').read_text(encoding='utf-8'))
    for key, message in (('now', '累计登记与裁定不一致'), ('item', '归档manifest与裁定不一致')):
        statement = next(node for node in ast.walk(tree) if isinstance(node, ast.Assert)
                         and isinstance(node.msg, ast.Constant) and node.msg.value == message)
        code = compile(ast.fix_missing_locations(ast.Module(body=[statement], type_ignores=[])),
                       'delivery_check.py exact assertion', 'exec')

        def execute(value, key=key, code=code):
            exec(code, {'verify_task': contract.verify, key: value})

        accept(key+'_current_decisions', lambda: execute({'requirement_decisions': decisions}))
        for field, wrong in (('revision', 2), ('ct_supplement', {}), ('source_sha256', contract.PRE_CT_SHA)):
            candidate = copy.deepcopy(decisions)
            candidate[field] = wrong
            reject(key+'_wrong_'+field, lambda candidate=candidate: execute({'requirement_decisions': candidate}))
        reject(key+'_missing_decisions', lambda: execute({}))

    registry_assertions = [node for node in ast.walk(tree) if isinstance(node, ast.Assert)
                           and any(isinstance(item, ast.Name) and item.id == 'damage'
                                   for item in ast.walk(node))]
    assert len(registry_assertions) == 3
    registry_code = compile(ast.fix_missing_locations(ast.Module(body=registry_assertions, type_ignores=[])),
                            'delivery_check.py CT registry exact assertions', 'exec')
    damage = {
        'example': 'wfx:34:5050:100000:150000:hidden_wg_aqua_heal_damage_any',
        'logic_frames_per_second': 60, 'ct_evidence': 'audit/ct-delta-report.json',
        'arg': '分类+10*档位百分比+1000*CT秒数', 'timing': 'arg<1000保持第二版',
    }
    accept('registry_current_ct_schema', lambda: exec(registry_code, {'damage': damage}))
    for field, wrong in (('example', 'wfx:34:50:100000:150000:hidden_wg_aqua_heal_damage_any'),
                         ('logic_frames_per_second', 30), ('ct_evidence', 'stale.json'),
                         ('arg', 'no CT'), ('timing', 'no pre-CT parity')):
        candidate = {**damage, field: wrong}
        reject('registry_wrong_ct_'+field, lambda candidate=candidate:
               exec(registry_code, {'damage': candidate}))

    accept('final_task_contract', contract.verify)
    sources = ['audit/ruling_framework.py', 'task_contract.py', 'source_guard.py',
               'delivery_check.py', 'make_registry.py', 'make_archive.py',
               'task-evidence/TASK11-before-ruling.md', 'task-evidence/TASK11-before-ct.md',
               'task-evidence/TASK11-current.md', 'task-evidence/decision-status.json',
               'task-evidence/TASK11-readonly-ack.md', 'task-evidence/known-external-changes.json',
               'task-evidence/readonly-source-before-ack.json',
               'input-provenance.json', 'readonly-source-locks.json']
    report = {
        'status': 'pass', 'revision': 3, 'task_sha256': contract.CURRENT_SHA,
        'external_readonly_ack_sha256': contract.ACK_SHA,
        'scope': '实际任务契约及内存负控；不是整包SWF/业务/最终交付验收',
        'positive_baselines': sum(row.get('pass', False) for row in checks),
        'negative_cases': sum(row.get('rejected', False) for row in checks),
        'checks': checks, 'requirement_decisions': decisions,
        'evidence_source_locks': [{'path': name, 'sha256': digest((ROOT/name).read_bytes())} for name in sources],
        'final_baseline': 'pass',
    }
    (ROOT/'audit-ruling-framework.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('status', 'revision', 'positive_baselines', 'negative_cases')}))


if __name__ == '__main__':
    main()
