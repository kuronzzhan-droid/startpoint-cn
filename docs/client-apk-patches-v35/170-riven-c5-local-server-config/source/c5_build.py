"""C4 to C5: only nine endpoint literals and three admission identity literals."""
import json
import struct
import zlib
from bootstrap import ROOT, BASE, BASE_SHA, P13, P13_SHA, FINAL, require_hash, sha, write_json, write_immutable
from c5_constants import abc_records, rewrite, reverse_all_constants
from c5_config import OLD_ADDRESS, NEW_ADDRESS, ADMISSION_BUILD
from c5_admission import OLD_BUILD, unpack, verify_tags
from c4_build import body_bytes, protected_audit, TABLES
from framework import Editor
from common import freeze
from swfabc import SwfAbc, abcfmt
import asm
import bodies


def references(abc, wanted):
    found = {sid: [] for sid in wanted}
    labels = bodies.label_map(abc)
    for index, body in enumerate(abc.bodies):
        for number, op in enumerate(asm.decode(body[5])):
            if op.name == 'pushstring' and op.args[0] in found:
                found[op.args[0]].append({'kind': 'pushstring', 'body': index,
                    'method': body[0], 'label': labels.get(index), 'instruction': number})
    for index, (_, traits) in enumerate(abc.classes):
        for trait in traits:
            if trait.data[0] == 'slot' and trait.data[4] == 1 and trait.data[3] in found:
                found[trait.data[3]].append({'kind': 'static_trait',
                    'class': abc.mn_name(abc.instances[index][0]), 'name': abc.mn_name(trait.name)})
    return found


def main():
    if not __debug__:
        raise RuntimeError('Build assertions require Python without -O')
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    original = BASE.read_bytes()
    editor = Editor(BASE, {})
    assert not editor.new_methods and not editor.traits
    original_body = unpack(original)
    changes, pending = [], []
    for record in abc_records(original):
        patched, edits = rewrite(record['raw'])
        if not edits:
            continue
        assert reverse_all_constants(patched) == record['raw']
        abc = editor.abc if record['name'] == 'boot_ffc6' else abcfmt.ABC(record['raw'])
        refs = references(abc, [edit['string_index'] for edit in edits])
        for edit in edits:
            edit.update(abc=record['name'], references=refs[edit['string_index']],
                        swf_uncompressed_offset=8 + record['abc_body_offset'] + edit['abc_literal_offset'])
            changes.append(edit)
        pending.append((record, patched))
    address = [row for row in changes if OLD_ADDRESS in row['old']]
    identity = [row for row in changes if OLD_BUILD in row['old']]
    assert len(address) == 9 and len(identity) == 3 and len(changes) == 12
    assert original_body.count(OLD_ADDRESS.encode()) == len(address)
    # Save the complete C4 inventory before producing or modifying any SWF.
    write_json(ROOT / 'audit/constant-inventory-before.json', {
        'status': 'inventoried_before_patch', 'baseline_sha256': BASE_SHA,
        'address_count': len(address), 'identity_count': len(identity), 'changes': changes})
    print('C5: inventoried 9 endpoints and 3 build literals before patch', flush=True)
    updated = original_body
    tag_audit = []
    for record, patched in sorted(pending, key=lambda row: row[0]['offset'], reverse=True):
        assert record['header'] == 6
        content = record['prefix'] + patched
        tag = struct.pack('<HI', (82 << 6) | 63, len(content)) + content
        start, end = record['offset'], record['offset'] + record['header'] + record['length']
        updated = updated[:start] + tag + updated[end:]
        tag_audit.append({'abc': record['name'], 'before_sha256': sha(record['raw']),
                          'after_sha256': sha(patched), 'literal_reversal_byte_exact': True})
    raw = original[:4] + struct.pack('<I', len(updated) + 8) + zlib.compress(updated)
    assert OLD_ADDRESS.encode() not in updated and OLD_BUILD.encode() not in updated
    assert updated.count(NEW_ADDRESS.encode()) == 9
    assert updated.count(ADMISSION_BUILD.encode()) == 3
    tag_check = verify_tags(original, raw)
    write_immutable(FINAL, raw)
    final = SwfAbc(FINAL)
    assert final.serialize() == raw
    assert len(editor.abc.bodies) == len(final.abc.bodies)
    assert all(body_bytes(a) == body_bytes(b) for a, b in zip(editor.abc.bodies, final.abc.bodies))
    for table in (*TABLES, 'ints', 'uints', 'doubles', 'multinames'):
        assert freeze(getattr(editor.abc, table)) == freeze(getattr(final.abc, table)), table
    protected = protected_audit(SwfAbc(P13).abc, final.abc)
    for row in protected.values():
        row['p13_equals_c5'] = row.pop('p13_equals_c4')
        row['c5_sha256'] = row.pop('c4_sha256')
    write_json(ROOT / 'audit/protected-method-hashes.json', protected)
    write_json(ROOT / 'audit/build.json', {
        'status': 'passed', 'baseline': str(BASE), 'baseline_sha256': BASE_SHA,
        'output': str(FINAL), 'sha256': sha(raw), 'changed_method_count': 0,
        'unchanged_main_body_records': len(final.abc.bodies), 'new_methods': editor.new_methods,
        'new_traits': editor.traits, 'constant_edits': changes, 'abc_audit': tag_audit,
        'swf_tags': tag_check, 'all_abc_nonliteral_bytes_identical': True,
        'structural_tables_identical': list(TABLES), 'runtime_verified': False,
        'sources': {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in sorted((ROOT / 'source').rglob('*.py'))}})
    print(json.dumps({'status': 'passed', 'swf_sha256': sha(raw), 'changed_methods': 0,
                      'constant_edits': len(changes), 'protected_methods': 562}))


if __name__ == '__main__':
    main()
