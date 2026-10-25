"""Independently verify one-link R11 against the retained staged candidate.

No linking, compilation, package mutation or execution occurs here. Original
object ownership is derived from the three old stage manifests; the cumulative
builder's ownership claims never decide which compiled definition is accepted.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
from pathlib import Path
import re
import struct
import sys
from types import SimpleNamespace
import zipfile

import verify_stages as stage

FINAL_FULL_SHA = 'ff1ac16421ed0d394b70612aed23584e30c0aa9ec1de0eebe4336cc1cb396388'
REFERENCE_IPAS = {
    'equipment': '587aa1f7c56f9cdc8b97b55ea20aa7c5c759c7afa1edcc66bf26dd246376f75c',
    'operations': 'f776d28265e1fbb70fb007e04fad05614c2a90f1e54c556b31a00111270e778c',
    'profile': 'ac9a31fc6af39a607e9acdf5201ba0d80e74c5db24b5409061c9f1c5c8cc5b06',
    'town': 'a4f5e01ce16273a044bfda278b557189486f34f36548d095f23807a7d8fc2707',
}
require, sha, read, dump = stage.require, stage.sha, stage.read, stage.dump
ORIGINAL_OBJECT = stage.Object


def method_id(name):
    match = re.search(r':(\d+):', name)
    return int(match.group(1)) if match else None


def select_functions(references):
    """Last stage wins, with explicit rejection of unexplained overlaps."""
    selected, overlaps = {}, []
    for name, linked in references:
        seen = set()
        for row in linked['functions']:
            mid = int(row['method'])
            require(mid >= 0 and mid not in seen, 'Duplicate/unsupported reference function')
            seen.add(mid)
            if mid in selected:
                overlaps.append((mid, selected[mid]['stage'], name))
            selected[mid] = dict(stage=name, row=row, linked=linked)
    require(overlaps == [(52124, 'operations', 'town')], 'Unexpected replacement overlap')
    require(len(selected) == 231 and sum(m < 101496 for m in selected) == 129
            and set(range(101496, 101598)) <= selected.keys(), 'Cumulative target set changed')
    return selected


def visible_definitions(obj, object_stage, selected, metadata_stage='town'):
    result = {}
    for name, symbol in obj.defined.items():
        mid = method_id(name)
        if mid is not None and (mid not in selected or selected[mid]['stage'] != object_stage):
            continue
        if name.endswith('_284_aotInfo') and object_stage != metadata_stage:
            continue
        result[name] = symbol
    return result


def load_references(root):
    references, objects, object_stages, reference_packages = [], {}, {}, {}
    for name in ('operations', 'profile', 'town'):
        linked_path = root / name / 'linked/link-report.json'
        linked = read(linked_path)
        require(linked['status'] == 'linked_native_not_executed' and linked['unwind_finalized'],
                'Reference stage not finalized')
        require(not linked.get('generated_initializers'), 'Unexpected generated reference initializer')
        package_path, = [p for p in (root / name).glob('*.json') if read(p).get('link_report') == str(linked_path)]
        package = read(package_path)
        require(package['ipa_sha256'] == REFERENCE_IPAS[name], 'Reference package pin changed')
        proof = read(root / name / 'independent-verification.json')
        require(proof['status'] == 'independent_actual_stage_package_readback_passed'
                and proof['ipa_sha256'] == package['ipa_sha256'] and proof['native_sha256'] == linked['native_sha256'],
                'Reference independent evidence mismatch')
        prepared_path = Path(linked['source_prepare_report'])
        prepared, compiled = read(prepared_path), read(linked['compiled_report'])
        require(sha(prepared_path.read_bytes()) == linked['prepared_report_sha256'] == compiled['prepared_report_sha256'],
                'Reference preparation/compilation lineage')
        full = Path(linked['full_abc_file']).read_bytes()
        require(sha(full) == linked['full_abc_sha256'] == compiled['full_abc_sha256']
                and prepared['full_abc_sha256'] == sha(full), 'Reference full ABC identity')
        for row in compiled['objects']:
            path = (Path(compiled['directory']) / row['name']).resolve()
            key = str(path)
            require(key not in objects, 'Object reused across independent stages')
            objects[key] = ORIGINAL_OBJECT(path, row['sha256'])
            object_stages[key] = name
        linked['_verified_compiled'] = compiled
        references.append((name, linked))
        reference_packages[name] = package
    selected = select_functions(references)
    for mid, chosen in selected.items():
        candidates = [(key, obj, name) for key, obj in objects.items() if object_stages[key] == chosen['stage']
                      for name in obj.defined if method_id(name) == mid]
        require(len(candidates) == 1, 'Reference method object ownership is ambiguous: ' + str(mid))
        key, obj, name = candidates[0]
        fn = obj.function(name)
        require(len(fn['data']) == chosen['row']['size'], 'Reference function/object size mismatch')
        chosen.update(object_path=key, function=fn, symbol=name)
    return references, selected, objects, object_stages, reference_packages


def make_object_view(objects, object_stages, selected):
    class ReferenceOwnedObject(ORIGINAL_OBJECT):
        def __init__(self, path, expected_hash):
            key = str(Path(path).resolve())
            if key not in objects:
                # Existing runtime helper proofs refer to separate retained objects.
                super().__init__(path, expected_hash)
                return
            source = objects[key]
            require(sha(source.raw) == expected_hash, 'Cumulative object differs from original source')
            self.__dict__.update(source.__dict__)
            self.defined = visible_definitions(source, object_stages[key], selected)
    return ReferenceOwnedObject


def verify_compilation_set(linked, objects, object_stages, selected):
    compiled = read(linked['compiled_report'])
    listed = {}
    for row in compiled['objects']:
        key = str((Path(compiled['directory']) / row['name']).resolve())
        require(key in objects and key not in listed, 'Unknown or duplicate cumulative object')
        require(sha(objects[key].raw) == row['sha256'], 'Cumulative object hash changed')
        listed[key] = row
    required = {value['object_path'] for value in selected.values()}
    required.update(key for key, obj in objects.items() if object_stages[key] == 'town'
                    and any(n.endswith('_284_aotInfo') for n in obj.defined))
    require(required <= listed.keys(), 'Selected source object missing from cumulative compilation')
    require({int(x['method']) for x in linked['functions']} == selected.keys()
            and len(linked['functions']) == len(selected), 'Candidate function coverage changed')
    return compiled


def validate_runtime_bodies(equipment, reference, candidate, references, selected, objects, object_stages):
    """Compare bodies structurally; do not use the builder's serialization path."""
    from build_swf import abcfmt, freeze
    def runtime(image):
        return image.read(stage.u64(image.raw, stage.INFO + 24), stage.u64(image.raw, stage.INFO + 32))
    expected_bytes, actual_bytes = runtime(reference), runtime(candidate)
    require(expected_bytes == actual_bytes, 'Final runtime ABC differs from retained town bytes')
    baseline, actual = abcfmt.ABC(runtime(equipment)), abcfmt.ABC(actual_bytes)
    baseline_bodies = {b[0]: b for b in baseline.bodies}
    compilers = {}
    for source_stage, linked in references:
        meta, = [obj for key, obj in objects.items() if object_stages[key] == source_stage
                 and any(n.endswith('_284_aotInfo') for n in obj.defined)]
        info_name = next(n for n in meta.defined if n.endswith('_284_aotInfo'))
        info = meta.extract(info_name, 168)
        require(info[:20].hex() == linked['_verified_compiled']['compile_input_sha1'], 'Source compiler AOTInfo digest')
        raw = meta.extract(next(n for n in meta.defined if n.endswith('_abcBytes')), stage.u64(info, 32))
        parsed = abcfmt.ABC(raw)
        compilers[source_stage] = {b[0]: b for b in parsed.bodies}
        require(len(compilers[source_stage]) == len(parsed.bodies), 'Duplicate source compiler body')
    require({b[0] for b in actual.bodies} == compilers['town'].keys()
            and len({b[0] for b in actual.bodies}) == len(actual.bodies), 'Final runtime body set changed')
    counts = Counter()
    for body in actual.bodies:
        mid = body[0]
        source_stage = selected[mid]['stage'] if mid in selected else 'equipment'
        expected = compilers[source_stage][mid] if mid in selected else baseline_bodies[mid]
        require_runtime_body(expected, body, mid, freeze)
        counts[source_stage] += 1
    return expected_bytes, dict(body_count=len(actual.bodies), body_sources=dict(counts),
                               final_runtime_exact=True, source_comparison='structural full MethodBody fields')


