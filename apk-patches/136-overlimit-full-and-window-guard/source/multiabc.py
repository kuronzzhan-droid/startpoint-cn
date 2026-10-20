"""沿用第一轮 ABC 编解码器，仅扩展多个现有 DoABC 的指令拼接封装。"""
import struct
import zlib
from swfabc import swftags


def editors(root):
    yield root.swf.tag_name.decode('utf-8'), root
    for name, editor in root.extra_editors.items():
        assert name == editor.swf.tag_name.decode('utf-8')
        yield name, editor


def compose(root):
    """只替换指定 DoABC payload，其他原始 tag 字节不动。"""
    source = root.swf
    replacements = {e.swf.tag_name: e for _, e in editors(root)}
    chunks = []
    cursor = 0
    found = set()
    for kind, offset, header, length in swftags.iter_tags(source.body):
        if kind != 82:
            continue
        content = source.body[offset+header:offset+header+length]
        nul = content.index(b'\0', 4)
        name = content[4:nul]
        if name not in replacements:
            continue
        assert name not in found, 'duplicate ABC name'
        found.add(name)
        editor = replacements[name]
        assert content[:nul+1] == editor.swf._prefix
        payload = content[:nul+1] + editor.abc.serialize()
        chunks.append(source.body[cursor:offset])
        chunks.append(struct.pack('<HI', (82 << 6) | 63, len(payload)) + payload)
        cursor = offset+header+length
    assert found == set(replacements), 'missing ABC tag'
    chunks.append(source.body[cursor:])
    body = b''.join(chunks)
    payload = zlib.compress(body) if source.signature == b'CWS' else body
    return source.signature + bytes([source.version]) + struct.pack('<I', len(body)+8) + payload


def envelope(before, after, changed_tags):
    """校验 tag 顺序、ABC 前缀及所有未修改 tag 的原始字节。"""
    assert before.signature == after.signature and before.version == after.version
    old_tags, new_tags = list(swftags.iter_tags(before.body)), list(swftags.iter_tags(after.body))
    assert len(old_tags) == len(new_tags)
    assert before.body[:old_tags[0][1]] == after.body[:new_tags[0][1]]
    unchanged, seen = 0, set()
    for old, new in zip(old_tags, new_tags):
        kind, off, head, size = old
        nkind, noff, nhead, nsize = new
        assert kind == nkind, 'SWF tag order/type changed'
        a = before.body[off:off+head+size]
        b = after.body[noff:noff+nhead+nsize]
        name = None
        if kind == 82:
            ac, bc = a[head:], b[nhead:]
            an, bn = ac.index(b'\0', 4), bc.index(b'\0', 4)
            assert ac[:an+1] == bc[:bn+1], 'DoABC prefix changed'
            name = ac[4:an].decode('utf-8')
        if name in changed_tags:
            seen.add(name)
        else:
            assert a == b, 'unexpected SWF tag change: ' + str(name)
            unchanged += 1
    aend = sum(old_tags[-1][1:])
    bend = sum(new_tags[-1][1:])
    assert before.body[aend:] == after.body[bend:]
    assert seen == set(changed_tags)
    return {'unchanged_tags': unchanged, 'changed_abc_tags': sorted(seen),
            'tag_order_prefix_and_outside_bytes_unchanged': True}
