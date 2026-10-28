"""Patch one raw library method record, retaining noncanonical ABC bytes."""
import copy
import struct
import zlib
from bootstrap import ROOT, sha, write_json, output_path
from c4_build import TABLES, POOLS, body_bytes
from c14_compositor import LABEL, apply
from common import freeze, listing
from swfabc import abcfmt, swftags
import asm
import bodies

TAG = 'starling/text/TrueTypeCompositor'


def payload(raw):
    assert raw[:3] == b'CWS'
    body = zlib.decompress(raw[8:])
    assert len(body) + 8 == int.from_bytes(raw[4:8], 'little')
    return body


def locate(raw):
    body = payload(raw)
    matches = []
    for kind, offset, header, length in swftags.iter_tags(body):
        if kind != 82:
            continue
        data = body[offset + header:offset + header + length]
        nul = data.index(b'\0', 4)
        if data[4:nul].decode('utf-8') == TAG:
            matches.append((offset, header + length, data[:nul + 1], data[nul + 1:]))
    assert len(matches) == 1
    return matches[0]


def replace_abc(raw, abc_bytes):
    offset, size, prefix, _ = locate(raw)
    old_body = payload(raw)
    content = prefix + abc_bytes
    assert len(content) >= 63
    tag = struct.pack('<HI', (82 << 6) | 63, len(content)) + content
    new_body = old_body[:offset] + tag + old_body[offset + size:]
    return raw[:4] + struct.pack('<I', len(new_body) + 8) + zlib.compress(new_body)


def patch_library(raw):
    _, _, _, original_raw = locate(raw)
    abc = abcfmt.ABC(original_raw)
    before = copy.deepcopy(abc)
    index = bodies.resolve(abc, LABEL)
    original_body = copy.deepcopy(abc.bodies[index])
    original_record = body_bytes(original_body)
    assert original_raw.count(original_record) == 1
    record_start = original_raw.index(original_record)
    report = apply(abc)
    patched_body = abc.bodies[index]
    assert asm.unsplice_many(patched_body[5], report['insertions']) == original_body[5]
    assert len(before.bodies) == len(abc.bodies)
    for name in (*TABLES, *POOLS):
        assert freeze(getattr(before, name)) == freeze(getattr(abc, name)), name
    for i, (old, new) in enumerate(zip(before.bodies, abc.bodies)):
        assert i == index or body_bytes(old) == body_bytes(new), i
    patched_record = body_bytes(patched_body)
    patched_raw = (original_raw[:record_start] + patched_record
                   + original_raw[record_start + len(original_record):])
    parsed = abcfmt.ABC(patched_raw)
    for name in (*TABLES, *POOLS):
        assert freeze(getattr(parsed, name)) == freeze(getattr(abc, name)), name
    assert all(body_bytes(a) == body_bytes(b) for a, b in zip(parsed.bodies, abc.bodies))
    # Never serialize this ABC: its legal zero-sized pools become counts of one
    # in the inherited serializer. Replacing only the unique method record
    # keeps these and every unknown/unmodified byte exactly as received.
    assert original_raw[:record_start] == patched_raw[:record_start]
    assert original_raw[record_start + len(original_record):] == patched_raw[record_start + len(patched_record):]
    restored_abc = (patched_raw[:record_start] + original_record
                    + patched_raw[record_start + len(patched_record):])
    assert restored_abc == original_raw
    final = replace_abc(raw, patched_raw)
    assert replace_abc(final, original_raw) == raw
    for phase, body in (('c13', original_body), ('c14', patched_body)):
        output_path(ROOT / f'audit/pcode/TrueTypeCompositor__renderText-{phase}.txt').write_text(
            '\n'.join(listing(abc, body[5])) + '\n', 'utf-8')
    evidence = {
        'status': 'passed', 'tag': TAG, 'label': LABEL, 'body': index,
        'method': report, 'changed_method_count': 1, 'new_methods': [], 'new_traits': [],
        'before_abc_sha256': sha(original_raw), 'after_abc_sha256': sha(patched_raw),
        'before_record_sha256': sha(original_record), 'after_record_sha256': sha(patched_record),
        'raw_record_offset': record_start, 'before_record_bytes': len(original_record),
        'after_record_bytes': len(patched_record), 'noncanonical_abc_bytes_preserved': True,
        'inherited_serializer_roundtrip_exact': before.serialize() == original_raw,
        'raw_prefix_and_suffix_unchanged': True, 'constant_pools_identical': list(POOLS),
        'structural_tables_identical': list(TABLES), 'unsplice_recovers_c13_method': True,
        'restore_record_recovers_original_abc_and_swf': True,
        'raster_policy': 'Normal scale 1; overflow uses (maxSize-4)/max(width,height), ceil '
                         'then clamp to 1..maxSize; Matrix.scale and BitmapDataEx.scale '
                         'preserve logical layout and HTML content without recursion.'}
    write_json(ROOT / 'audit/library-build.json', evidence)
    return final, evidence, {'before_abc': original_raw, 'after_abc_sha256': sha(patched_raw)}


def restore_library(raw, undo):
    assert sha(locate(raw)[3]) == undo['after_abc_sha256']
    return replace_abc(raw, undo['before_abc'])
