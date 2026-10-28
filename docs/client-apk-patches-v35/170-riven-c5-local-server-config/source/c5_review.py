"""Independent C5 SWF audit: parse tags and reverse only approved literal bytes."""
import json
import struct
import sys
import zlib

sys.dont_write_bytecode = True
from bootstrap import ROOT, BASE, BASE_SHA, FINAL, P13, P13_SHA, require_hash, sha, write_json
from common import freeze
from swfabc import abcfmt
import bodies

EXPECTED_SHA = '6d4a68569665dc9aa186e92a10bbfd3e25f8b52f0aa86350f2989a8abc20de4c'
PAIRS = ((b'<SERVER_HOST>:8001', b'<SERVER_HOST>:18001'),
         (b'<ADMISSION_ID>', b'<ADMISSION_ID>'))
TABLES = ('methods', 'instances', 'classes', 'scripts', 'metadata', 'namespaces',
          'ns_sets', 'ints', 'uints', 'doubles', 'multinames')
PROTECTED = {'ActionEvaluator': 78, 'NormalAttackCalculator': 9,
             'MemberImpl': 465, 'AbilityDamageShot': 10}


def read_swf(raw):
    assert raw[:3] == b'CWS'
    body = zlib.decompress(raw[8:])
    assert int.from_bytes(raw[4:8], 'little') == len(body) + 8
    cursor = (5 + 4 * (body[0] >> 3) + 7) // 8 + 4
    prefix, tags = body[:cursor], []
    while cursor < len(body):
        start = cursor
        word = int.from_bytes(body[cursor:cursor + 2], 'little')
        code, size = word >> 6, word & 63
        cursor += 2
        if size == 63:
            size = int.from_bytes(body[cursor:cursor + 4], 'little')
            cursor += 4
        content = body[cursor:cursor + size]
        assert len(content) == size
        cursor += size
        name = content[4:content.index(b'\0', 4)].decode() if code == 82 else None
        tags.append({'code': code, 'name': name, 'offset': start,
                     'header': body[start:cursor - size], 'content': content,
                     'raw': body[start:cursor]})
        if code == 0:
            break
    return body, prefix, tags, body[cursor:]


def u30(data, cursor):
    result = 0
    for shift in range(0, 35, 7):
        value = data[cursor]
        cursor += 1
        result |= (value & 127) << shift
        if value < 128:
            return result, cursor
    raise AssertionError('Malformed variable integer')


