"""第九轮整包保持性、双锁、输出边界与 v34 九轮串联重放验证。"""
from __future__ import annotations

import copy
import json
import subprocess
import sys
from types import SimpleNamespace

import bootstrap
from bootstrap import ROOT, BASE, output_path
from framework import sha
from build import construct, release_record, verify_input
from integrity import compare, unchanged_scaffolding
from multiabc import editors, envelope
from common import ABC, abc_tags
from swfabc import SwfAbc, abcfmt
from static_check import negative_controls, check_body
from framework_evidence import source_snapshot, freeze_evidence
import asm
import bodies

from target_contract import EXPECTED_CHANGED, EXPECTED_ADDED


def reversible_targets(editor):
    result = []
    for label, record in editor.report.items():
        index = bodies.resolve(editor.abc, label)
        code = asm.unsplice_many(editor.abc.bodies[index][5], record['insertions'])
        edit = record.get('operand_edit')
        if edit:
            ins = asm.decode(code)
            assert ins[edit['instruction']].args == [edit['after']]
            ins[edit['instruction']].args = [edit['before']]
            code = asm.encode(ins)[0]
        assert code == editor.original_bodies[index][5], label
        result.append({'method': label, 'original_code_byte_exact_after_undo': True})
    return result


def check_locks(editor):
    denied = []
    for label in editor.report:
        idx = bodies.resolve(editor.abc, label)
        original, actual = editor.original_bodies[idx], editor.abc.bodies[idx]
        for kind in ('body', 'header'):
            mutant = copy.deepcopy(original)
            if kind == 'body':
                mutant[5] = b'\x02' + mutant[5]
            else:
                mutant[1] += 1
            editor.abc.bodies[idx] = mutant
            try:
                editor.replace(label, original[5])
            except Exception as exc:
                assert 'unknown method sha/header' in str(exc), str(exc)
                denied.append({'method': label, 'mutation': kind, 'rejected': True})
            else:
                raise AssertionError('方法锁接受了变异: ' + label)
            finally:
                editor.abc.bodies[idx] = actual
    return denied


def serialized_body(body):
    """逐字段编码完整 method_body_info，涵盖 header、异常表与 body traits。"""
    writer = abcfmt.W()
    for value in body[:5]:
        writer.u30(value)
    writer.u30(len(body[5]))
    writer.raw(body[5])
    writer.u30(len(body[6]))
    for exception in body[6]:
        for value in exception:
            writer.u30(value)
    writer.u30(len(body[7]))
    for trait in body[7]:
        abcfmt.write_trait(writer, trait)
    return writer.out()


def exact_records(before, after, expected):
    labels = bodies.label_map(before.abc)
    changed, same = [], 0
    for index, old in enumerate(before.abc.bodies):
        if serialized_body(old) == serialized_body(after.abc.bodies[index]):
            same += 1
        else:
            changed.append(labels.get(index, '<anonymous body %d>' % index))
    assert set(changed) == expected, changed
    return {'serialized_method_body_records_compared': len(before.abc.bodies),
            'byte_identical_records': same, 'changed_records': sorted(changed)}


def more_static_negative_controls():
    fake = SimpleNamespace(methods=[[0, [], 0, 0, None, None]], multinames=[None])
    loop = asm.assemble([('label', 'BAD'), ('pushbyte', 1), ('pop',), ('jump', 'BAD')])
    cases = {
        'backward_without_real_label': [0, 2, 1, 0, 0, asm.encode(loop)[0], [], []],
        'header_stack_too_small': [0, 0, 1, 0, 0,
                                   asm.encode(asm.assemble([('pushbyte', 1), ('returnvalue',)]))[0], [], []],
        'header_locals_too_small': [0, 1, 1, 0, 0,
                                   asm.encode(asm.assemble([('getlocal', 2), ('returnvalue',)]))[0], [], []],
    }
    result = {}
    for name, body in cases.items():
        try:
            check_body(fake, body)
        except asm.AsmError as exc:
            result[name] = {'rejected': True, 'reason': str(exc)}
        else:
            raise AssertionError('静态检查漏过变异: ' + name)
    return result


