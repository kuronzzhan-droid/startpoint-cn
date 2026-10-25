"""Preserve Mach-O compact unwind semantics while adding reviewed arm64 code.

The original __TEXT,__unwind_info section is retained at its original address.
Second-level pages are packed without unused page padding. All old encodings,
personalities and LSDA rows remain unchanged. The format is defined by LLVM's
libunwind/include/mach-o/compact_unwind_encoding.h.
"""
from __future__ import annotations

import struct


def require(ok, message):
    if not ok:
        raise ValueError(message)


def parse(data):
    require(len(data) >= 28, 'truncated unwind header')
    version, co, nc, po, np, io, ni = struct.unpack_from('<7I', data)
    require(version == 1 and ni >= 2, 'unsupported unwind header')
    def words(offset, count):
        require(0 <= offset <= offset + count * 4 <= len(data), 'unwind array out of bounds')
        return list(struct.unpack_from('<' + 'I' * count, data, offset))
    common, personalities = words(co, nc), words(po, np)
    require(io + ni * 12 <= len(data), 'unwind index out of bounds')
    index = [struct.unpack_from('<III', data, io + n * 12) for n in range(ni)]
    require(all(a[0] < b[0] for a, b in zip(index, index[1:])), 'unsorted unwind index')
    require(index[-1][1] == 0, 'missing unwind sentinel')
    pages = []
    for n, (base, at, lsda) in enumerate(index[:-1]):
        require(0 < at <= len(data) - 8, 'unwind page out of bounds')
        kind, eo, count = struct.unpack_from('<IHH', data, at)
        if kind == 3:
            require(at + 12 <= len(data), 'truncated compressed page')
            enc_off, enc_count = struct.unpack_from('<HH', data, at + 8)
            encodings = common + words(at + enc_off, enc_count)
            entries = []
            for value in words(at + eo, count):
                require(value >> 24 < len(encodings), 'bad compact encoding index')
                entries.append((base + (value & 0xffffff), encodings[value >> 24]))
        elif kind == 2:
            require(at + eo + count * 8 <= len(data), 'truncated regular page')
            entries = [struct.unpack_from('<II', data, at + eo + j * 8) for j in range(count)]
        else:
            raise ValueError('unsupported compact unwind page kind')
        require(entries and entries[0][0] == base, 'page base does not match first function')
        require(all(a[0] < b[0] for a, b in zip(entries, entries[1:])), 'unsorted unwind functions')
        require(entries[-1][0] < index[n + 1][0], 'unwind page exceeds next page')
        end_lsda = index[n + 1][2]
        require(0 <= lsda <= end_lsda <= len(data) and (end_lsda - lsda) % 8 == 0,
                'invalid LSDA index range')
        lsda_rows = [struct.unpack_from('<II', data, j) for j in range(lsda, end_lsda, 8)]
        require(all(base <= row[0] < index[n + 1][0] for row in lsda_rows), 'LSDA outside page')
        pages.append(dict(entries=entries, lsda=lsda_rows))
    return dict(common=common, personalities=personalities, pages=pages, sentinel=index[-1][0])


def encode_page(entries, common):
    require(entries and len(entries) <= 1021, 'too many compact unwind entries')
    base = entries[0][0]
    if entries[-1][0] - base > 0xffffff:
        require(len(entries) <= 511, 'too many regular unwind entries')
        return struct.pack('<IHH', 2, 8, len(entries)) + b''.join(struct.pack('<II', *r) for r in entries)
    local = []
    for _, encoding in entries:
        if encoding not in common and encoding not in local:
            local.append(encoding)
    require(len(common) + len(local) <= 256, 'too many compact encodings')
    pool = common + local
    values = [(pool.index(encoding) << 24) | (address - base) for address, encoding in entries]
    enc_offset = 12 + len(values) * 4
    return (struct.pack('<IHHHH', 3, 12, len(values), enc_offset, len(local))
            + struct.pack('<' + 'I' * len(values), *values)
            + struct.pack('<' + 'I' * len(local), *local))


def serialize(model):
    common, personalities, pages = (model[k] for k in ('common', 'personalities', 'pages'))
    co = 28
    po = co + len(common) * 4
    io = po + len(personalities) * 4
    count = len(pages) + 1
    lsda_offset = io + count * 12
    page_offset = lsda_offset + sum(len(page['lsda']) * 8 for page in pages)
    indices, lsdas, payloads = [], [], []
    for page in pages:
        payload = encode_page(page['entries'], common)
        indices.append((page['entries'][0][0], page_offset, lsda_offset))
        encoded_lsda = b''.join(struct.pack('<II', *r) for r in page['lsda'])
        lsdas.append(encoded_lsda)
        payloads.append(payload)
        page_offset += len(payload)
        lsda_offset += len(encoded_lsda)
    indices.append((model['sentinel'], 0, lsda_offset))
    return (struct.pack('<7I', 1, co, len(common), po, len(personalities), io, count)
            + struct.pack('<' + 'I' * len(common), *common)
            + struct.pack('<' + 'I' * len(personalities), *personalities)
            + b''.join(struct.pack('<III', *r) for r in indices)
            + b''.join(lsdas) + b''.join(payloads))


def extend(data, ranges):
    """Add (image-relative start, byte length, encoding) without old drift."""
    old = parse(data)
    ranges = sorted(ranges)
    require(ranges and old['sentinel'] < ranges[0][0], 'new unwind ranges overlap original code')
    require(all(size > 0 and start % 4 == size % 4 == 0 for start, size, _ in ranges),
            'unaligned unwind function')
    require(all(a[0] + a[1] <= b[0] for a, b in zip(ranges, ranges[1:])), 'overlapping unwind ranges')
    pages = [dict(entries=list(p['entries']), lsda=list(p['lsda'])) for p in old['pages']]
    # The original sentinel ended all lookups. Preserve that behavior across
    # historical appended segments by emitting an explicit no-unwind entry.
    pages[-1]['entries'].append((old['sentinel'], 0))
    entries = []
    for i, (start, size, encoding) in enumerate(ranges):
        entries.append((start, encoding))
        if i + 1 < len(ranges) and start + size < ranges[i + 1][0]:
            entries.append((start + size, 0))
    pages.append(dict(entries=entries, lsda=[]))
    model = dict(common=old['common'], personalities=old['personalities'], pages=pages,
                 sentinel=ranges[-1][0] + ranges[-1][1])
    packed = serialize(model)
    require(len(packed) <= len(data), 'compact unwind section has insufficient verified capacity')
    result = packed + bytes(len(data) - len(packed))
    require(parse(result) == model, 'compact unwind round trip differs')
    require(model['pages'][:-2] == old['pages'][:-1], 'unrelated unwind pages changed')
    require(model['pages'][-2]['entries'][:-1] == old['pages'][-1]['entries'], 'old final unwind page changed')
    return result, dict(old_functions=sum(len(p['entries']) for p in old['pages']),
                        added_functions=len(ranges), old_pages=len(old['pages']), new_pages=len(pages),
                        original_section_size=len(data), packed_size=len(packed),
                        preserved_original_encodings=True, preserved_personalities_and_lsda=True,
                        original_end_no_unwind_guard=old['sentinel'], new_end=model['sentinel'])