def require_runtime_body(expected, actual, mid, freeze):
    require(freeze(expected) == freeze(actual), 'Runtime body differs from independently selected source: ' + str(mid))


def require_unrelocated_bytes(before, after, relocation_offsets, mid):
    require(len(before) == len(after), 'Function extent changed during compaction')
    require(all(x == y for at, (x, y) in enumerate(zip(before, after)) if at not in relocation_offsets),
            'Non-relocation native bytes changed: ' + str(mid))


def reference_runtime_metadata(meta, runtime):
    """Supply previously checked runtime to the generic stage contract.

    Its original single-stage contract expects one compiler runtime. This view
    changes that expectation only after per-body original-object checks above;
    flags, activation and all other metadata still come from the original object.
    """
    class MetadataView:
        defined = meta.defined

        def extract(self, name, size=None):
            if name.endswith('_abcBytes'):
                require(size == len(runtime), 'Reference runtime view length')
                return runtime
            data = meta.extract(name, size)
            if name.endswith('_284_aotInfo') and len(data) >= 40:
                data = bytearray(data)
                struct.pack_into('<Q', data, 32, len(runtime))
                return bytes(data)
            return data
    return MetadataView()


def follow_to(image, address, wanted):
    """Follow only a bounded B/veneer entry chain to an already known target."""
    seen = set()
    for _ in range(8):
        if address == wanted:
            return True
        if address in seen:
            return False
        seen.add(address)
        word = stage.u32(image.read(address, 4))
        if word & 0xFC000000 == 0x14000000:
            address = stage.branch(word, address)
        elif word & 0x9F00001F == 0x90000010:
            address = stage.veneer(image, address)
        else:
            return False
    return False


