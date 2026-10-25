"""Regenerate equipment helpers in a pinned current ABC; never write a package.

The original L7 donor and corrected production transformations are the inputs.
Method declarations, class layouts and every unrelated body remain frozen.
Native integration is a separate, unapplied plan in native_preload.py.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

import prepare_ios as prep


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def body_index(abc, mid):
    index, = [i for i, body in enumerate(abc.bodies) if body[0] == mid]
    return index


def local(ins):
    return ins.op - 212 if 212 <= ins.op <= 215 else int(ins.args[0])


def regenerate(full_raw, donor_path):
    if not __debug__:
        raise RuntimeError('Optimized Python disables required identity assertions')
    p = prep.p
    current = prep.abcfmt.ABC(full_raw)
    if len(current.methods) != 101496:
        raise AssertionError('This repair requires the reviewed 101496-method current ABC')
    _, donor = prep.main_abc(donor_path)
    target = copy.deepcopy(current)
    before, dest, source = prep.view(current), prep.view(target), prep.view(donor)
    owner, = [i for i, row in enumerate(target.instances) if target.mn_name(row[0]) == prep.HELPER]
    helpers = {target.mn_name(t.name).rsplit('::', 1)[-1]: t.data[2]
               for t in target.classes[owner][1] if t.data[0] == 'method'}
    entries = [(label, name, prep.transform_static_rule_body)
               for label, name, _params, _ret in prep.RULE_METHODS]
    entries += [(prep.OWNER + '/wfPreloadEquipmentTiers|1', 'authorEquipmentPreloadTiers', prep.transform_preload_body),
                (prep.OWNER + '/resolvePathCollection|1/closure:0', 'authorEquipmentResolveAbilityPaths', prep.transform_resolve_helper)]
    assert [helpers[name] for _, name, _ in entries] == list(range(101437, 101444))
    importer = p.Importer(dest, source)
    for label, name, _ in entries:
        importer.methods[prep.method_id_for_label(source, label)] = helpers[name]
    expected = {101439: {3: (3, 4)}, 101442: {4: (2, 5), 14: (2, 5), 17: (3, 6), 78: (2, 5), 87: (3, 6)},
                101443: {9: (2, 7), 13: (3, 8)}}
    records = []
    for label, name, transform in entries:
        mid = helpers[name]
        bi = body_index(target, mid)
        imported = importer.body(source.by_label[label][0], mid)
        if transform is prep.transform_resolve_helper:
            transform(imported, dest)
        else:
            transform(imported, dest, helpers)
        p.check_body(imported, target)
        assert p.freeze(imported[:5] + imported[6:]) == p.freeze(current.bodies[bi][:5] + current.bodies[bi][6:])
        target.bodies[bi] = imported
        left, le = before.normalized(bi)
        right, re = prep.view(target).normalized(bi)
        assert len(left) == len(right) and le == re
        changed = [i for i, (a, b) in enumerate(zip(left, right)) if a != b]
        assert changed == list(expected.get(mid, {})), (mid, changed)
        oi, ni = p.asm.decode(current.bodies[bi][5]), p.asm.decode(imported[5])
        for index in changed:
            assert oi[index].name.startswith('setlocal') and ni[index].name.startswith('setlocal')
            assert (local(oi[index]), local(ni[index])) == expected[mid][index]
        records.append({'method_id': mid, 'helper': name, 'donor_label': label,
                        'current_body_sha256': digest(current.bodies[bi][5]),
                        'candidate_body_sha256': digest(imported[5]), 'changed_instructions': changed})
    resolver = prep.method_id_for_label(dest, prep.OWNER + '/resolvePathCollection|1')
    assert resolver == 18392 and dest.by_label[prep.OWNER + '/resolvePathCollection|1'] == [17701]
    frozen = ('ints', 'uints', 'doubles', 'strings', 'namespaces', 'ns_sets', 'multinames',
              'methods', 'metadata', 'instances', 'classes', 'scripts')
    for field in frozen:
        assert p.freeze(getattr(current, field)) == p.freeze(getattr(target, field)), field
    actual_changed = [b[0] for a, b in zip(current.bodies, target.bodies) if p.freeze(a) != p.freeze(b)]
    assert actual_changed == [101439, 101442, 101443], actual_changed
    raw = target.serialize()
    saved = prep.abcfmt.ABC(raw)
    for field in (*frozen, 'bodies'):
        assert p.freeze(getattr(saved, field)) == p.freeze(getattr(target, field)), ('readback', field)
    return raw, {'status': 'candidate_ABC_generated_and_read_back', 'method_count': len(saved.methods),
                 'generated_helpers': records, 'changed_method_bodies': actual_changed,
                 'changed_store_count': sum(len(r['changed_instructions']) for r in records),
                 'resolver_method_id': resolver, 'resolver_body_index': 17701,
                 'declarations_pools_layouts_and_unrelated_bodies_preserved': True,
                 'native_linked': False, 'package_built': False, 'device_tested': False}


def main():
    if not __debug__:
        raise RuntimeError('Run without -O: required identity assertions must remain enabled')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--full-abc', required=True, type=Path)
    parser.add_argument('--input-sha256', required=True)
    parser.add_argument('--donor-swf', required=True, type=Path)
    parser.add_argument('--donor-sha256', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    raw, donor_raw = args.full_abc.read_bytes(), args.donor_swf.read_bytes()
    assert digest(raw) == args.input_sha256, 'Current ABC input identity changed'
    assert digest(donor_raw) == args.donor_sha256 == prep.DONOR_SWF_SHA256, 'Donor identity changed'
    output = args.output_dir / 'equipment-fixed-full.abc'
    assert output.resolve() not in (args.full_abc.resolve(), args.donor_swf.resolve()), 'Cannot overwrite inputs'
    report_path = args.output_dir / 'generation.json'
    if output.exists() or report_path.exists():
        raise FileExistsError('Use a new output directory to preserve candidate evidence')
    result, report = regenerate(raw, args.donor_swf)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream:
        stream.write(result)
    report.update({'input_path': str(args.full_abc), 'input_sha256': digest(raw),
                   'donor_path': str(args.donor_swf), 'donor_sha256': digest(donor_raw),
                   'output_path': str(output), 'output_sha256': digest(output.read_bytes()),
                   'generator_sha256': digest(Path(__file__).read_bytes()),
                   'transform_sha256': digest(Path(prep.__file__).read_bytes()),
                   'limits': ['Private full ABC, not an installable game or a native repair.',
                              'The legacy static Object bridge remains reserved and must not be called from the typed resolver ABI.']})
    with report_path.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('status', 'changed_method_bodies', 'changed_store_count', 'output_sha256')}))


if __name__ == '__main__':
    main()
