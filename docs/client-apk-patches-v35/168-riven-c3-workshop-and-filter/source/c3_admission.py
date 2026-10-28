"""Replace build constants consistently in declaration, proof and BuildConfig."""
import copy
import struct
import zlib

import asm
import bodies
from bootstrap import sha
from c3_config import ADMISSION_BUILD
from swfabc import abcfmt, swftags

TAG = b'cn/admission/ClientAdmission'
CONFIG_TAG = b'cn/admission/BuildConfig'
OLD_BUILD = '<ADMISSION_ID>'
OLD_PREFIX = 'SP-ADMISSION-1\n' + OLD_BUILD + '\n'
NEW_PREFIX = 'SP-ADMISSION-1\n' + ADMISSION_BUILD + '\n'


def unpack(raw):
    assert raw[:3] == b'CWS'
    body = zlib.decompress(raw[8:])
    assert len(body) + 8 == int.from_bytes(raw[4:8], 'little')
    return body


def tags(raw):
    body = unpack(raw)
    rows = []
    for code, offset, header, length in swftags.iter_tags(body):
        content = body[offset + header:offset + header + length]
        name = content[4:content.index(b'\0', 4)] if code == 82 else None
        rows.append((code, name, body[offset:offset + header + length]))
    return rows


def locate(raw, tag=TAG):
    body = unpack(raw)
    matches = []
    for code, offset, header, length in swftags.iter_tags(body):
        if code != 82:
            continue
        content = body[offset + header:offset + header + length]
        nul = content.index(b'\0', 4)
        if content[4:nul] == tag:
            matches.append((offset, header + length, content[:nul + 1], content[nul + 1:]))
    assert len(matches) == 1
    offset, length, prefix, abc_raw = matches[0]
    abc = abcfmt.ABC(abc_raw)
    return body, offset, length, prefix, abc, abc_raw


def replace_literal(raw, sid, expected, value):
    """Preserve noncanonical zero-count pool encodings and all other raw bytes."""
    reader = abcfmt.R(raw)
    reader.raw(4)
    for _ in range(2):
        count = reader.u30()
        for _ in range(max(0, count - 1)):
            reader.u30()
    count = reader.u30()
    reader.raw(max(0, count - 1) * 8)
    count = reader.u30()
    for index in range(1, count):
        begin = reader.p
        text = reader.raw(reader.u30())
        if index == sid:
            assert text == expected
            writer = abcfmt.W()
            writer.u30(len(value))
            writer.raw(value)
            return raw[:begin] + writer.out() + raw[reader.p:]
    raise AssertionError('Literal index missing')


def references(abc, sid):
    labels = bodies.label_map(abc)
    found = []
    for index, record in enumerate(abc.bodies):
        for number, ins in enumerate(asm.decode(record[5])):
            if ins.name == 'pushstring' and ins.args == [sid]:
                found.append({'body': index, 'label': labels.get(index), 'instruction': number})
    return found


def patch_tag(raw, tag, replacements):
    body, offset, length, prefix, abc, original_abc = locate(raw, tag)
    before = copy.deepcopy(abc)
    patched_abc, edits = original_abc, []
    for role, old, new in replacements:
        ids = [i for i, value in enumerate(abc.strings) if value == old.encode()]
        assert len(ids) == 1 and new.encode() not in abc.strings
        sid = ids[0]
        refs = references(abc, sid)
        if role == 'declaration':
            assert len(refs) == 1 and refs[0]['label'].endswith('/transport'), refs
        elif role == 'proof_prefix':
            assert len(refs) == 1 and refs[0]['label'] is None, refs
        elif role == 'config_id':
            traits = [t for _, members in abc.classes for t in members
                      if t.data[0] == 'slot' and t.data[3:] == [sid, 1]]
            assert len(traits) == 1 and abc.mn_name(traits[0].name) == 'ID'
        patched_abc = replace_literal(patched_abc, sid, old.encode(), new.encode())
        edits.append({'role':role, 'string_index':sid, 'old':old, 'new':new, 'references':refs})
    restored = patched_abc
    for edit in reversed(edits):
        restored = replace_literal(restored, edit['string_index'], edit['new'].encode(), edit['old'].encode())
    assert restored == original_abc
    content = prefix + patched_abc
    replacement = struct.pack('<HI', (82 << 6) | 63, len(content)) + content
    patched = body[:offset] + replacement + body[offset + length:]
    result = raw[:4] + struct.pack('<I', len(patched) + 8) + zlib.compress(patched)
    after = locate(result, tag)[4]
    for edit in edits:
        assert after.s(edit['string_index']) == edit['new']
        after.strings[edit['string_index']] = edit['old'].encode()
    assert after.serialize() == before.serialize()
    return result, {'abc':tag.decode(), 'edits':edits,
                    'all_method_bodies_identical':True,
                    'raw_literal_reversal_recovers_original_abc':True,
                    'before_abc_sha256':sha(original_abc), 'after_abc_sha256':sha(patched_abc)}


def patch(raw):
    result, transport = patch_tag(raw, TAG, [
        ('declaration', OLD_BUILD, ADMISSION_BUILD), ('proof_prefix', OLD_PREFIX, NEW_PREFIX)])
    result, config = patch_tag(result, CONFIG_TAG, [('config_id', OLD_BUILD, ADMISSION_BUILD)])
    old_tags, new_tags = tags(raw), tags(result)
    assert len(old_tags) == len(new_tags)
    for old, new in zip(old_tags, new_tags):
        assert old[:2] == new[:2]
        if old[2] != new[2]:
            assert old[1] in (TAG, CONFIG_TAG)
    assert OLD_BUILD.encode() not in unpack(result)
    return result, {
        'status':'passed', 'previous_build':OLD_BUILD, 'build':ADMISSION_BUILD,
        'abc_tags':[transport, config], 'all_method_bodies_identical':True,
        'all_other_abc_bytes_identical':True, 'protocol_unchanged':True,
        'capability_expected_from_server':'weapon-riven-v1',
        'server_configuration_changed':False, 'server_capability_verified':False,
        'correction':'Build declaration, SP-ADMISSION-1 proof prefix and BuildConfig.ID must agree; only string constants changed.'}


def verify_tags(base_raw, final_raw):
    before, after = tags(base_raw), tags(final_raw)
    assert len(before) == len(after)
    changed = []
    for old, new in zip(before, after):
        assert old[:2] == new[:2]
        if old[2] != new[2]:
            assert old[1] in (b'boot_ffc6', TAG, CONFIG_TAG)
            changed.append(old[1].decode())
    assert set(changed) == {'boot_ffc6', TAG.decode(), CONFIG_TAG.decode()}
    return {'changed_abc_tags': changed, 'all_other_swf_tags_byte_identical': True}
