"""独立于业务补丁的指令插入、完整 ABC 与 SWF 保持性证明。"""
import copy
import bootstrap
import asm
import bodies
from bootstrap import sha
from common import ABC, abc_tags, freeze
from static_check import check_body


def restore_inserted_body(before, after, placements):
    """只删除记录的插入块，并逆映射异常区间；原方法指令必须完全恢复。"""
    restored = copy.deepcopy(after)
    for at, count, policy in reversed(placements):
        assert policy in asm.INCOMING_POLICIES
        ins = asm.decode(restored[5])
        _, old_offsets = asm.encode(ins)
        raw = asm.unsplice(restored[5], at, count)
        _, new_offsets = asm.encode(asm.decode(raw))
        kept = list(range(at)) + list(range(at + count, len(ins)))
        mapping = {old_offsets[old]: new_offsets[new] for new, old in enumerate(kept)}
        mapping[len(restored[5])] = len(raw)
        exceptions = []
        for start, end, target, exception_type, variable in restored[6]:
            assert all(x in mapping for x in (start, end, target)), 'exception inside inserted code'
            exceptions.append((mapping[start], mapping[end], mapping[target], exception_type, variable))
        restored[5], restored[6] = raw, exceptions
    # 拼接器只允许为实际需求扩大 maxstack/localcount；作用域和原槽位保持。
    assert after[1] >= before[1] and after[2] >= before[2]
    assert after[3:5] == before[3:5], 'existing method scope header changed'
    restored[1:5] = before[1:5]
    assert freeze(restored) == freeze(before), 'removing insertions did not restore original method record'
    return {'inserted_blocks': len(placements), 'before_sha256': sha(before[5]),
            'restored_sha256': sha(restored[5]), 'exceptions_restored': True,
            'complete_method_record_restored': True}


def unchanged_scaffolding(before_swf, after_swf, changed_labels):
    """去掉明确许可的尾增并还原目标方法，主 ABC 必须逐字节恢复。"""
    before, restored = before_swf.abc, copy.deepcopy(after_swf.abc)
    appended_strings = restored.strings[len(before.strings):]
    added_bodies = len(restored.bodies) - len(before.bodies)
    added_multinames = len(restored.multinames) - len(before.multinames)
    for name in ('strings', 'multinames', 'methods', 'bodies'):
        setattr(restored, name, getattr(restored, name)[:len(getattr(before, name))])
    for index, old in enumerate(before.instances):
        restored.instances[index][6] = restored.instances[index][6][:len(old[6])]
        restored.classes[index][1] = restored.classes[index][1][:len(before.classes[index][1])]
    for label in changed_labels:
        index = bodies.resolve(before, label)
        assert index == bodies.resolve(restored, label)
        restored.bodies[index] = copy.deepcopy(before.bodies[index])
    raw = restored.serialize()
    assert raw == before_swf._raw, 'non-target ABC bytes changed'
    return {'restored_target_bodies': sorted(changed_labels),
            'removed_appended_strings': [s.decode('utf-8') for s in appended_strings],
            'removed_appended_multinames': added_multinames,
            'removed_appended_method_bodies': added_bodies,
            'original_abc_sha256': sha(before_swf._raw), 'restored_abc_sha256': sha(raw),
            'all_pools_signatures_classes_traits_scripts_and_other_bodies_byte_identical': True}