def check_relocation(image, row, function_address, original_word):
    at, typ = row['offset'], row['type']
    pc, target = function_address + at, row['target']
    require(row['pc'] == pc, 'Relocation PC differs from actual function')
    word = stage.u32(image.read(pc, 4))
    if typ == 2:
        address = stage.branch(word, pc)
        require(address == row['branch_target'] and word & 0xFC000000 == original_word & 0xFC000000,
                'Actual branch opcode/target differs')
        require(address == target or stage.veneer(image, address) == target, 'Actual branch veneer target differs')
    elif typ in (3, 5):
        require(stage.page(word, pc) == target & ~4095
                and word & ~((3 << 29) | (0x7FFFF << 5)) == original_word & ~((3 << 29) | (0x7FFFF << 5)),
                'Actual ADRP address/register differs')
    elif typ in (4, 6):
        require(stage.pageoff(word) == target & 4095, 'Actual PAGEOFF address differs')
        if typ == 6:
            require(word & 0xFFC003FF == 0x91000000 | (original_word & 1023), 'Actual GOT registers differ')
        else:
            require(word & ~(4095 << 10) == original_word & ~(4095 << 10), 'Actual PAGEOFF opcode differs')
    else:
        raise ValueError('Unsupported relocation type')


def compare_native_semantics(reference, candidate, selected, linked):
    fresh = {int(r['method']): r for r in linked['functions']}
    new_relocs = {(r['method'], r['offset']): r for r in linked['relocations']}
    require(len(new_relocs) == len(linked['relocations']), 'Duplicate cumulative relocation')
    active = stage.u64(reference.raw, stage.INFO + 48)
    old_count = stage.u64(reference.raw, stage.INFO + 56)
    require(old_count == 101598, 'Reference method count changed')
    normalized, types = [], Counter()
    for mid, chosen in selected.items():
        old_row, new_row, fn = chosen['row'], fresh[mid], chosen['function']
        before = reference.read(old_row['address'], old_row['size'])
        after = candidate.read(new_row['address'], new_row['size'])
        require(sha(before) == old_row['sha256'] and sha(after) == new_row['sha256'], 'Actual function/report identity')
        require(len(before) == len(after) == len(fn['data']), 'Function extent changed during compaction')
        prior = {(r['method'], r['offset']): r for r in chosen['linked']['relocations']}
        addends = {r['offset']: stage.signed(r['symbol'], 24) for r in fn['rows'] if r['type'] == 10}
        mask, relocation_count = set(), 0
        for original in fn['rows']:
            if original['type'] == 10:
                continue
            key = mid, original['offset']
            require(key in prior and key in new_relocs, 'Missing source/candidate relocation')
            a, b = prior[key], new_relocs[key]
            require(a['symbol'] == b['symbol'] == original['name'] and a['type'] == b['type'] == original['type'],
                    'Relocation logical identity changed')
            original_word = stage.u32(fn['data'], original['offset'])
            check_relocation(reference, a, old_row['address'], original_word)
            check_relocation(candidate, b, new_row['address'], original_word)
            target_mid, addend = method_id(original['name']), addends.get(original['offset'], 0)
            if target_mid is not None:
                require(target_mid < old_count, 'Out of range method relocation')
                destination = stage.u64(reference.read(active + target_mid * 8, 8))
                if addend:
                    require(a['target'] == destination + addend, 'Reference method addend targets stale body')
                else:
                    require(follow_to(reference, a['target'], destination), 'Reference old entry no longer reaches final method')
                current = fresh[target_mid]['address'] if target_mid in fresh else destination
                require(b['target'] == current + addend, 'Candidate method relocation does not reach final implementation')
            elif original['name'].startswith(('lCPI', '_exceptionDesc')):
                # The full independent stage check binds both to object-owned bytes.
                obj = fn['object']; name = original['name']; symbol = obj.defined[name]; section = obj.section(symbol)
                ends = [s['value'] for s in obj.symbols if s['section'] == symbol['section'] and s['value'] > symbol['value']]
                size = min(ends, default=section['va'] + section['size']) - symbol['value']
                expected = obj.extract(name, size)
                require(reference.read(a['target'] - addend, size) == expected
                        and candidate.read(b['target'] - addend, size) == expected, 'Constant relocation bytes changed')
            else:
                require(a['target'] == b['target'], 'Existing runtime/global pointer moved')
            mask.update(range(original['offset'], original['offset'] + 4))
            relocation_count += 1; types[a['type']] += 1
        require_unrelocated_bytes(before, after, mask, mid)
        normalized.append(dict(method=mid, stage=chosen['stage'], object=chosen['object_path'],
                               source_address=old_row['address'], address=new_row['address'], size=len(after),
                               relocation_count=relocation_count))
    return dict(functions=normalized, count=len(normalized), relocations=sum(types.values()), relocation_types=dict(types))


