"""Append the R11 operations state and import its exact native consumers for iOS.

This produces a full ABC, never a runtime-stripped ABC or an installable IPA.
Existing MethodInfo, fields, scripts, activation traits and pool prefixes are
immutable. The town capture is split out so each intermediate stage is valid.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import types

HERE = Path(__file__).resolve().parent
CLIENT = HERE.parent
sys.path.insert(0, str(CLIENT / 'lens0907-0908'))
import build_swf as p

BASE_SHA256 = 'd35c1063b7e4da20ed75166c610ce52e11d17feca7ff2cbca70a6ffb5ade1cde'
DONOR_SHA256 = 'aba7382a9491d2259835af74f0232ada639f62fc32a1c81d5ea5c9c68476a513'
HELPER_SHA256 = 'c11c8b93aba20c48d693e87c21376d4cf3de10e23de4d7c960d5cc1cdd67ef35'
OLD_METHODS = 101496
OWNER = 'cn.content::ContentOperationsState'
RESPONSE = 'pinball.remote.common::ResponseData/<ctor>'
POOL_FIELDS = ('ints', 'uints', 'doubles', 'strings', 'namespaces', 'ns_sets', 'multinames')
DECLARATIONS = ('methods', 'metadata', 'instances', 'classes', 'scripts')


def sha(value):
    return hashlib.sha256(value).hexdigest()


def dump(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf-8')


def view(abc):
    return p.View(types.SimpleNamespace(abc=abc), p.asm)


def constant(abc, index, kind):
    pools = {1: 'strings', 3: 'ints', 4: 'uints', 6: 'doubles'}
    if kind in pools:
        value = getattr(abc, pools[kind])[index]
        return [kind, value.hex() if isinstance(value, bytes) else value]
    if kind in (5, 8, 22, 23, 24, 25, 26):
        value = abc.namespaces[index]
        return [kind, value[0], abc.s(value[1])]
    return [kind, index]


def signature(v, mid):
    ret, params, _name, flags, options, names = v.a.methods[mid]
    return dict(return_type=v.mn(ret), parameters=[v.mn(x) for x in params], flags=flags,
                optional=[constant(v.a, n, k) for n, k in options] if options is not None else None,
                parameter_names=[v.a.s(x) for x in names] if names is not None else None)


def activation(v, body):
    return [(v.mn(t.name), t.kind, t.attr, t.data[1], v.mn(t.data[2]),
             constant(v.a, t.data[3], t.data[4]) if t.data[3] else None)
            for t in body[7]]


def owner_layout(v, label):
    name = label.split('/', 1)[0].rstrip('$')
    hits = [ci for ci, row in enumerate(v.a.instances) if v.a.mn_name(row[0]) == name]
    if len(hits) != 1:
        raise ValueError(('Owner is missing or ambiguous', label, hits))
    ci = hits[0]
    row, cls = v.a.instances[ci], v.a.classes[ci]
    def slots(traits):
        return [(v.mn(t.name), t.kind, t.attr, t.data[1], v.mn(t.data[2]),
                 constant(v.a, t.data[3], t.data[4]) if t.data[3] else None)
                for t in traits if t.kind in (0, 6)]
    return dict(owner=name, superclass=v.mn(row[1]), flags=row[2],
                protected_namespace=v.a.ns_name(row[3]) if row[3] is not None else None,
                interfaces=[v.mn(x) for x in row[4]], instance_slots=slots(row[6]), static_slots=slots(cls[1]))


def class_importer():
    # Reuse only this published class/pool importer, never a historical main.
    spec = importlib.util.spec_from_file_location('operations_class_importer', CLIENT / 'ios-cumulative-login/prepare.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.ClassImporter


def split_town_capture(source):
    """Remove exactly the R11 town prologue; save a reversible CFG proof."""
    abc = source.a
    bi, = source.by_label[RESPONSE]
    body = abc.bodies[bi]
    before = copy.deepcopy(body)
    rows = p.asm.decode(body[5])
    expected = [0x60, 0xd1, 0x4f]
    if [x.op for x in rows[2:5]] != expected:
        raise ValueError('R11 town capture opcode prologue changed')
    if abc.mn_name(rows[2].args[0]) != 'cn.town::TownThemeState' or abc.mn_name(rows[4].args[0]) != 'captureResponse' or rows[4].args[1] != 1:
        raise ValueError('R11 town capture identity changed')
    if before[6]:
        raise ValueError('ResponseData constructor has an unreviewed exception table')
    body[5] = p.asm.unsplice(body[5], 2, 3)
    stripped = view(abc).normalized(bi)
    with_town = copy.deepcopy(abc)
    with_town.bodies[bi] = before
    proof = p.insertion_proof(stripped, view(with_town).normalized(bi), [{'at': 2, 'instructions': 3}])
    return dict(label=RESPONSE, removed_instructions=3, insertion_index=2,
                r11_code_sha256=sha(before[5]), operations_code_sha256=sha(body[5]), inverse_insertion_cfg_proof=proof,
                final_town_step='Insert getlex cn.town::TownThemeState, getlocal_1, callpropvoid captureResponse(1) at instruction 2')


def apply_operations(target, donor, helper):
    """Mutate a View in memory; append helper, then replace 121 ABI-equal bodies."""
    if sha(donor.a.serialize()) != DONOR_SHA256 or sha(helper.a.serialize()) != HELPER_SHA256:
        raise ValueError('Requires the fixed final R11 production main and helper')
    original = copy.deepcopy(target.a)
    existing = {target.a.mn_name(i[0]) for i in target.a.instances}
    if OWNER in existing:
        raise ValueError('Operations helper already exists')
    if len(helper.a.methods) != 85 or [helper.a.mn_name(i[0]) for i in helper.a.instances] != [OWNER]:
        raise ValueError('Expected the complete final R11 operations helper')
    selected = []
    for bi, body in enumerate(donor.a.bodies):
        if any(x.op == 0x60 and donor.a.mn_name(x.args[0]) == OWNER for x in p.asm.decode(body[5])):
            selected.append((donor.labels[body[0]], bi))
    if len(selected) != 121:
        raise ValueError(('R11 consumer set changed', len(selected)))
    original_source_hashes = {label: sha(donor.a.bodies[bi][5]) for label, bi in selected}
    donor = view(copy.deepcopy(donor.a))
    split = split_town_capture(donor)
    merger = class_importer()(target, helper)
    new_ids = sorted(merger.methods.values())
    merger.merge()
    target = view(target.a)
    importer = p.Importer(target, donor)
    records, layouts = [], {}
    for label, si in selected:
        ti, = target.by_label.get(label, [])
        before, src = target.a.bodies[ti], donor.a.bodies[si]
        mid = before[0]  # Body index is deliberately not used as a MethodInfo ID.
        sig = signature(target, mid)
        if sig != signature(donor, src[0]):
            raise ValueError(('MethodInfo signature differs', label, sig, signature(donor, src[0])))
        if activation(target, before) != activation(donor, src):
            raise ValueError(('Activation layout differs', label))
        if before[3] != src[3]:
            raise ValueError(('Lexical scope differs', label))
        if any(x.op == 0x40 for x in p.asm.decode(src[5])):
            raise ValueError(('New closure requires a dedicated ABI plan', label))
        native_owner, donor_owner = owner_layout(target, label), owner_layout(donor, label)
        if native_owner != donor_owner:
            raise ValueError(('Owner field or inheritance ABI differs', label, native_owner, donor_owner))
        layouts[native_owner['owner']] = native_owner
        body = importer.body(si, mid, scope=before[3])
        if p.freeze(body[7]) != p.freeze(before[7]):
            raise ValueError(('Existing activation bytes changed', label))
        target.a.bodies[ti] = body
        if target.normalized(ti) != donor.normalized(si):
            raise ValueError(('Imported production instructions/CFG differ', label))
        records.append(dict(label=label, strategy='replace', method_id=mid, ios_body_index=ti,
                            source_body_index=si, source_method_id=src[0], signature=sig,
                            before_code_sha256=sha(before[5]), after_code_sha256=sha(body[5]),
                            r11_source_code_sha256=original_source_hashes[label], source_code_sha256=sha(src[5]),
                            scope_depth=body[3], activation_traits_unchanged=True, owner_layout_unchanged=True,
                            production_instruction_cfg_equal=True, validation=p.check_body(body, target.a),
                            native_receiver='unchanged original typed owner', native_method_environment='own original MethodInfo/MethodEnv'))
    for field in DECLARATIONS + POOL_FIELDS:
        prefix = getattr(original, field)
        if p.freeze(prefix) != p.freeze(getattr(target.a, field)[:len(prefix)]):
            raise ValueError(('Existing declaration or pool prefix changed', field))
    changed = {r['method_id'] for r in records}
    for old_body, body in zip(original.bodies, target.a.bodies):
        if old_body[0] not in changed and p.freeze(old_body) != p.freeze(body):
            raise ValueError(('Unrelated body changed', old_body[0]))
    helper_checks = [p.check_body(body, target.a) for body in target.a.bodies if body[0] in new_ids]
    return dict(methods=records, new_method_ids=new_ids, helper_owner=OWNER,
                helper_source_sha256=sha(helper.a.serialize()), helper_checks=helper_checks,
                owner_layouts=layouts, split_town_capture=split,
                existing_declarations_pool_prefix_and_unrelated_bodies_preserved=True,
                closure_policy='No selected original method creates a new closure; existing activation is byte-exact.')


def run(base, donor, helper, out):
    raw = Path(base).read_bytes()
    if sha(raw) != BASE_SHA256:
        raise ValueError('Requires the fixed equipment-corrected full ABC')
    out = Path(out)
    if out.exists():
        raise ValueError('Refuse to overwrite a prior preparation')
    target = view(p.abcfmt.ABC(raw))
    if len(target.a.methods) != OLD_METHODS or target.a.serialize() != raw:
        raise ValueError('Full ABC identity or round-trip differs')
    donor_raw, helper_raw = Path(donor).read_bytes(), Path(helper).read_bytes()
    record = apply_operations(target, view(p.abcfmt.ABC(donor_raw)), view(p.abcfmt.ABC(helper_raw)))
    result = target.a.serialize()
    if p.abcfmt.ABC(result).serialize() != result:
        raise ValueError('Prepared ABC readback differs')
    out.mkdir(parents=True)
    (out / 'operations-prepared-full.abc').write_bytes(result)
    record.update(schema='ios-r11-operations/v1', status='prepared_not_compiled_or_linked',
                  old_methods=OLD_METHODS, total_methods=len(target.a.methods),
                  base_full_abc_sha256=sha(raw), donor_main_sha256=sha(donor_raw),
                  full_abc_file='operations-prepared-full.abc', full_abc_sha256=sha(result),
                  full_abc_sha1=hashlib.sha1(result).hexdigest(),
                  source_file_sha256=sha(Path(__file__).read_bytes()),
                  packaged=False, native_executed=False, device_tested=False,
                  save_impact='No persisted schema, player state or stored identifiers changed; snapshot controls existing native qualification and entrances.')
    dump(out / 'port.json', record)
    print(json.dumps({k: record[k] for k in ('status', 'old_methods', 'total_methods', 'full_abc_sha256')}))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('base', 'donor', 'helper', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    run(args.base, args.donor, args.helper, args.out)


if __name__ == '__main__':
    main()
