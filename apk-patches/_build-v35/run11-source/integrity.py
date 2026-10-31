"""完整 ABC/SWF 保持性证明，独立于各功能构造代码。"""
import copy
import hashlib
import bootstrap
import asm
import bodies
from common import ABC, abc_tags, freeze
from static_check import check_body


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def unchanged_scaffolding(before_swf, after_swf, changed_labels):
    """移除允许的尾部追加并还原目标body；整个ABC须逐字节恢复。"""
    before, restored = before_swf.abc, copy.deepcopy(after_swf.abc)
    appended_strings = restored.strings[len(before.strings):]
    added_bodies = len(restored.bodies)-len(before.bodies)
    added_multinames = len(restored.multinames)-len(before.multinames)
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
            'original_abc_sha256': digest(before_swf._raw),
            'restored_abc_sha256': digest(raw),
            'all_pools_signatures_classes_traits_scripts_and_other_bodies_byte_identical': True}


def compare(before_swf, after_swf, expected_labels, abc_only=False):
    assert before_swf.signature == after_swf.signature and before_swf.version == after_swf.version, 'SWF format/version changed'
    before, after = before_swf.abc, after_swf.abc
    original_labels = bodies.label_map(before)
    changed = []
    static = {}
    assert len(after.bodies) >= len(before.bodies), 'deleted method bodies'
    for i, old in enumerate(before.bodies):
        new = after.bodies[i]
        if freeze(old) != freeze(new):
            label = original_labels.get(i, f'<anonymous body {i}>')
            changed.append(label)
            assert label in expected_labels, 'unexpected changed body: ' + label
            assert old[0] == new[0] and freeze(old[7]) == freeze(new[7]), 'method/trait rewrite'
            static[label] = check_body(after, new)
    assert set(changed) == set(expected_labels), (changed, expected_labels)
    labels_after = bodies.label_map(after)
    added = []
    for i in range(len(before.bodies), len(after.bodies)):
        label = labels_after.get(i)
        assert label is not None, f'new unattached or anonymous body {i}'
        added.append(label)
        static[label] = check_body(after, after.bodies[i])
    injected_getlex = []
    for label in changed + added:
        body = after.bodies[bodies.resolve(after, label)]
        for item in asm.decode(body[5]):
            if item.name == 'getlex':
                assert item.args[0] < len(before.multinames), 'getlex of new name: ' + label
                injected_getlex.append(after.mn_name(item.args[0]))
            if label in added and item.name in ('callproperty', 'callpropvoid'):
                name = after.mn_name(item.args[0]).split('::')[-1]
                assert name != 'getMasterTable', 'throwing master read in added helper: ' + label

    # Existing pool entries, method signatures, scripts and metadata stay exact.
    pools = ('ints', 'uints', 'doubles', 'strings', 'namespaces', 'ns_sets', 'multinames')
    pool_report = {}
    for name in pools:
        if not hasattr(before, name):
            continue
        old, new = getattr(before, name), getattr(after, name)
        # NaN must compare through representation, not floating point equality.
        assert repr(freeze(old)) == repr(freeze(new[:len(old)])), 'pool prefix changed: ' + name
        if name in ('ints', 'uints', 'doubles', 'namespaces', 'ns_sets'):
            assert len(old) == len(new), 'TASK11 pool growth forbidden: ' + name
        pool_report[name] = {'before': len(old), 'after': len(new), 'prefix_unchanged': True}
    assert freeze(before.methods) == freeze(after.methods[:len(before.methods)]), 'existing method signatures changed'
    assert freeze(before.metadata) == freeze(after.metadata), 'metadata changed'
    assert freeze(before.scripts) == freeze(after.scripts), 'scripts changed'
    assert len(before.instances) == len(after.instances), 'new class introduced'
    assert len(before.classes) == len(after.classes), 'new class introduced'
    appended_traits = []
    for i, old in enumerate(before.instances):
        new = after.instances[i]
        assert freeze(old[:6]) == freeze(new[:6]), 'instance header changed'
        assert freeze(old[6]) == freeze(new[6][:len(old[6])]), 'existing instance traits changed'
        cls = before.mn_name(old[0])
        for trait in new[6][len(old[6]):]:
            assert trait.kind == 1, 'TASK11 forbids new instance slots'
            appended_traits.append({'class': cls, 'static': False, 'name': after.mn_name(trait.name), 'kind': trait.kind})
        old_c, new_c = before.classes[i], after.classes[i]
        assert old_c[0] == new_c[0], 'class initializer changed'
        assert freeze(old_c[1]) == freeze(new_c[1][:len(old_c[1])]), 'existing static traits changed'
        for trait in new_c[1][len(old_c[1]):]:
            assert trait.kind in (0, 1), 'only static slot/method additions allowed'
            appended_traits.append({'class': cls, 'static': True, 'name': after.mn_name(trait.name), 'kind': trait.kind})
    if not abc_only:
        assert before_swf.body[:before_swf._offset] == after_swf.body[:after_swf._offset]
        assert before_swf.body[before_swf._offset + before_swf._length:] == after_swf.body[after_swf._offset + after_swf._length:]
    assert before_swf._prefix == after_swf._prefix
    other_abcs = []
    for tag, _, _, _, raw in ([] if abc_only else abc_tags(before_swf.path.read_bytes())):
        if tag == b'boot_ffc6':
            continue
        other_abcs.append({'tag': tag.decode('utf-8'), 'sha256': digest(raw),
                           'body_count': len(ABC(raw).bodies), 'byte_identical': True})
    other_count = sum(x['body_count'] for x in other_abcs)
    return {'original_body_count': len(before.bodies), 'unchanged_body_records': len(before.bodies) - len(changed),
            'whole_swf_original_body_count': len(before.bodies) + other_count,
            'whole_swf_unchanged_body_records': len(before.bodies) + other_count - len(changed),
            'other_abc_tags': other_abcs,
            'changed_methods': sorted(changed), 'added_methods': added,
            'appended_traits': appended_traits, 'constant_pools': pool_report,
            'existing_method_signatures_unchanged': True, 'existing_class_traits_unchanged': True,
            'getlex_only_baseline_multinames': True,
            'new_helpers_no_throwing_getMasterTable': True,
            'non_main_abc_tags_byte_identical': True, 'static_checks': static}