def compare_activation(before, after, source_addresses, new_addresses):
    require(len(before) == len(after) and len(before) % 16 == 0, 'Activation extent changed')
    remapped = 0
    for at in range(0, len(before), 16):
        a, b = struct.unpack_from('<QQ', before, at), struct.unpack_from('<QQ', after, at)
        require(a[0] == b[0], 'Activation descriptor changed')
        expected = new_addresses[source_addresses[a[1]]] if a[1] in source_addresses else a[1]
        require(b[1] == expected, 'Activation initializer changed')
        remapped += a[1] != b[1]
    return remapped


def immutable_payload_checks(reference, candidate, linked, final_link, selected, source_swf, new_swf):
    full, expected_full = Path(linked['full_abc_file']).read_bytes(), Path(final_link['full_abc_file']).read_bytes()
    require(full == expected_full and sha(full) == FINAL_FULL_SHA, 'Final full ABC changed')
    count = stage.u64(candidate.raw, stage.INFO + 56)
    require(count == 101598, 'Final method count changed')
    runtime = candidate.read(stage.u64(candidate.raw, stage.INFO + 24), stage.u64(candidate.raw, stage.INFO + 32))
    old_runtime = reference.read(stage.u64(reference.raw, stage.INFO + 24), stage.u64(reference.raw, stage.INFO + 32))
    require(runtime == old_runtime, 'Final runtime ABC differs from town')
    flags = candidate.read(stage.u64(candidate.raw, stage.INFO + 64), count * 4)
    require(flags == reference.read(stage.u64(reference.raw, stage.INFO + 64), count * 4), 'Final method flags differ from town')
    require(new_swf == source_swf, 'Final SWF differs from town')
    old_activation = reference.read(stage.u64(reference.raw, stage.INFO + 88), count * 16)
    new_activation = candidate.read(stage.u64(candidate.raw, stage.INFO + 88), count * 16)
    old_addresses = {v['row']['address']: mid for mid, v in selected.items()}
    new_addresses = {r['method']: r['address'] for r in linked['functions']}
    remapped = compare_activation(old_activation, new_activation, old_addresses, new_addresses)
    return dict(full_abc_exact=True, runtime_abc_exact=True, method_flags_exact=True, final_swf_exact=True,
                activation_semantics_exact=True, activation_initializers_relocated=remapped,
                runtime_abc_sha256=sha(runtime), method_flags_sha256=sha(flags))


