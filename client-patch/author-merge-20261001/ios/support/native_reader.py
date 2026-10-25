"""Read-only ARM64 Mach-O/AOT reader for explicit, pinned input bytes."""
from pathlib import Path
import hashlib
import struct

def signed(value, width):
    return value - (1 << width) if value & (1 << (width - 1)) else value

def branch_target(word, pc):
    if word & 0x7C000000 != 0x14000000:
        raise ValueError(f'Not a direct B/BL instruction at {pc:#x}: {word:#x}')
    return pc + (signed(word & 0x3FFFFFF, 26) << 2)

class Native:
    def __init__(self, path=None, data=None):
        self.path = Path(path) if path else None
        self.data = self.path.read_bytes() if data is None else data
        if len(self.data) < 32 or self.u32(0) != 0xFEEDFACF or self.u32(4) != 0x100000C:
            raise ValueError('Expected thin little-endian ARM64 Mach-O')
        self.commands, self.segments, self.sections = [], [], []
        at, end = 32, 32 + self.u32(20)
        for _ in range(self.u32(16)):
            cmd, size = struct.unpack_from('<II', self.data, at)
            if size < 8 or at + size > end or at + size > len(self.data):
                raise ValueError('Invalid Mach-O load-command bounds')
            raw = self.data[at:at + size]
            self.commands.append((at, cmd, raw))
            if cmd == 0x19:
                name = raw[8:24].rstrip(b'\0').decode()
                vm, vs, off, fs, maxprot, prot, nsects, flags = struct.unpack_from('<QQQQiiII', raw, 24)
                if fs and off + fs > len(self.data):
                    raise ValueError(f'Segment exceeds native file: {name}')
                segment = {'name': name, 'command': at, 'vm': vm, 'vs': vs, 'off': off, 'fs': fs,
                           'maxprot': maxprot, 'prot': prot, 'sections': nsects}
                self.segments.append(segment)
                for i in range(nsects):
                    section_at = 72 + 80 * i
                    if section_at + 80 > size:
                        raise ValueError('Section table exceeds segment command')
                    sec = raw[section_at:section_at + 80]
                    address, length, offset = struct.unpack_from('<QQI', sec, 32)
                    self.sections.append({'name': sec[:16].rstrip(b'\0').decode(),
                                          'segment': sec[16:32].rstrip(b'\0').decode(),
                                          'va': address, 'size': length, 'offset': offset,
                                          'flags': struct.unpack_from('<I', sec, 64)[0],
                                          'reserved1': struct.unpack_from('<I', sec, 68)[0],
                                          'reserved2': struct.unpack_from('<I', sec, 72)[0]})
            at += size
        if at != end:
            raise ValueError('Mach-O load-command size mismatch')

    def u32(self, at):
        return struct.unpack_from('<I', self.data, at)[0]

    def u64(self, at):
        return struct.unpack_from('<Q', self.data, at)[0]

    def offset(self, address, size=1):
        rows = [s for s in self.segments if s['fs'] and s['vm'] <= address and address + size <= s['vm'] + s['fs']]
        if len(rows) != 1:
            raise ValueError(f'Address not uniquely file-backed: {address:#x}+{size:#x}')
        return rows[0]['off'] + address - rows[0]['vm']

    def address(self, offset, size=1):
        rows = [s for s in self.segments if s['fs'] and s['off'] <= offset and offset + size <= s['off'] + s['fs']]
        if len(rows) != 1:
            raise ValueError(f'Offset not uniquely file-backed: {offset:#x}+{size:#x}')
        return rows[0]['vm'] + offset - rows[0]['off']

    def segment(self, address):
        return next(s for s in self.segments if s['fs'] and s['vm'] <= address < s['vm'] + s['fs'])

    def read(self, address, size):
        at = self.offset(address, size)
        return self.data[at:at + size]

    def cstring(self, address, limit=4096):
        at = self.offset(address)
        end = self.data.find(b'\0', at, min(at + limit, len(self.data)))
        if end < 0:
            raise ValueError(f'Unterminated C string at {address:#x}')
        return self.data[at:end].decode('utf-8')

    def aot(self, info_offset=104549248):
        table = self.u64(info_offset + 48)
        count = self.u64(info_offset + 56)
        return {'info_offset': info_offset, 'full_abc_sha1': self.data[info_offset:info_offset + 20].hex(),
                'runtime_abc_va': self.u64(info_offset + 24), 'runtime_abc_bytes': self.u64(info_offset + 32),
                'method_table_va': table, 'method_table_offset': self.offset(table, count * 8),
                'method_count': count}

    def method(self, method_id):
        aot = self.aot()
        if not 0 <= method_id < aot['method_count']:
            raise ValueError('Method id outside current AOT table')
        slot = aot['method_table_offset'] + method_id * 8
        target = self.u64(slot)
        return {'method_id': method_id, 'slot_offset': slot, 'va': target,
                'offset': self.offset(target) if target else None,
                'segment': self.segment(target)['name'] if target else None}

    def branch(self, address):
        return branch_target(struct.unpack('<I', self.read(address, 4))[0], address)

    def trace_entry(self, address, max_hops=8):
        """Follow direct B and ADRP/ADD/BR veneers; never infer conditional targets."""
        rows, seen = [], set()
        for _ in range(max_hops):
            if address in seen:
                raise ValueError('Native entry branch cycle')
            seen.add(address)
            raw = self.read(address, 16)
            words = struct.unpack('<IIII', raw)
            target = None
            kind = None
            if words[0] & 0xFC000000 == 0x14000000:
                target, kind = branch_target(words[0], address), 'B'
            elif words[0] & 0x9F000000 == 0x90000000 and words[1] & 0xFFC00000 == 0x91000000:
                reg = words[0] & 31
                if ((words[1] >> 5) & 31) == reg and (words[1] & 31) == reg and words[2] == 0xD61F0000 | (reg << 5):
                    imm = (((words[0] >> 5) & 0x7FFFF) << 2) | ((words[0] >> 29) & 3)
                    target = (address & ~0xFFF) + (signed(imm, 21) << 12) + ((words[1] >> 10) & 0xFFF)
                    kind = 'ADRP_ADD_BR'
            rows.append({'va': address, 'offset': self.offset(address), 'segment': self.segment(address)['name'],
                         'prefix_sha256': hashlib.sha256(raw).hexdigest(), 'kind': kind or 'body', 'target': target})
            if target is None:
                return rows
            address = target
        raise ValueError('Native entry chain exceeds bounded hop count')

    def disasm(self, address, size):
        import capstone
        cs = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_LITTLE_ENDIAN)
        raw = self.read(address, size)
        return [{'va': i.address, 'offset': self.offset(i.address, i.size), 'bytes': i.bytes.hex(),
                 'mnemonic': i.mnemonic, 'operands': i.op_str} for i in cs.disasm(raw, address)]
