"""Raw ABC string-pool edits with exact reversal, without rebuilding methods."""
from c4_admission import unpack
from c5_config import ADMISSION_BUILD, OLD_ADDRESS, NEW_ADDRESS
from swfabc import abcfmt, swftags

OLD_BUILD = '<ADMISSION_ID>'


def literals(raw):
    reader = abcfmt.R(raw)
    reader.raw(4)
    for _ in range(2):
        for _ in range(max(0, reader.u30() - 1)):
            reader.u30()
    reader.raw(max(0, reader.u30() - 1) * 8)
    count = reader.u30()
    for index in range(1, count):
        begin = reader.p
        length = reader.u30()
        text_offset = reader.p
        value = reader.raw(length)
        yield index, begin, text_offset, reader.p, value


def rewrite(raw, reverse=False):
    pairs = [(OLD_ADDRESS.encode(), NEW_ADDRESS.encode()),
             (OLD_BUILD.encode(), ADMISSION_BUILD.encode())]
    if reverse:
        pairs = [(new, old) for old, new in pairs]
    edits, segments, cursor = [], [], 0
    for sid, begin, text_offset, end, old in literals(raw):
        new = old
        for source, target in pairs:
            new = new.replace(source, target)
        if new == old:
            continue
        writer = abcfmt.W()
        writer.u30(len(new))
        writer.raw(new)
        segments.extend((raw[cursor:begin], writer.out()))
        cursor = end
        edits.append({'string_index': sid, 'abc_literal_offset': text_offset,
                      'old': old.decode('utf-8'), 'new': new.decode('utf-8')})
    return b''.join(segments) + raw[cursor:], edits


def reverse_all_constants(raw):
    return rewrite(raw, reverse=True)[0]


def abc_records(raw):
    body = unpack(raw)
    for ordinal, (code, offset, header, length) in enumerate(swftags.iter_tags(body)):
        if code != 82:
            continue
        content = body[offset + header:offset + header + length]
        nul = content.index(b'\0', 4)
        yield {'ordinal': ordinal, 'offset': offset, 'header': header,
               'length': length, 'name': content[4:nul].decode('utf-8'),
               'prefix': content[:nul + 1], 'raw': content[nul + 1:],
               'abc_body_offset': offset + header + nul + 1}