def appended_payload_checks(equipment, reference, candidate, linked, reference_links):
    start = equipment.segments[-1]['off']
    end = candidate.segments[-1]['off']
    require(start < end < reference.segments[-1]['off'] and len(candidate.raw) < len(reference.raw),
            'Candidate does not reduce appended native storage')
    runtime = candidate.read(stage.u64(candidate.raw, stage.INFO + 24), stage.u64(candidate.raw, stage.INFO + 32))
    flags = candidate.read(stage.u64(candidate.raw, stage.INFO + 64), 101598 * 4)
    fresh = candidate.raw[start:end]
    require(fresh.count(runtime) == 1 and fresh.count(flags) == 1, 'Final runtime/flags not stored once in new payload')
    absent = []
    for name, prior in reference_links[:-1]:
        stale_runtime = Path(prior['runtime_abc_file']).read_bytes()
        require(stale_runtime != runtime and stale_runtime not in fresh, 'Stale intermediate runtime ABC retained')
        absent.append(name)
    require(linked['executable_extension']['off'] == start and linked['executable_extension']['size'] == end - start,
            'Declared appended extent does not match segment mapping')
    return dict(equipment_native_bytes=len(equipment.raw), reference_native_bytes=len(reference.raw),
                candidate_native_bytes=len(candidate.raw), native_bytes_saved=len(reference.raw) - len(candidate.raw),
                appended_bytes=end - start, final_runtime_copies_in_new_payload=1, final_flags_copies_in_new_payload=1,
                stale_runtime_stages_absent=absent, original_equipment_prefix_preserved_by_stage_check=True)


def signing_replacement_checks(image):
    layout = stage.metadata(image)
    _, _, command = next(x for x in image.commands if x[1] == 2)
    ldid = (stage.u32(command, 16) + stage.u32(command, 20) + 15) & ~15
    prefix_digest = sha(image.raw[:ldid])
    trials = []
    for mode, limit in (('code-signature', layout['signature_offset']), ('ldid-string-table', ldid)):
        for size in (16, 16384, 65536):
            # Only an in-memory buffer changes; loader bytes must survive truncation.
            replacement = image.raw[:limit] + bytes([0xF0]) * size
            require(sha(replacement[:ldid]) == prefix_digest, 'Signature replacement truncated loader bytes')
            for row in layout['ranges']:
                at, length = row['offset'], row['size']
                require(replacement[at:at + length] == image.raw[at:at + length], 'Signature replacement changed loader metadata')
            trials.append(dict(mode=mode, signature_bytes=size, loader_bytes_preserved=True))
    return trials