def run_cli(*args):
    return subprocess.run([sys.executable, '-B', str(ROOT/'build.py'), *map(str, args)],
                          capture_output=True, text=True, encoding='utf-8')


def rejection_checks(output, release):
    digest = sha(output.read_bytes())
    skipped = run_cli('--input', output, '--output', output)
    assert skipped.returncode == 0, skipped.stderr
    assert json.loads(skipped.stdout)['status'] == 'already_present'
    assert sha(output.read_bytes()) == digest
    outside = ROOT.parent/'run9-forbidden-output.swf'
    assert not outside.exists()
    try:
        output_path(outside)
    except ValueError:
        pass
    else:
        raise AssertionError('越界 output_path 未被拒绝')
    rejected = run_cli('--output', outside)
    assert rejected.returncode != 0 and not outside.exists()
    assert '拒绝写入 run9 以外' in rejected.stderr, rejected.stderr
    same = output_path(ROOT/'work'/'input-equals-output.swf')
    same.write_bytes(BASE.read_bytes())
    before = sha(same.read_bytes())
    rejected = run_cli('--input', same, '--output', same)
    assert rejected.returncode != 0 and sha(same.read_bytes()) == before
    assert '拒绝覆盖输入 SWF' in rejected.stderr, rejected.stderr
    unknown = output_path(ROOT/'work'/'unknown-input.swf')
    data = bytearray(BASE.read_bytes())
    data[3] = (data[3] + 1) % 256
    unknown.write_bytes(data)
    destination = ROOT/'work'/'must-not-exist.swf'
    assert not destination.exists()
    rejected = run_cli('--input', unknown, '--output', destination)
    assert rejected.returncode != 0 and not destination.exists()
    absent_dir = ROOT/'work'/'rejected-input-no-directory'
    assert not absent_dir.exists()
    rejected = run_cli('--input', unknown, '--output', absent_dir/'candidate.swf')
    assert rejected.returncode != 0 and not absent_dir.exists()
    stage_input = ROOT/'work'/'v35h-chained.swf'
    stage_before = sha(stage_input.read_bytes()) if stage_input.exists() else None
    rejected = run_cli('--from-v34', '--output', stage_input)
    assert rejected.returncode != 0 and '拒绝覆盖串联输入 SWF' in rejected.stderr
    assert (sha(stage_input.read_bytes()) if stage_input.exists() else None) == stage_before
    # 与所有最终方法锁一致，仅SWF版本改变，也必须由整包锁拒绝。
    final_unknown=output_path(ROOT/'work'/'unknown-final-envelope.swf')
    data=bytearray(output.read_bytes())
    data[3]=(data[3]+1)%256
    final_unknown.write_bytes(data)
    rejected=run_cli('--input',final_unknown,'--output',destination)
    assert rejected.returncode!=0 and not destination.exists()
    assert '方法锁匹配但整包不同' in rejected.stderr,rejected.stderr
    return {'cli_already_present_in_place_unchanged': True,
            'output_boundary_rejection': True, 'cli_output_boundary_no_write': True,
            'input_equals_output_rejection': True, 'input_equals_output_sha_unchanged': True,
            'unknown_input_creates_no_output_directory': True,
            'chain_input_overlap_rejected_before_stage_writes': True,
            'matching_final_methods_unknown_envelope_rejected_without_output':True,
            'unknown_input_no_output': True}


def release_lock_negatives(output, release):
    swf = SwfAbc(output)
    denied = []
    probe = output_path(ROOT/'work'/'release-lock-mutant.swf')
    for label in sorted(EXPECTED_CHANGED | EXPECTED_ADDED):
        index = bodies.resolve(swf.abc, label)
        original = swf.abc.bodies[index]
        for kind in ('body', 'header'):
            mutated = copy.deepcopy(original)
            if kind == 'body':
                mutated[5] = b'\x02' + mutated[5]
            else:
                mutated[1] += 1
            swf.abc.bodies[index] = mutated
            try:
                probe.write_bytes(swf.serialize())
                verify_input(probe, release)
            except ValueError as exc:
                assert 'unknown method sha/header' in str(exc), str(exc)
                denied.append({'method': label, 'mutation': kind, 'rejected': True})
            else:
                raise AssertionError('最终方法锁接受了变异: ' + label)
            finally:
                swf.abc.bodies[index] = original
    return denied