def encoded_u30(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def strings(data):
    cursor = 4
    for _ in range(2):
        count, cursor = u30(data, cursor)
        for _ in range(max(0, count - 1)):
            _, cursor = u30(data, cursor)
    count, cursor = u30(data, cursor)
    cursor += max(0, count - 1) * 8
    count, cursor = u30(data, cursor)
    rows = []
    for index in range(1, count):
        start = cursor
        size, cursor = u30(data, cursor)
        text = data[cursor:cursor + size]
        assert len(text) == size
        cursor += size
        rows.append((index, start, cursor, text))
    return rows


def abc_bytes(tag):
    split = tag['content'].index(b'\0', 4) + 1
    return tag['content'][:split], tag['content'][split:]


def reverse_tag(old, new):
    old_prefix, old_abc = abc_bytes(old)
    new_prefix, new_abc = abc_bytes(new)
    assert old_prefix == new_prefix
    old_strings, new_strings = strings(old_abc), strings(new_abc)
    assert len(old_strings) == len(new_strings)
    changes, restored = [], new_abc
    for before, after in reversed(list(zip(old_strings, new_strings))):
        index, start, end, value = after
        assert index == before[0]
        if value == before[3]:
            continue
        expected = before[3]
        kinds = []
        for kind, (source, target) in enumerate(PAIRS):
            if source in expected:
                kinds.append('address' if kind == 0 else 'admission_build')
                expected = expected.replace(source, target)
        assert len(kinds) == 1 and value == expected, (new['name'], index)
        restored = restored[:start] + encoded_u30(len(before[3])) + before[3] + restored[end:]
        changes.append({'abc': new['name'], 'string_index': index, 'kind': kinds[0],
                        'before': before[3].decode(), 'after': value.decode()})
    assert restored == old_abc
    content = new_prefix + restored
    assert len(new['header']) == len(old['header']) == 6
    assert new['header'][:2] == old['header'][:2]
    restored_tag = new['header'][:2] + struct.pack('<I', len(content)) + content
    assert restored_tag == old['raw']
    before, after = abcfmt.ABC(old_abc), abcfmt.ABC(new_abc)
    for table in TABLES:
        assert freeze(getattr(before, table)) == freeze(getattr(after, table)), (new['name'], table)
    assert freeze(before.bodies) == freeze(after.bodies)
    return restored_tag, list(reversed(changes)), before, after


def body_bytes(body):
    writer = abcfmt.W()
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
        abcfmt.write_trait(writer, trait)
    return writer.out()


def main():
    assert __debug__, 'Run without -O'
    require_hash(BASE, BASE_SHA)
    require_hash(FINAL, EXPECTED_SHA)
    require_hash(P13, P13_SHA)
    old_raw, new_raw = BASE.read_bytes(), FINAL.read_bytes()
    old_body, old_prefix, old_tags, old_tail = read_swf(old_raw)
    new_body, new_prefix, new_tags, new_tail = read_swf(new_raw)
    assert old_raw[:4] == new_raw[:4] and old_prefix == new_prefix and old_tail == new_tail
    assert len(old_tags) == len(new_tags)
    changed = [index for index, (old, new) in enumerate(zip(old_tags, new_tags))
               if old['raw'] != new['raw']]
    changed_names = [new_tags[index]['name'] for index in changed]
    assert set(changed_names) == {'cn/admission/ClientAdmission', 'cn/admission/BuildConfig', 'boot_ffc6'}
    print(json.dumps({'changed_tags_before_reversal': changed_names}), flush=True)
    restored_parts, edits, records = [new_prefix], [], {}
    for index, (old, new) in enumerate(zip(old_tags, new_tags)):
        assert (old['code'], old['name']) == (new['code'], new['name'])
        if index not in changed:
            restored_parts.append(new['raw'])
            continue
        reversed_tag, rows, before, after = reverse_tag(old, new)
        restored_parts.append(reversed_tag)
        edits.extend(rows)
        records[new['name']] = (before, after)
    restored_parts.append(new_tail)
    restored_body = b''.join(restored_parts)
    assert restored_body == old_body
    normalized_old = b'FWS' + old_raw[3:8] + old_body
    normalized_restored = b'FWS' + new_raw[3:4] + struct.pack('<I', len(restored_body) + 8) + restored_body
    assert normalized_restored == normalized_old
    assert len(edits) == 12 and sum(row['kind'] == 'address' for row in edits) == 9
    assert sum(row['kind'] == 'admission_build' for row in edits) == 3
    for source, target in PAIRS:
        assert source not in new_body and target not in old_body
    _, _, p13_tags, _ = read_swf(P13.read_bytes())
    p13_main = abcfmt.ABC(abc_bytes(next(tag for tag in p13_tags if tag['name'] == 'boot_ffc6'))[1])
    before, after = records['boot_ffc6']
    labels, protected = bodies.label_map(p13_main), {}
    for cls, expected in PROTECTED.items():
        indices = [i for i, label in labels.items() if label.split('/')[0].rstrip('$') == cls]
        assert len(indices) == expected
        for i in indices:
            assert freeze(p13_main.bodies[i]) == freeze(before.bodies[i]) == freeze(after.bodies[i])
        digest = sha(b''.join(body_bytes(after.bodies[i]) for i in indices))
        assert digest == sha(b''.join(body_bytes(p13_main.bodies[i]) for i in indices))
        protected[cls] = {'method_count': expected, 'p13_equals_c4_equals_c5': True, 'sha256': digest}
    build = json.loads((ROOT / 'audit/build.json').read_text('utf-8'))
    assert build['sha256'] == EXPECTED_SHA and not build['new_methods'] and not build['new_traits']
    result = {'status': 'passed_no_new_material_findings', 'baseline_sha256': BASE_SHA,
              'swf_sha256': EXPECTED_SHA, 'changed_tags': changed_names, 'constant_edits': edits,
              'whole_uncompressed_swf_reversal_byte_exact': True,
              'restored_uncompressed_swf_sha256': sha(normalized_restored),
              'original_uncompressed_swf_sha256': sha(normalized_old),
              'unchanged_tag_count': len(old_tags) - len(changed), 'changed_method_count': 0,
              'unchanged_main_method_records': len(after.bodies),
              'unchanged_all_changed_tag_method_records': sum(len(pair[1].bodies) for pair in records.values()),
              'unchanged_tables': list(TABLES), 'protected': protected,
              'protected_method_count': sum(PROTECTED.values()),
              'new_methods': [], 'new_traits': [],
              'review_source_sha256': sha(open(__file__, 'rb').read()),
              'independence': 'Independent SWF tag and ABC string-pool parsers plus direct byte reversal; '
                              'does not call c5_build or c5_constants rewriting/verification functions.',
              'boundary': 'Read-only SWF and p13 verification; offline suites are reported separately.'}
    write_json(ROOT / 'audit/independent-c5.json', result)
    print(json.dumps({'status': result['status'], 'swf_sha256': EXPECTED_SHA,
                      'literal_count': len(edits), 'protected_method_count': 562}))


if __name__ == '__main__':
    main()