def verify(args):
    sys.path[:0] = [str(args.libraries), str(stage.CLIENT / 'pr43-ios/support'), str(stage.CLIENT / 'lens0907-0908'),
                    str(stage.CLIENT / 'ios-cumulative-login')]
    references, selected, objects, object_stages, packages = load_references(args.reference_root)
    package = read(args.package_report); linked = read(package['link_report'])
    equipment_path = args.reference_root / 'equipment/link-report.json'
    equipment_link = read(equipment_path)
    require(linked['source_ipa']['ipa_sha256'] == REFERENCE_IPAS['equipment'], 'Cumulative carrier must be equipment-only')
    require(Path(linked['previous_link_report']).resolve() == equipment_path.resolve(), 'Unexpected cumulative parent report')
    verify_compilation_set(linked, objects, object_stages, selected)
    final_link = references[-1][1]
    reference_path = Path(packages['town']['ipa'])
    require(sha(reference_path.read_bytes()) == REFERENCE_IPAS['town'], 'Reference town IPA changed')
    source = linked['source_ipa']
    with zipfile.ZipFile(reference_path) as archive:
        reference = stage.Image(archive.read(source['native_member']))
        reference_swf = archive.read(source['swf_member'])
    require(sha(reference.raw) == final_link['native_sha256'] and sha(reference_swf) == final_link['swf_sha256'],
            'Reference actual native/SWF identity')
    with zipfile.ZipFile(package['ipa']) as archive:
        candidate = stage.Image(archive.read(source['native_member']))
        new_swf = archive.read(source['swf_member'])
    with zipfile.ZipFile(source['ipa']) as archive:
        equipment = stage.Image(archive.read(source['native_member']))
    runtime, runtime_proof = validate_runtime_bodies(equipment, reference, candidate, references, selected, objects, object_stages)
    view = make_object_view(objects, object_stages, selected)
    original, original_abc_checks = stage.Object, stage.abc_checks
    try:
        stage.Object = view
        def cumulative_abc_checks(old, new, previous, linked_report, prepared, meta):
            return original_abc_checks(old, new, previous, linked_report, prepared, reference_runtime_metadata(meta, runtime))
        stage.abc_checks = cumulative_abc_checks
        stage_args = SimpleNamespace(package_report=args.package_report, equipment_link=equipment_path,
                                     libraries=args.libraries,
                                     output=args.output.with_name(args.output.stem + '-stage.json'),
                                     detail_output=args.detail_output.with_name(args.detail_output.stem + '-stage.json'))
        base_proof = stage.verify(stage_args)
    finally:
        stage.Object = original
        stage.abc_checks = original_abc_checks
    native = compare_native_semantics(reference, candidate, selected, linked)
    immutable = immutable_payload_checks(reference, candidate, linked, final_link, selected, reference_swf, new_swf)
    storage = appended_payload_checks(equipment, reference, candidate, linked, references)
    signing = signing_replacement_checks(candidate)
    detail = dict(native_semantic_equivalence=native, immutable=immutable, runtime_source_validation=runtime_proof, storage=storage,
                  signing_replacement_models=signing, stage_detail=base_proof['detail_report'])
    dump(args.detail_output, detail)
    result = dict(status='independent_actual_cumulative_package_readback_passed', ipa=package['ipa'],
                  ipa_sha256=package['ipa_sha256'], native_sha256=package['native_sha256'],
                  swf_sha256=package['swf_sha256'], full_abc_sha256=FINAL_FULL_SHA,
                  total_methods=101598, replaced_existing_methods=129, helper_methods=102,
                  equivalent_native_functions=native['count'], relocations_checked=native['relocations'],
                  source_object_ownership_independently_derived=True, immutable=immutable, storage=storage,
                  runtime_source_validation=runtime_proof,
                  unchanged_resource_members=base_proof['package']['unchanged_compressed_members_exact'],
                  eh_unwind_function_starts_verified=True, old_global_pointers_preserved=True,
                  signing_replacement_models_passed=len(signing), stage_verification=stage_args.output.as_posix(),
                  detail_report=args.detail_output.as_posix(), signing='unsigned', native_executed=False,
                  device_tested=False, accepted_registry_updated=False,
                  verifier_source_sha256=sha(Path(__file__).read_bytes()))
    require(result['unchanged_resource_members'] == 3566, 'Unexpected resource member count')
    dump(args.output, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-report', required=True, type=Path)
    parser.add_argument('--reference-root', required=True, type=Path)
    parser.add_argument('--libraries', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--detail-output', required=True, type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(args.libraries))
    result = verify(args)
    print(result['status'], result['ipa_sha256'])


if __name__ == '__main__':
    if not __debug__:
        raise RuntimeError('Required independent verification assertions must remain enabled')
    main()