def compare(before_swf, after_swf, expected_labels):
    assert before_swf.signature == after_swf.signature and before_swf.version == after_swf.version
    before, after = before_swf.abc, after_swf.abc
    original_labels = bodies.label_map(before)
    changed, static = [], {}
    assert len(after.bodies) >= len(before.bodies), 'deleted method bodies'
    for index, old in enumerate(before.bodies):
        new = after.bodies[index]
        if freeze(old) != freeze(new):
            label = original_labels.get(index, f'<anonymous body {index}>')
            changed.append(label)
            assert label in expected_labels, 'unexpected changed body: ' + label
            assert old[0] == new[0] and freeze(old[7]) == freeze(new[7]), 'method/trait rewrite'
            static[label] = check_body(after, new)
    assert set(changed) == set(expected_labels), (changed, expected_labels)
    labels_after, added = bodies.label_map(after), []
    for index in range(len(before.bodies), len(after.bodies)):
        label = labels_after.get(index)
        assert label is not None, f'new unattached or anonymous body {index}'
        added.append(label)
        static[label] = check_body(after, after.bodies[index])
    assert len(after.methods) - len(before.methods) == len(added), 'new method signatures/bodies differ'
    appended_method_ids = set(range(len(before.methods), len(after.methods)))
    assert {body[0] for body in after.bodies[len(before.bodies):]} == appended_method_ids
    for label in changed + added:
        for item in asm.decode(after.bodies[bodies.resolve(after, label)][5]):
            if item.name == 'getlex':
                assert item.args[0] < len(before.multinames), 'getlex of new name: ' + label

    pools = ('ints', 'uints', 'doubles', 'strings', 'namespaces', 'ns_sets', 'multinames')
    pool_report = {}
    for name in pools:
        if not hasattr(before, name):
            continue
        old, new = getattr(before, name), getattr(after, name)
        assert repr(freeze(old)) == repr(freeze(new[:len(old)])), 'pool prefix changed: ' + name
        if name not in ('strings', 'multinames'):
            assert len(old) == len(new), 'TASK13 pool growth forbidden: ' + name
        pool_report[name] = {'before': len(old), 'after': len(new), 'prefix_unchanged': True}
    for row in after.multinames[len(before.multinames):]:
        assert row[0] == 7 and row[1] < len(before.namespaces), 'only QName tails in old namespaces'
        assert 0 < row[2] < len(after.strings), 'invalid appended QName string'
    assert freeze(before.methods) == freeze(after.methods[:len(before.methods)]), 'method signatures changed'
    assert freeze(before.metadata) == freeze(after.metadata), 'metadata changed'
    assert freeze(before.scripts) == freeze(after.scripts), 'scripts changed'
    assert len(before.instances) == len(after.instances) and len(before.classes) == len(after.classes), 'new class'
    appended_traits = []
    for index, old in enumerate(before.instances):
        new = after.instances[index]
        assert freeze(old[:6]) == freeze(new[:6]), 'instance header changed'
        assert freeze(old[6]) == freeze(new[6][:len(old[6])]), 'existing instance traits changed'
        cls = before.mn_name(old[0])
        for trait in new[6][len(old[6]):]:
            assert trait.kind == 1, 'TASK13 forbids new instance slots'
            assert trait.data[2] in appended_method_ids, 'new instance trait does not reference new helper'
            appended_traits.append({'class': cls, 'static': False, 'name': after.mn_name(trait.name), 'kind': trait.kind})
        old_c, new_c = before.classes[index], after.classes[index]
        assert old_c[0] == new_c[0], 'class initializer changed'
        assert freeze(old_c[1]) == freeze(new_c[1][:len(old_c[1])]), 'existing static traits changed'
        for trait in new_c[1][len(old_c[1]):]:
            assert trait.kind in (0, 1), 'only static slot/method additions allowed'
            if trait.kind == 1:
                assert trait.data[2] in appended_method_ids, 'new static trait does not reference new helper'
            appended_traits.append({'class': cls, 'static': True, 'name': after.mn_name(trait.name), 'kind': trait.kind})

    assert before_swf._prefix == after_swf._prefix, 'main DoABC prefix changed'
    assert before_swf.body[:before_swf._offset] == after_swf.body[:after_swf._offset], 'SWF prefix changed'
    assert before_swf.body[before_swf._offset + before_swf._length:] == after_swf.body[
        after_swf._offset + after_swf._length:], 'SWF suffix changed'
    before_tags = abc_tags(before_swf.path.read_bytes())
    after_tags = abc_tags(after_swf.path.read_bytes())
    assert len(before_tags) == len(after_tags), 'DoABC count changed'
    other_abcs = []
    for sequence, (old, new) in enumerate(zip(before_tags, after_tags)):
        assert old[0] == new[0] and old[3] == new[3], 'DoABC order/prefix changed'
        if old[0] == b'boot_ffc6':
            continue
        assert old[4] == new[4], 'non-main DoABC changed'
        other_abcs.append({'sequence': sequence, 'tag': old[0].decode('utf-8'),
                           'sha256': sha(old[4]), 'body_count': len(ABC(old[4]).bodies),
                           'byte_identical': True})
    total = len(before.bodies) + sum(row['body_count'] for row in other_abcs)
    return {'original_body_count': len(before.bodies),
            'unchanged_body_records': len(before.bodies) - len(changed),
            'whole_swf_original_body_count': total,
            'whole_swf_unchanged_body_records': total - len(changed),
            'other_abc_tags': other_abcs, 'changed_methods': sorted(changed), 'added_methods': added,
            'appended_traits': appended_traits, 'constant_pools': pool_report,
            'existing_method_signatures_unchanged': True, 'existing_class_traits_unchanged': True,
            'getlex_only_baseline_multinames': True, 'non_main_abc_tags_byte_identical': True,
            'static_checks': static}
