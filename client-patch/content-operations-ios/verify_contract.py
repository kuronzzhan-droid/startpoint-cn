"""Independently read back ABC, compiler, native-object and AIR evidence."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import types

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'lens0907-0908'))
import build_swf as p

FIELDS = ('methods', 'metadata', 'instances', 'classes', 'scripts', 'ints', 'uints', 'doubles', 'strings', 'namespaces', 'ns_sets', 'multinames')
sha = lambda value: hashlib.sha256(value).hexdigest()
view = lambda abc: p.View(types.SimpleNamespace(abc=abc), p.asm)


def frozen(value):
    if isinstance(value, p.abcfmt.Trait):
        return tuple((key, frozen(getattr(value, key))) for key in value.__slots__)
    if isinstance(value, (list, tuple)):
        return tuple(frozen(x) for x in value)
    if isinstance(value, float):
        return struct.pack('<d', value)
    return value


def read_json(path):
    return json.loads(Path(path).read_text('utf-8'))


def run(base, prepared, helper, compiled, runtime, reproduction, output):
    record = read_json(prepared)
    full_path = Path(prepared).parent / record['full_abc_file']
    base_raw, full_raw = Path(base).read_bytes(), full_path.read_bytes()
    if sha(base_raw) != record['base_full_abc_sha256'] or sha(full_raw) != record['full_abc_sha256']:
        raise ValueError('ABC identity mismatch')
    old, new = p.abcfmt.ABC(base_raw), p.abcfmt.ABC(full_raw)
    if len(old.methods) != 101496 or len(new.methods) != 101581:
        raise ValueError('Unexpected method table sizes')
    for field in FIELDS:
        prefix = getattr(old, field)
        if frozen(prefix) != frozen(getattr(new, field)[:len(prefix)]):
            raise ValueError(('Old ABI/pool prefix changed', field))
    by_old = {body[0]: body for body in old.bodies}
    by_new = {body[0]: body for body in new.bodies}
    changes = {mid for mid, body in by_old.items() if frozen(body) != frozen(by_new[mid])}
    expected = {row['method_id'] for row in record['methods']}
    if len(expected) != 121 or changes != expected:
        raise ValueError(('Unexpected changed methods', sorted(changes ^ expected)))
    nv = view(new)
    for row in record['methods']:
        mid = row['method_id']
        if nv.labels[mid] != row['label'] or by_new[mid][0] != mid:
            raise ValueError(('QName/body-to-method binding mismatch', row))
        if sha(by_old[mid][5]) != row['before_code_sha256'] or sha(by_new[mid][5]) != row['after_code_sha256']:
            raise ValueError(('Changed-body identity mismatch', mid))
        if frozen(by_old[mid][7]) != frozen(by_new[mid][7]):
            raise ValueError(('Activation changed', mid))
    # Explicitly freeze the preceding equipment corrections and every other body.
    for mid in (101439, 101442, 101443):
        if frozen(by_old[mid]) != frozen(by_new[mid]):
            raise ValueError(('Preceding equipment correction changed', mid))
    response_bi, = nv.by_label['pinball.remote.common::ResponseData/<ctor>']
    refs = [new.mn_name(x.args[0]) for x in p.asm.decode(new.bodies[response_bi][5]) if x.op == 0x60]
    if 'cn.content::ContentOperationsState' not in refs or 'cn.town::TownThemeState' in refs:
        raise ValueError('Operations stage must have content capture only')
    helper_raw = Path(helper).read_bytes()
    if sha(helper_raw) != record['helper_source_sha256']:
        raise ValueError('Helper identity mismatch')
    hv = view(p.abcfmt.ABC(helper_raw))
    for label, indices in hv.by_label.items():
        hi, = indices
        ni, = nv.by_label[label]
        if hv.normalized(hi) != nv.normalized(ni):
            raise ValueError(('Helper instruction/CFG mismatch', label))
    comp = read_json(Path(compiled) / 'compile-report.json')
    wanted = expected | set(record['new_method_ids'])
    if set(comp['target_symbol_coverage']['found']) != wanted or comp['target_symbol_coverage']['missing']:
        raise ValueError('Incomplete native symbol coverage')
    compiler_raw = (Path(compiled) / 'cumulative.abc').read_bytes()
    if sha(compiler_raw) != comp['compile_input_sha256'] or sha(compiler_raw) == sha(full_raw):
        raise ValueError('Compiler-only input was lost or confused with the full runtime source')
    compiler_abc = p.abcfmt.ABC(compiler_raw)
    for field in FIELDS:
        if frozen(getattr(new, field)) != frozen(getattr(compiler_abc, field)):
            raise ValueError(('Compiler-only preparation changed ABI', field))
    contract = read_json(Path(compiled) / 'native-contract.json')
    if set(contract['expected_methods']) != wanted or len(contract['functions']) != 206:
        raise ValueError('Native extraction coverage differs')
    for row in contract['functions']:
        function_raw = (Path(compiled) / row['file']).read_bytes()
        if sha(function_raw) != row['sha256'] or len(function_raw) != row['bytes']:
            raise ValueError(('Full native function identity mismatch', row['method_id']))
    for row in comp['objects']:
        raw = (Path(compiled) / row['name']).read_bytes()
        if sha(raw) != row['sha256'] or len(raw) != row['bytes']:
            raise ValueError(('Retained native object identity mismatch', row['name']))
    air = read_json(Path(runtime) / 'runtime-validation.json')
    if air['full_abc_sha256'] != sha(full_raw) or len(air['suites']) != 4 or any(not r['result']['passed'] for r in air['suites']):
        raise ValueError('AIR evidence does not cover this candidate')
    repro = read_json(reproduction)
    if repro['full_abc_sha256'] != sha(full_raw) or repro['source_file_sha256'] != sha((HERE / 'prepare.py').read_bytes()):
        raise ValueError('Current source reproduction is missing')
    result = dict(status='operations_abc_aot_air_verified_not_device_tested',
                  full_abc_sha256=sha(full_raw), source_reproduction_report=str(reproduction),
                  old_methods_preserved=101496, replaced_method_bodies=121, added_helper_methods=85,
                  old_declarations_pool_prefix_and_activations_exact=True,
                  previous_equipment_corrections_exact=True, unrelated_body_count=len(by_old)-121,
                  helper_source_instruction_cfg_equal=85, compiler_only_abi_exact=True,
                  compiled_target_symbols=206, retained_object_count=len(comp['objects']),
                  extracted_function_bytes=contract['total_function_bytes'], extracted_relocations=contract['total_relocations'],
                  extracted_code_bytes=contract['total_code_bytes'],
                  extracted_trailing_inline_data_bytes=contract['total_trailing_inline_data_bytes'],
                  air_suites=[dict(suite=r['suite'], assertions=r['assertions'], passed=True) for r in air['suites']],
                  air_assertions=air['total_assertions'],
                  source_files={str(path.relative_to(HERE)):sha(path.read_bytes()) for path in sorted(HERE.rglob('*')) if path.is_file() and path.suffix in ('.py','.as')},
                  native_linked=False, native_executed=False, device_tested=False, cloud_tested=False,
                  save_impact='No saved schema, inventory/progress, stored content IDs, or server data is changed.')
    Path(output).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k:result[k] for k in ('status','replaced_method_bodies','compiled_target_symbols','air_assertions')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('base','prepared','helper','compiled','runtime','reproduction','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    run(args.base,args.prepared,args.helper,args.compiled,args.runtime,args.reproduction,args.output)
