"""Adapt the reviewed PR43 linker to a staged iOS candidate carrier.

The original linker retains its metadata, activation, symbol and relocation
guards. This adapter supplies an explicitly pinned previous candidate and a
last-RX extension allocator. Packaging requires separate unwind finalization.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
CLIENT = HERE.parent
if __name__ == '__main__':
    _early = argparse.ArgumentParser(add_help=False)
    _early.add_argument('--libraries', type=Path, required='--help' not in sys.argv)
    _known, _ = _early.parse_known_args()
    if _known.libraries:
        sys.path.insert(0, str(_known.libraries))
sys.path[:0] = [str(CLIENT / 'pr43-ios'), str(CLIENT / 'equipment-ios-repair')]
import native_support as support
import link_port as original


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf-8')


def extend_last_rx(native, code_size):
    """Grow an existing last RX segment without changing existing addresses."""
    link = original.link
    segments = link.segments(native)
    segment, tail = segments[-2:]
    require(tail['name'] == '__LINKEDIT' and segment['name'] in ('__EQFIX', '__CNRECIO'), 'Unexpected last RX carrier')
    require(struct.unpack_from('<ii', native, segment['command'] + 56) == (5, 5), 'Last payload is not RX')
    require(segment['off'] + segment['fs'] == tail['off'] and segment['vm'] + segment['vs'] == tail['vm'], 'Last RX/LINKEDIT gap')
    require(segment['fs'] == segment['vs'], 'Last RX contains a zero-fill tail')
    growth = link.aot.align(code_size, 0x4000)
    result = bytearray(native[:tail['off']] + bytes(growth) + native[tail['off']:])
    offset_fields = {2: [8, 16], 0xb: [32, 40, 48, 56, 64, 72],
                     0x22: [8, 16, 24, 32, 40], 0x80000022: [8, 16, 24, 32, 40]}
    data_commands = {0x1d, 0x1e, 0x26, 0x29, 0x2b, 0x2e, 0x80000033}
    for at, command, raw in link.commands(native):
        row = bytearray(raw)
        require(command != 0x80000034, 'Chained fixups require a dedicated allocator')
        if at == segment['command']:
            require(len(raw) == 152 and struct.unpack_from('<I', raw, 64)[0] == 1, 'Expected one-section RX')
            struct.pack_into('<Q', row, 32, segment['vs'] + growth)
            struct.pack_into('<Q', row, 48, segment['fs'] + growth)
            struct.pack_into('<Q', row, 112, segment['fs'] + code_size)
        if at == tail['command']:
            struct.pack_into('<Q', row, 24, tail['vm'] + growth)
            struct.pack_into('<Q', row, 40, tail['off'] + growth)
        for field in offset_fields.get(command, [8] if command in data_commands else []):
            value = struct.unpack_from('<I', row, field)[0]
            if value:
                require(value >= tail['off'], 'Loader metadata outside prior LINKEDIT')
                struct.pack_into('<I', row, field, value + growth)
        result[at:at + len(row)] = row
    require(link.read_rebase(result)['entries'] == link.read_rebase(native)['entries'], 'Existing rebases moved')
    rx = dict(name=segment['name'], vm=tail['vm'], off=tail['off'], size=growth,
              payload=code_size, prot=5, index=len(segments) - 2)
    return result, rx, 32 + struct.unpack_from('<I', native, 20)[0]


def run_link(args):
    require(__debug__, 'Run with contract assertions enabled')
    previous_path = args.previous_link.resolve()
    previous = read(previous_path)
    package = read(args.previous_package)
    prepared_path = args.prepared.resolve()
    prepared = read(prepared_path)
    require(previous['status'] == 'linked_native_not_executed', 'Previous candidate is not finalized')
    require(package['status'] == 'unsigned_offline_candidate', 'Previous package is not an offline candidate')
    native = Path(previous['native_file']).read_bytes()
    swf = Path(previous['swf_file']).read_bytes()
    full_path = Path(prepared['full_abc_file'])
    if not full_path.is_absolute():
        full_path = prepared_path.parent / full_path
    full = full_path.read_bytes()
    require(sha(native) == previous['native_sha256'] == package['native_sha256'], 'Previous native identity changed')
    require(sha(swf) == previous['swf_sha256'] == package['swf_sha256'], 'Previous SWF identity changed')
    require(sha(full) == prepared['full_abc_sha256'], 'Prepared full ABC identity changed')
    base_hash = prepared.get('base_full_abc_sha256', prepared.get('input_full_abc_sha256'))
    require(base_hash == previous['full_abc_sha256'], 'Prepared ABC did not continue the previous stage')
    require(prepared['old_methods'] == previous['total_methods'], 'Previous method count differs')
    source_ipa = dict(previous['source_ipa'])
    source_ipa.update(ipa=package['ipa'], ipa_sha256=package['ipa_sha256'],
                      native_sha256=sha(native), swf_sha256=sha(swf), size_bytes=package['size_bytes'],
                      full_abc=previous['full_abc_file'], full_abc_sha256=previous['full_abc_sha256'],
                      full_abc_sha1=previous['full_abc_sha1'], aot_method_count=previous['total_methods'],
                      acceptance_status='offline_candidate')
    for field in ('accepted_on', 'acceptance_audit', 'static_verification_report', 'public_verification_report'):
        source_ipa.pop(field, None)
    link = original.link
    runtime_at = link.file_offset(native, support.read64(native, support.INFO_OFFSET + 24))
    runtime_size = support.read64(native, support.INFO_OFFSET + 32)
    port = dict(prepared, source_ipa=source_ipa, full_abc_file=str(full_path),
                baseline_runtime_abc_sha256=sha(native[runtime_at:runtime_at + runtime_size]))
    old_read = original.read_report

    def provide_report(path):
        actual_path, document = old_read(path)
        require(actual_path == prepared_path and document == prepared, 'Unexpected preparation request')
        return actual_path, port

    def provide_inputs(_path, _document):
        require(_document is port, 'Unexpected linker source document')
        return native, swf, full

    pending_metadata = dict(status='linked_pending_unwind_finalization', previous_link_report=str(previous_path),
                            previous_package_report=str(args.previous_package.resolve()),
                            source_prepare_report=str(prepared_path), compiled_report=str(args.compiled.resolve()),
                            full_abc_file=str(full_path), unwind_finalized=False,
                            previous_link_sha256=sha(previous_path.read_bytes()),
                            previous_package_sha256=sha(args.previous_package.read_bytes()),
                            adapter_source_sha256=sha(Path(__file__).read_bytes()),
                            signing='unsigned', accepted_registry_updated=False)
    old_dump = original.dump

    def guarded_dump(path, document):
        # Make the first on-disk report fail closed even if execution ends
        # between the legacy linker returning and this adapter's final write.
        if Path(path).resolve() == (args.output / 'link-report.json').resolve():
            document = dict(document, **pending_metadata)
        return old_dump(path, document)

    require(not args.output.exists(), 'Fresh stage output required')
    with (patch.object(original, 'read_report', provide_report),
          patch.object(original, 'source_inputs', provide_inputs),
          patch.object(original, 'extend', extend_last_rx),
          patch.object(original, 'dump', guarded_dump)):
        report = original.run(prepared_path, args.compiled, args.output,
                              runtime_stubs=args.runtime_stubs, dependencies=args.dependencies)
    report.update(status='linked_pending_unwind_finalization', previous_link_report=str(previous_path),
                  previous_package_report=str(args.previous_package.resolve()),
                  source_prepare_report=str(prepared_path), compiled_report=str(args.compiled.resolve()),
                  full_abc_file=str(full_path), swf_file=str(args.output / 'worldflipper_ios_release.swf'),
                  runtime_abc_file=str(args.output / 'runtime-stripped.abc'),
                  previous_link_sha256=sha(previous_path.read_bytes()),
                  previous_package_sha256=sha(args.previous_package.read_bytes()),
                  adapter_source_sha256=sha(Path(__file__).read_bytes()),
                  unwind_finalized=False, signing='unsigned', accepted_registry_updated=False)
    save(args.output / 'link-report.json', report)
    save(args.output / 'pre-finalize-link-report.json', report)
    return report


def finalize(args):
    require(__debug__, 'Run with contract assertions enabled')
    report_path = args.output / 'link-report.json'
    report = read(report_path)
    require(report['status'] == 'linked_pending_unwind_finalization', 'Stage not waiting for finalization')
    native_path = Path(report['native_file'])
    native = native_path.read_bytes()
    require(sha(native) == report['native_sha256'], 'Pre-finalization native changed')
    from finalize_delta import finalize_delta
    result, evidence = finalize_delta(native, Path(report['compiled_report']), report['functions'],
                                      entry_bridges=report['entry_bridges'], veneers=report['veneers'],
                                      generated_initializers=report['generated_initializers'])
    from macho_signing_layout import assert_signable_layout
    signing = assert_signable_layout(result)
    models = support.verify_signing_models(result)
    report.update(status='linked_native_not_executed', native_sha256=sha(result), unwind_finalized=True,
                  unwind_finalization=evidence, signing_layout=signing, signing_models=models,
                  finalizer_adapter_source_sha256=sha(Path(__file__).read_bytes()))
    previous = read(report['previous_link_report'])
    report['source_ipa'].update(full_abc=previous['full_abc_file'], full_abc_sha1=previous['full_abc_sha1'],
                                acceptance_status='offline_candidate')
    for field in ('accepted_on', 'acceptance_audit', 'static_verification_report', 'public_verification_report'):
        report['source_ipa'].pop(field, None)
    native_path.write_bytes(result)
    save(report_path, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared', type=Path)
    parser.add_argument('--compiled', type=Path)
    parser.add_argument('--previous-link', type=Path)
    parser.add_argument('--previous-package', type=Path)
    parser.add_argument('--runtime-stubs', type=Path)
    parser.add_argument('--dependencies', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--libraries', required=True, type=Path)
    parser.add_argument('--finalize', action='store_true')
    args = parser.parse_args()
    sys.path.insert(0, str(args.libraries))
    if args.finalize:
        report = finalize(args)
    else:
        require(all(getattr(args, field) is not None for field in ('prepared','compiled','previous_link','previous_package','runtime_stubs','dependencies')), 'Missing stage input')
        report = run_link(args)
    print(json.dumps({'status': report['status'], 'total_methods': report['total_methods'],
                      'native_sha256': report['native_sha256']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
