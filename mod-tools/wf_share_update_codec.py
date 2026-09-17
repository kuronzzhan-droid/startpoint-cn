"""Strict native orderedmap/CSV codec; no filesystem side effects."""
import base64
import csv
import io
import struct
import zlib


def unpack(raw):
    if len(raw) < 4:
        raise ValueError('short orderedmap')
    size = struct.unpack_from('<I', raw)[0]
    if size > len(raw)-4:
        raise ValueError('orderedmap index out of range')
    index = zlib.decompress(raw[4:4+size])
    if len(index) < 4:
        raise ValueError('short index')
    count = struct.unpack_from('<I', index)[0]
    if 4+8*count > len(index):
        raise ValueError('short index pairs')
    names, data = index[4+8*count:], raw[4+size:]
    result = {}; prev_key = prev_row = 0
    for n in range(count):
        key_end, row_end = struct.unpack_from('<II', index, 4+8*n)
        if not prev_key < key_end <= len(names) or not prev_row <= row_end <= len(data):
            raise ValueError('invalid orderedmap offsets')
        key = names[prev_key:key_end].decode('utf-8')
        if key in result:
            raise ValueError('duplicate orderedmap key: '+key)
        result[key] = data[prev_row:row_end]
        prev_key, prev_row = key_end, row_end
    if prev_key != len(names) or prev_row != len(data):
        raise ValueError('trailing orderedmap bytes')
    return result


def pack(rows):
    names = bytearray(); data = bytearray(); pairs = bytearray()
    for key, raw in rows.items():
        names.extend(key.encode('utf-8')); data.extend(raw)
        pairs.extend(struct.pack('<II', len(names), len(data)))
    index = zlib.compress(struct.pack('<I',len(rows))+pairs+names)
    return struct.pack('<I',len(index))+index+data


def csv_read(raw):
    return list(csv.reader(io.StringIO(zlib.decompress(raw).decode('utf-8'))))


def csv_write(rows):
    stream = io.StringIO(newline='')
    csv.writer(stream, lineterminator='\n').writerows(rows)
    return zlib.compress(stream.getvalue().encode('utf-8'))


def node(raw):
    if raw == b'':
        return {'raw':'', 'empty':True}
    try:
        text = zlib.decompress(raw).decode('utf-8')
    except (zlib.error, UnicodeDecodeError):
        return {'children':{key:node(value) for key,value in unpack(raw).items()}}
    return {'raw':base64.b64encode(raw).decode('ascii'),
            'csv':list(csv.reader(io.StringIO(text)))}


def leaf_raw(value):
    raw = base64.b64decode(value['raw'], validate=True)
    if value.get('empty'):
        if raw != b'': raise ValueError('invalid empty node')
    elif csv_read(raw) != value['csv']:
        raise ValueError('payload leaf text differs from binary')
    return raw
