"""Link the reviewed R11 functions once onto the equipment repair carrier.

Objects remain immutable. A definition-selection view prevents a later delta's
return stubs from replacing an earlier delta's real functions. Complete symbol
extents and relocation indices always come from the original owning binary.
Preparation, linking, unwind finalization and IPA packaging remain separate.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import copy
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
FINAL_FULL_SHA = 'ff1ac16421ed0d394b70612aed23584e30c0aa9ec1de0eebe4336cc1cb396388'
EQUIPMENT_NATIVE_SHA = '2a1e088c1a49e8b9b6215df9ecfaa6ebf5e076a4cad38204f9c4eba758ba25c2'
OLD_COUNT, TOTAL_COUNT = 101496, 101598
POOL_FIELDS = ('methods', 'metadata', 'ints', 'uints', 'doubles', 'strings',
               'namespaces', 'ns_sets', 'multinames', 'scripts')


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(Path(path).read_text('utf-8-sig'))


def save(path, document):
    Path(path).write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', 'utf-8')


def initialize(libraries):
    require(__debug__, 'Contract assertions must remain enabled')
    sys.path.insert(0, str(libraries))
    import link_stage
    return link_stage


def method_id(name):
    match = re.search(r':(\d+):', name)
    return int(match.group(1)) if match else None


def select_owners(stages):
    owners, replacements, duplicate = {}, {}, []
    for index, (_, prepared, linked, _) in enumerate(stages):
        require(not prepared.get('native_aliases') and not prepared.get('method_redirects'),
                'Cumulative aliases/redirects need explicit support')
        for row in prepared['methods']:
            require(row['strategy'] == 'replace', 'Only reviewed direct replacements are supported')
            mid = int(row['method_id'])
            if mid in replacements:
                duplicate.append(mid)
            before = replacements.get(mid, row).get('before_code_sha256')
            replacements[mid] = copy.deepcopy(row)
            if before is not None:
                replacements[mid]['before_code_sha256'] = before
        wanted = set(range(prepared['old_methods'], prepared['total_methods']))
        wanted.update(int(row['method_id']) for row in prepared['methods'])
        require({row['method'] for row in linked['functions']} == wanted,
                'Stage functions differ from the complete prepared method set')
        require(not linked['generated_initializers'], 'Generated initializer ownership needs explicit support')
        for mid in wanted:
            owners[mid] = index
    require(duplicate == [52124] and owners[52124] == 2,
            'Only the final town ResponseData replacement may supersede a prior method')
    require(len(replacements) == 129 and len(owners) == 231, 'Unexpected cumulative method inventory')
    require(set(range(OLD_COUNT, TOTAL_COUNT)) <= owners.keys(), 'Incomplete appended helper coverage')
    return owners, [replacements[mid] for mid in sorted(replacements)]


class UndefinedSymbol:
    """Keep symbol order/name while hiding a non-selected definition."""
    def __init__(self, symbol):
        self.original = symbol
        self.numberof_sections = 0

    def __getattr__(self, name):
        return getattr(self.original, name)


class ObjectView:
    def __init__(self, binary, row):
        self.original = binary  # Retains the LIEF owner for all section views.
        allowed = set(row['selected_methods'])
        metadata = row['final_metadata_stage']
        symbols = []
        sections = list(binary.sections)
        for symbol in binary.symbols:
            name = str(symbol.name)
            mid = method_id(name)
            defined = symbol.numberof_sections
            hide = defined and mid is not None and mid not in allowed
            if defined and not metadata:
                section = sections[defined - 1]
                # All non-method text is compiler generated; only final-stage
                # definitions may satisfy final activation metadata references.
                hide |= (section.name == '__text' and mid is None)
                hide |= name.endswith(('_284_aotInfo', '_abcBytes', '_activationInfo', '_methodFlagsArr'))
            symbols.append(UndefinedSymbol(symbol) if hide else symbol)
        self.symbols = symbols

    def __getattr__(self, name):
        return getattr(self.original, name)


@contextmanager
def selected_objects(compiled, stage):
    """Apply the same immutable object selection to linker and finalizer."""
    original = stage.original
    ns = stage.support
    rows = {(Path(compiled['directory']) / row['name']).resolve(): row for row in compiled['objects']}
    parse = original.link.lief.parse
    record = ns.symbol_record

    def selected_parse(path, *args, **kwargs):
        binary = parse(path, *args, **kwargs)
        row = rows.get(Path(path).resolve())
        return ObjectView(binary, row) if row is not None else binary

    def original_record(binary, *args, **kwargs):
        return record(binary.original if isinstance(binary, ObjectView) else binary, *args, **kwargs)

    with (patch.object(original.link.lief, 'parse', selected_parse),
          patch.object(original, 'symbol_record', original_record),
          patch.object(ns, 'symbol_record', original_record)):
        yield


def table_bytes(native, pointer_offset, count, width, stage):
    link = stage.original.link
    start = link.file_offset(native, stage.support.read64(native, stage.support.INFO_OFFSET + pointer_offset), count * width)
    return bytes(native[start:start + count * width])


def assemble_runtime(equipment, compiler_runtimes, owners, stage):
    """Apply the original staged body-source rule once, on the final pools.

    A compiler delta may stub earlier appended class initializers. Their bodies
    must therefore come from the stage that introduced/replaced that method,
    just as the staged linker retained every non-target existing body.
    """
    ABC = stage.original.abcfmt.ABC
    fresh = ABC(compiler_runtimes[-1])
    baseline = {body[0]: body for body in ABC(equipment).bodies}
    compiled = [{body[0]: body for body in ABC(raw).bodies} for raw in compiler_runtimes]
    changes = []
    for index, body in enumerate(fresh.bodies):
        mid = body[0]
        source = compiled[owners[mid]][mid] if mid in owners else baseline[mid]
        if stage.original.link.freeze(body) != stage.original.link.freeze(source):
            changes.append(dict(method=mid, source_stage=owners.get(mid, 'equipment'),
                                from_body_sha256=sha(body[5]), to_body_sha256=sha(source[5])))
        fresh.bodies[index] = copy.deepcopy(source)
    return fresh.serialize(), changes


@contextmanager
def runtime_view(port, prepared, stage):
    raw = (Path(prepared).parent / port['assembled_runtime_file']).read_bytes()
    require(sha(raw) == port['expected_runtime_abc_sha256'], 'Prepared runtime assembly changed')
    original_abc = stage.original.abcfmt.ABC
    calls = []

    def parse_abc(source):
        if sha(source) == port['final_compiler_runtime_sha256']:
            calls.append(True)
            return original_abc(raw)
        return original_abc(source)

    with patch.object(stage.original, 'abcfmt', SimpleNamespace(ABC=parse_abc)):
        yield
    require(len(calls) == 1, 'Expected exactly one compiler runtime assembly substitution')


def prepare(args, stage):
    output = args.output.resolve()
    require(not output.exists(), 'Fresh preparation output required')
    require(len(args.stage_link) == 3, 'Exactly operations, profile and town links are required')
    pins = {}

    def pinned(path, expected=None):
        path = Path(path).resolve()
        require(not path.is_relative_to(output), 'Preparation output overlaps an input')
        raw = path.read_bytes()
        digest = sha(raw)
        require(expected is None or digest == expected, 'Input identity changed: ' + str(path))
        pins[str(path)] = digest
        return raw

    def document(path, expected=None):
        return json.loads(pinned(path, expected).decode('utf-8-sig'))

    equipment_path = args.equipment_link.resolve()
    equipment = document(equipment_path)
    package = document(args.equipment_package)
    require(equipment['status'] == 'linked_native_not_executed'
            and equipment['unwind']['preserved_original_encodings'] is True
            and equipment['unwind']['preserved_personalities_and_lsda'] is True,
            'Equipment carrier must be finalized')
    require(package['status'] == 'unsigned_offline_candidate' and Path(package['link_report']).resolve() == equipment_path,
            'Equipment package lineage differs')
    native = pinned(equipment['native_file'], EQUIPMENT_NATIVE_SHA)
    swf = pinned(equipment['swf_file'], equipment['swf_sha256'])
    require(equipment['native_sha256'] == package['native_sha256'] == sha(native), 'Equipment native pairing differs')
    require(package['swf_sha256'] == sha(swf), 'Equipment SWF pairing differs')
    require(equipment['total_methods'] == OLD_COUNT, 'Equipment method count differs')
    pinned(package['ipa'], package['ipa_sha256'])
    full0 = pinned(equipment['full_abc_file'], equipment['full_abc_sha256'])
    previous, previous_path = equipment, equipment_path
    stages = []
    fulls = []
    for name, linked_path in zip(('operations', 'profile', 'town'), args.stage_link):
        linked_path = linked_path.resolve()
        linked = document(linked_path)
        require(linked['status'] == 'linked_native_not_executed' and linked.get('unwind_finalized') is True,
                'Source stage must be finalized')
        require(Path(linked['previous_link_report']).resolve() == previous_path
                and linked['previous_link_sha256'] == pins[str(previous_path)], 'Stage lineage changed')
        prepared_path = Path(linked['source_prepare_report']).resolve()
        prepared = document(prepared_path, linked['prepared_report_sha256'])
        compiled_path = Path(linked['compiled_report']).resolve()
        compiled = document(compiled_path)
        require(compiled['status'] == 'compiled_native_not_executed', 'Unsuccessful compilation')
        require(compiled['prepared_report_sha256'] == pins[str(prepared_path)], 'Compiled preparation binding differs')
        require(prepared.get('base_full_abc_sha256', prepared.get('input_full_abc_sha256')) == previous['full_abc_sha256']
                and prepared['old_methods'] == previous['total_methods'], 'Prepared cumulative chain differs')
        full_path = stage.support.input_path(prepared_path, prepared['full_abc_file']).resolve()
        full = pinned(full_path, prepared['full_abc_sha256'])
        require(compiled['full_abc_sha256'] == linked['full_abc_sha256'] == sha(full), 'Stage ABC pairing differs')
        pinned(Path(compiled['directory']) / 'cumulative.abc', compiled['compile_input_sha256'])
        stages.append((name, prepared, linked, compiled))
        fulls.append(full)
        previous, previous_path = linked, linked_path
    require(sha(fulls[-1]) == FINAL_FULL_SHA and previous['total_methods'] == TOTAL_COUNT, 'Final R11 identity differs')
    owners, replacements = select_owners(stages)
    link, ns = stage.original.link, stage.support
    final = link.abcfmt.ABC(fulls[-1])
    compatibility = []
    for (name, prepared, _, compiled), full in zip(stages, fulls):
        current = link.abcfmt.ABC(full)
        for field in POOL_FIELDS:
            rows = getattr(current, field)
            require(link.freeze(rows) == link.freeze(getattr(final, field)[:len(rows)]), name + ': pool/MethodInfo prefix differs: ' + field)
        ns.check_definitions(current, final, final)
        bodies = {row[0]: row for row in current.bodies}
        final_bodies = {row[0]: row for row in final.bodies}
        selected = sorted(mid for mid, owner in owners.items() if stages[owner][0] == name)
        for mid in selected:
            require(link.freeze(bodies[mid]) == link.freeze(final_bodies[mid]), name + ': selected body/activation differs: ' + str(mid))
        compiler_full = link.abcfmt.ABC((Path(compiled['directory']) / 'cumulative.abc').read_bytes())
        for field in (*POOL_FIELDS, 'instances', 'classes'):
            require(link.freeze(getattr(compiler_full, field)) == link.freeze(getattr(current, field)),
                    name + ': compiler-only declaration/pool changed: ' + field)
        for mid in selected:
            compiler_body = next(row for row in compiler_full.bodies if row[0] == mid)
            require(link.freeze(compiler_body) == link.freeze(bodies[mid]), name + ': selected compiler body changed')
        compatibility.append(dict(stage=name, selected_methods=selected, pools_and_methodinfo_prefix_exact=True,
                                  selected_body_and_activation_exact=True, compiler_context_excluded=True))

    objects, sources, found, metadata = [], [], set(), None
    compiler_runtimes = []
    for index, (name, _, linked, compiled) in enumerate(stages):
        wanted = {mid for mid, owner in owners.items() if owner == index}
        linked_functions = {row['method']: row for row in linked['functions']}
        stage_metadata = None
        for row in compiled['objects']:
            path = (Path(compiled['directory']) / row['name']).resolve()
            pinned(path, row['sha256'])
            obj = link.lief.parse(str(path))
            selected = []
            for symbol in obj.symbols:
                name_text = link.aot.text(symbol.name)
                if not symbol.numberof_sections:
                    continue
                if name_text.endswith('_284_aotInfo'):
                    require(stage_metadata is None, 'Multiple stage metadata objects')
                    stage_metadata = (obj, path, name_text)
                    if index == 2:
                        metadata = stage_metadata
                mid = method_id(name_text)
                if mid not in wanted:
                    continue
                require(mid not in found, 'Ambiguous selected function: ' + str(mid))
                record, *_ = ns.symbol_record(obj, path, name_text, mid)
                require(record.size == linked_functions[mid]['size'], 'Source function extent differs')
                sources.append(dict(method=mid, stage=name, object_file=str(path), object_sha256=row['sha256'],
                                    source_compile_report=linked['compiled_report'], source_link_report=str(args.stage_link[index].resolve()),
                                    source_link_address=linked_functions[mid]['address'], size=record.size, symbol=name_text))
                selected.append(mid)
                found.add(mid)
            objects.append(dict(name=str(path), bytes=path.stat().st_size, sha256=row['sha256'], stage=name,
                                source_compile_report=linked['compiled_report'], selected_methods=sorted(selected),
                                final_metadata_stage=index == 2))
        require(stage_metadata is not None, 'Missing compiler metadata')
        meta_obj, _, meta_name = stage_metadata
        stage_info = link.aot.extract_symbol_bytes(meta_obj, meta_name, 168)
        require(stage_info[:20].hex() == compiled['compile_input_sha1'], 'Stage metadata compile identity differs')
        stage_runtime_names = [link.aot.text(s.name) for s in meta_obj.symbols
                               if s.numberof_sections and link.aot.text(s.name).endswith('_abcBytes')]
        require(len(stage_runtime_names) == 1, 'Ambiguous stage runtime metadata')
        compiler_runtimes.append(link.aot.extract_symbol_bytes(meta_obj, stage_runtime_names[0], ns.read64(stage_info, 32)))
    require(found == set(owners) and metadata is not None, 'Cumulative function or metadata coverage incomplete')
    meta, meta_path, info_name = metadata
    info = link.aot.extract_symbol_bytes(meta, info_name, 168)
    require(info[:20].hex() == stages[-1][3]['compile_input_sha1'], 'Final metadata compile identity differs')
    require(ns.read64(info, 56) == TOTAL_COUNT, 'Final metadata count differs')
    symbols = [link.aot.text(s.name) for s in meta.symbols if s.numberof_sections]
    def extract(suffix, size):
        names = [name for name in symbols if name.endswith(suffix)]
        require(len(names) == 1, 'Ambiguous metadata symbol: ' + suffix)
        return link.aot.extract_symbol_bytes(meta, names[0], size)
    fresh_raw = extract('_abcBytes', ns.read64(info, 32))
    fresh = link.abcfmt.ABC(fresh_raw)
    old_runtime = table_bytes(native, 24, ns.read64(native, ns.INFO_OFFSET + 32), 1, stage)
    old = link.abcfmt.ABC(old_runtime)
    ns.check_definitions(old, fresh, final)
    runtime, runtime_changes = assemble_runtime(old_runtime, compiler_runtimes, owners, stage)
    final_native = pinned(stages[-1][2]['native_file'], stages[-1][2]['native_sha256'])
    expected_runtime = table_bytes(final_native, 24, ns.read64(final_native, ns.INFO_OFFSET + 32), 1, stage)
    require(runtime == expected_runtime, 'Single-pass runtime differs from reviewed final town runtime')
    flags = extract('_methodFlagsArr', TOTAL_COUNT * 4)
    require(flags == table_bytes(final_native, 64, TOTAL_COUNT, 4, stage), 'Final metadata flags differ from reviewed final town')
    # Old activation descriptors are retained by the linker. Appended layouts
    # must match the final carrier; pointer relocations are handled separately.
    activation = extract('_activationInfo', TOTAL_COUNT * 16)
    final_activation = table_bytes(final_native, 88, TOTAL_COUNT, 16, stage)
    require(table_bytes(native, 88, OLD_COUNT, 16, stage) == final_activation[:OLD_COUNT * 16],
            'Existing activation descriptors changed in staged reference')
    for mid in range(OLD_COUNT, TOTAL_COUNT):
        require(activation[mid * 16:mid * 16 + 8] == final_activation[mid * 16:mid * 16 + 8],
                'Final activation header differs')
        require(activation[mid * 16 + 8:mid * 16 + 16] == final_activation[mid * 16 + 8:mid * 16 + 16] == bytes(8),
                'Generated activation pointer requires explicit ownership support')
    port = dict(batch='r11-cumulative-compact', old_methods=OLD_COUNT, total_methods=TOTAL_COUNT,
                methods=replacements, compiled_helpers=list(range(OLD_COUNT, TOTAL_COUNT)),
                full_abc_file=str(full_path), full_abc_sha256=FINAL_FULL_SHA,
                full_abc_sha1=hashlib.sha1(fulls[-1]).hexdigest(), base_full_abc_sha256=sha(full0),
                equipment_link_report=str(equipment_path), equipment_package_report=str(args.equipment_package.resolve()),
                baseline_runtime_abc_sha256=sha(old_runtime), baseline_native_file=equipment['native_file'],
                baseline_swf_file=equipment['swf_file'], source_ipa=copy.deepcopy(equipment['source_ipa']),
                expected_runtime_abc_sha256=sha(runtime), expected_method_flags_sha256=sha(flags),
                assembled_runtime_file='runtime-assembled.abc', final_compiler_runtime_sha256=sha(fresh_raw),
                runtime_assembly=dict(rule='Final compiler declarations/pools; each target body from its selected compiler stage; other bodies from equipment runtime',
                                      compiler_runtime_sha256=[sha(raw) for raw in compiler_runtimes],
                                      restored_bodies=runtime_changes, exact_reviewed_town_runtime=True),
                source_pins=pins, compatibility=compatibility,
                cumulative_sources=dict(methods=sorted(sources, key=lambda row: row['method']),
                                        stages=[str(path.resolve()) for path in args.stage_link],
                                        final_metadata_object=str(meta_path), final_metadata_stage='town'))
    compiled = dict(status='compiled_native_not_executed', directory=str(output), objects=objects,
                    full_abc_sha256=FINAL_FULL_SHA, compile_input_sha1=stages[-1][3]['compile_input_sha1'],
                    compile_input_sha256=stages[-1][3]['compile_input_sha256'], tracked_methods=sorted(owners),
                    target_symbol_coverage=dict(expected=sorted(owners), found=sorted(found), missing=[]),
                    immutable_source_objects=True, final_metadata_stage='town')
    output.mkdir(parents=True)
    (output / 'runtime-assembled.abc').write_bytes(runtime)
    save(output / 'port.json', port)
    compiled.update(prepared_report=str(output / 'port.json'), prepared_report_sha256=sha((output / 'port.json').read_bytes()))
    save(output / 'compile-report.json', compiled)
    return dict(status='prepared_cumulative_link_not_executed', methods=len(owners), runtime_sha256=sha(runtime), output=str(output))


def validate_pins(port, compiled):
    for path, expected in port['source_pins'].items():
        require(sha(Path(path).read_bytes()) == expected, 'Pinned cumulative input changed: ' + path)
    for row in compiled['objects']:
        path = Path(compiled['directory']) / row['name']
        require(str(path.resolve()) in port['source_pins'] and sha(path.read_bytes()) == row['sha256'], 'Unbound compiled object')
    expected = {}
    for source in port['cumulative_sources']['methods']:
        expected.setdefault(Path(source['object_file']).resolve(), []).append(source['method'])
    seen = set()
    for row in compiled['objects']:
        path = (Path(compiled['directory']) / row['name']).resolve()
        require(path not in seen, 'Duplicate object in cumulative receipt')
        seen.add(path)
        require(sorted(row['selected_methods']) == sorted(expected.get(path, [])), 'Object method selection changed')
        require(row['final_metadata_stage'] == (row['stage'] == 'town'), 'Final metadata selection changed')
    require(set(expected) <= seen, 'Selected method object missing')


def run_link(args, stage):
    require(not args.output.exists(), 'Fresh linked output required')
    require(not args.output.parent.joinpath(args.output.name + '-symbol-analysis.json').exists(), 'Preserve existing symbol analysis')
    port, compiled = read(args.prepared), read(args.compiled)
    require(compiled['prepared_report_sha256'] == sha(args.prepared.read_bytes()), 'Prepared receipt changed')
    require(sha(Path(port['full_abc_file']).read_bytes()) == FINAL_FULL_SHA, 'Final ABC changed')
    validate_pins(port, compiled)
    for path in [*port['source_pins'], str(args.prepared.resolve()), str(args.compiled.resolve())]:
        require(not Path(path).resolve().is_relative_to(args.output.resolve()), 'Link output overlaps input')
    args.previous_link = Path(port['equipment_link_report'])
    args.previous_package = Path(port['equipment_package_report'])
    with selected_objects(compiled, stage), runtime_view(port, args.prepared, stage):
        report = stage.run_link(args)
    native = Path(report['native_file']).read_bytes()
    require(report['runtime_abc_sha256'] == port['expected_runtime_abc_sha256'], 'Linked runtime identity differs')
    require(sha(table_bytes(native, 64, TOTAL_COUNT, 4, stage)) == port['expected_method_flags_sha256'], 'Linked flags differ')
    report.update(cumulative_sources=port['cumulative_sources'], cumulative_prepared_report=str(args.prepared.resolve()),
                  expected_runtime_abc_sha256=port['expected_runtime_abc_sha256'],
                  expected_method_flags_sha256=port['expected_method_flags_sha256'],
                  runtime_assembly=port['runtime_assembly'],
                  cumulative_compiled_sha256=sha(args.compiled.read_bytes()),
                  cumulative_builder_sha256=sha(Path(__file__).read_bytes()), source_pins_verified=True)
    save(args.output / 'link-report.json', report)
    save(args.output / 'pre-finalize-link-report.json', report)
    return report


def finalize(args, stage):
    report = read(args.output / 'link-report.json')
    require(report['status'] == 'linked_pending_unwind_finalization', 'Cumulative candidate is not pending')
    require(report['cumulative_builder_sha256'] == sha(Path(__file__).read_bytes()), 'Cumulative adapter changed')
    prepared = Path(report['cumulative_prepared_report'])
    compiled_path = Path(report['compiled_report'])
    require(sha(compiled_path.read_bytes()) == report['cumulative_compiled_sha256'], 'Cumulative compiled receipt changed')
    port, compiled = read(prepared), read(compiled_path)
    require(compiled['prepared_report_sha256'] == sha(prepared.read_bytes()), 'Prepared receipt changed')
    validate_pins(port, compiled)
    with selected_objects(compiled, stage):
        return stage.finalize(args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--prepare', action='store_true')
    mode.add_argument('--finalize', action='store_true')
    parser.add_argument('--equipment-link', type=Path)
    parser.add_argument('--equipment-package', type=Path)
    parser.add_argument('--stage-link', type=Path, action='append', default=[])
    parser.add_argument('--prepared', type=Path)
    parser.add_argument('--compiled', type=Path)
    parser.add_argument('--runtime-stubs', type=Path)
    parser.add_argument('--dependencies', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--libraries', type=Path, required=True)
    args = parser.parse_args()
    stage = initialize(args.libraries)
    if args.prepare:
        require(args.equipment_link and args.equipment_package, 'Equipment inputs required')
        report = prepare(args, stage)
    elif args.finalize:
        report = finalize(args, stage)
    else:
        require(all((args.prepared, args.compiled, args.runtime_stubs, args.dependencies)), 'Explicit link inputs required')
        report = run_link(args, stage)
    print(json.dumps({key: report[key] for key in ('status', 'methods', 'total_methods', 'native_sha256', 'output') if key in report}))


if __name__ == '__main__':
    main()