def verify():
    sources_before = source_snapshot()
    release = json.loads((ROOT/'release-locks.json').read_text(encoding='utf-8'))
    output = ROOT/'v35i.swf'
    assert verify_input(BASE, release) == 'ready'
    assert verify_input(output, release) == 'already_present'
    digest = sha(output.read_bytes())
    cli_evidence = rejection_checks(output, release)
    raw, root = construct()
    assert raw == output.read_bytes(), '重放非逐字节一致'
    assert release_record(raw, root) == release
    by_abc, denied, byte_records, reversible = {}, [], {}, []
    changed, added = [], []
    for tag, editor in editors(root):
        before, after = SwfAbc(BASE, tag=tag.encode()), SwfAbc(output, tag=tag.encode())
        result = compare(before, after, set(editor.report), abc_only=True)
        by_abc[tag] = result
        byte_records[tag] = exact_records(before, after, set(editor.report))
        changed.extend(result['changed_methods'])
        added.extend(result['added_methods'])
        denied.extend(dict(item, abc=tag) for item in check_locks(editor))
        reversible.extend(reversible_targets(editor))
        result['byte_exact_unchanged_abc_scaffolding'] = unchanged_scaffolding(
            before, after, set(editor.report))
    assert set(changed) == EXPECTED_CHANGED, changed
    assert set(added) == EXPECTED_ADDED, added
    assert set(by_abc) == {'boot_ffc6'}, list(by_abc)
    outer = envelope(SwfAbc(BASE), SwfAbc(output), set(by_abc))
    before_tags = abc_tags(BASE.read_bytes())
    after_tags = abc_tags(output.read_bytes())
    assert len(before_tags) == len(after_tags)
    total, other_abcs = 0, []
    for ordinal, (old_tag, new_tag) in enumerate(zip(before_tags, after_tags)):
        tag, data = old_tag[0], old_tag[4]
        assert tag == new_tag[0], 'ABC tag 顺序变化'
        count = len(ABC(data).bodies)
        total += count
        if tag.decode() not in by_abc:
            assert data == new_tag[4]
            other_abcs.append({'abc': tag.decode(), 'abc_ordinal': ordinal, 'body_count': count,
                               'sha256': sha(data), 'byte_identical': True})
    replay_path = ROOT/'work'/'v35i-replayed.swf'
    replay = run_cli('--output', replay_path)
    assert replay.returncode == 0, replay.stderr
    assert json.loads(replay.stdout)['sha256'] == digest
    assert replay_path.read_bytes() == raw
    chain_path = ROOT/'work'/'v35i-chained.swf'
    chain = run_cli('--from-v34', '--output', chain_path)
    assert chain.returncode == 0, chain.stderr
    assert json.loads(chain.stdout)['sha256'] == digest
    assert chain_path.read_bytes() == raw
    release_negatives = release_lock_negatives(output, release)
    source_manifest = freeze_evidence(sources_before, output)
    return {'baseline_state': 'ready', 'output_state': 'already_present',
            **cli_evidence, 'static_negative_controls': {
                **negative_controls(), **more_static_negative_controls()},
            'byte_identical_replay': True, 'ordinary_cli_replay_byte_identical': True,
            'v34_chain_byte_identical': True,
            'method_lock_negative_cases': denied,
            'original_code_reversible': reversible,
            'release_lock_negative_cases': release_negatives,
            'abcs': by_abc, 'serialized_body_record_comparison': byte_records,
            'envelope': outer, 'other_abcs': other_abcs,
            'changed_methods': sorted(changed), 'added_methods': sorted(added),
            'whole_swf_original_body_count': total,
            'whole_swf_unchanged_body_records': total-len(changed),
            'input_sha256': sha(BASE.read_bytes()), 'output_sha256': digest,
            'verification_source_manifest': source_manifest}


if __name__ == '__main__':
    result = verify()
    output_path(ROOT/'framework-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'pass': True, 'changed': len(result['changed_methods']),
                      'unchanged': result['whole_swf_unchanged_body_records']}))
