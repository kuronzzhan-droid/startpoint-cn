"""Independent SWF checks for append-only pools and declared P-code edits."""
from types import SimpleNamespace

from build_common import PATCH, load


def body_bytes(support, body):
    writer = support.m.abcfmt.W()
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
        support.m.abcfmt.write_trait(writer, trait)
    return writer.out()


def inventory(support, tags):
    abcs, order = {}, []
    for tag in tags:
        if tag[0] != 82:
            order.append(('tag', tag[1]))
            continue
        name = tag[2][4:-1].decode('utf-8')
        key, count = name, 1
        while key in abcs:
            count += 1
            key = f'{name}#{count}'
        bodies = [body_bytes(support, body) for body in tag[3].bodies]
        if not tag[4].endswith(b''.join(bodies)):
            raise ValueError(f'ABC body records are not byte-exact: {key}')
        abcs[key] = (tag, bodies)
        order.append(('abc', key))
    return abcs, order


def verify_patch(source, target, expected_changed_bodies, expected_helpers):
    """Verify actual SWF bytes, without trusting a plugin's claims."""
    support = load('pipeline_guard_support', PATCH / 'startup-cache/build_swf.py')
    version0, header0, tags0 = support.parts(source)
    version1, header1, tags1 = support.parts(target)
    if (version0, header0) != (version1, header1):
        raise ValueError('SWF version/frame header changed')
    before, order0 = inventory(support, tags0)
    after, order1 = inventory(support, tags1)
    helpers = set(after) - set(before)
    if not set(before) <= set(after) or helpers != set(expected_helpers):
        raise ValueError('Unexpected removed/added ABC helper')
    if order0 != [row for row in order1 if row[0] != 'abc' or row[1] not in helpers]:
        raise ValueError('Original tag order or non-ABC resource changed')
    changed, details, unchanged = [], [], 0
    for name, (old_tag, old_raw) in before.items():
        new_tag, new_raw = after[name]
        old, new = old_tag[3], new_tag[3]
        if old_tag[2] != new_tag[2]:
            raise ValueError(f'ABC name/flags changed: {name}')
        if (old.major, old.minor, len(old_raw)) != (new.major, new.minor, len(new_raw)):
            raise ValueError(f'ABC version/body count changed: {name}')
        for field in ('methods', 'instances', 'classes', 'scripts', 'metadata'):
            if support.m.freeze(getattr(old, field)) != support.m.freeze(getattr(new, field)):
                raise ValueError(f'Class layout/signature changed: {name}:{field}')
        for field in ('strings', 'ints', 'uints', 'doubles', 'namespaces', 'ns_sets', 'multinames'):
            prefix = getattr(old, field)
            if support.m.freeze(prefix) != support.m.freeze(getattr(new, field)[:len(prefix)]):
                raise ValueError(f'Constant pool prefix changed: {name}:{field}')
        view = None
        for index, (left, right) in enumerate(zip(old_raw, new_raw)):
            if left == right:
                unchanged += 1
                continue
            key = f'{name}:{index}'
            changed.append(key)
            if old.bodies[index][0] != new.bodies[index][0] or support.m.freeze(
                    old.bodies[index][7]) != support.m.freeze(new.bodies[index][7]):
                raise ValueError(f'Method identity/body traits changed: {key}')
            check = support.m.check_body(new.bodies[index], new)
            if view is None:
                view = support.m.View(SimpleNamespace(abc=new), support.m.asm)
            labels = [label for label, ids in view.by_label.items() if index in ids]
            details.append({'key': key, 'labels': labels,
                            'before_sha256': support.sha(left), 'after_sha256': support.sha(right),
                            'pcode_check': check})
        # Appended pools without any declared method use are not an accepted edit.
        if old_tag[1] != new_tag[1] and old_raw == new_raw:
            raise ValueError(f'ABC changed without a method-body edit: {name}')
    if set(changed) != set(expected_changed_bodies):
        raise ValueError(f'Declared body changes differ: actual={sorted(changed)}')
    helper_details = []
    for name in sorted(helpers):
        abc = after[name][0][3]
        checks = [support.m.check_body(body, abc) for body in abc.bodies]
        helper_details.append({'name': name, 'sha256': support.sha(after[name][0][1]),
                               'method_bodies': len(checks), 'pcode_checks_passed': True})
    return {'passed': True, 'changed_bodies': sorted(changed), 'helpers': sorted(helpers),
            'unchanged_original_bodies': unchanged, 'changed_body_details': details,
            'helper_details': helper_details, 'original_class_layout_preserved': True,
            'constant_pool_prefixes_preserved': True, 'non_abc_tags_preserved': True}
