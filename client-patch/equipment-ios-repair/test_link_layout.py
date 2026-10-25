"""Focused failure and semantic tests for the sparse Mach-O linker."""
from __future__ import annotations

import bisect
import struct
import unittest
import types

import build_candidate as build
import compact_unwind as unwind
import finalize_delta as finalize


def lookup(data, address):
    """Independent binary lookup of an encoded compact unwind section."""
    _, co, nc, _, _, io, ni = struct.unpack_from('<7I', data)
    indexes = [struct.unpack_from('<III', data, io + j * 12) for j in range(ni)]
    page = bisect.bisect_right([r[0] for r in indexes], address) - 1
    if page < 0 or page >= ni - 1:
        return 0
    base, at, _ = indexes[page]
    kind, eo, count = struct.unpack_from('<IHH', data, at)
    if kind == 2:
        entries = [struct.unpack_from('<II', data, at + eo + j * 8) for j in range(count)]
    else:
        enc_off, enc_count = struct.unpack_from('<HH', data, at + 8)
        pool = [struct.unpack_from('<I', data, co + j * 4)[0] for j in range(nc)]
        pool += [struct.unpack_from('<I', data, at + enc_off + j * 4)[0] for j in range(enc_count)]
        entries = []
        for j in range(count):
            word = struct.unpack_from('<I', data, at + eo + j * 4)[0]
            entries.append((base + (word & 0xffffff), pool[word >> 24]))
    n = bisect.bisect_right([r[0] for r in entries], address) - 1
    return entries[n][1] if n >= 0 else 0


class UnwindTests(unittest.TestCase):
    def setUp(self):
        self.model = dict(common=[0, 0x04000000, 0x0400001f], personalities=[0x100, 0x200],
                          pages=[dict(entries=[(0x4000, 0x04000000), (0x4010, 0x0400001f)],
                                      lsda=[(0x4010, 0x8000)])], sentinel=0x4020)
        self.raw = unwind.serialize(self.model) + bytes(1024)

    def test_old_semantics_and_gap_guard(self):
        data, report = unwind.extend(self.raw, [(0x2000000, 16, 0x0400000f), (0x2000020, 12, 0x02000000)])
        for address in range(0x3ff0, 0x4030):
            self.assertEqual(lookup(self.raw, address), lookup(data, address))
        for address in (0x100000, 0x1ffffff, 0x2000010, 0x200001f, 0x200002c):
            self.assertEqual(lookup(data, address), 0)
        self.assertEqual(lookup(data, 0x2000007), 0x0400000f)
        self.assertEqual(lookup(data, 0x2000028), 0x02000000)
        actual = unwind.parse(data)
        self.assertEqual(actual['personalities'], self.model['personalities'])
        self.assertEqual(actual['pages'][0]['lsda'], self.model['pages'][0]['lsda'])
        self.assertEqual(report['added_functions'], 2)

    def test_regular_page_round_trip(self):
        model = dict(self.model, pages=[dict(entries=[(4, 0), (0x2000000, 0x4000000)], lsda=[])], sentinel=0x2000010)
        raw = unwind.serialize(model)
        self.assertEqual(unwind.parse(raw), model)
        self.assertEqual(lookup(raw, 0x2000008), 0x4000000)

    def test_reject_overlap(self):
        with self.assertRaisesRegex(ValueError, 'overlapping'):
            unwind.extend(self.raw, [(0x5000, 16, 1), (0x5008, 16, 1)])

    def test_reject_original_range(self):
        with self.assertRaisesRegex(ValueError, 'overlap original'):
            unwind.extend(self.raw, [(0x4000, 16, 1)])

    def test_reject_capacity(self):
        with self.assertRaisesRegex(ValueError, 'insufficient'):
            unwind.extend(unwind.serialize(self.model), [(0x5000, 16, 1)])

    def test_reject_invalid_encoding_index(self):
        data = bytearray(self.raw)
        page = struct.unpack_from('<I', data, struct.unpack_from('<I', data, 20)[0] + 4)[0]
        struct.pack_into('<I', data, page + 12, 0xff000000)
        with self.assertRaisesRegex(ValueError, 'encoding index'):
            unwind.parse(data)

    def test_reject_unaligned_function(self):
        with self.assertRaisesRegex(ValueError, 'unaligned'):
            unwind.extend(self.raw, [(0x5001, 16, 1)])


class MinimalLink:
    @staticmethod
    def commands(data):
        at, result = 32, []
        for _ in range(struct.unpack_from('<I', data, 16)[0]):
            command, size = struct.unpack_from('<II', data, at)
            result.append((at, command, bytes(data[at:at + size])))
            at += size
        return result

    @staticmethod
    def segments(data):
        return [dict(name=raw[8:24].rstrip(b'\0').decode(), command=at,
                     **dict(zip(('vm', 'vs', 'off', 'fs'), struct.unpack_from('<QQQQ', raw, 24))))
                for at, command, raw in MinimalLink.commands(data) if command == 0x19]

    @staticmethod
    def read_rebase(data):
        return dict(entries=[])


def fixture(extra=None):
    image = 0x100000000
    commands = []
    for name, vm, vs, off, size, text in (
        (b'__PAGEZERO', 0, image, 0, 0, False),
        (b'__TEXT', image, 0x8000, 0, 0x8000, True),
        (b'__DATA', image + 0x8000, 0x4000, 0x8000, 0x4000, False),
        (b'__LINKEDIT', image + 0xc000, 0x4000, 0xc000, 0x4000, False)):
        row = bytearray(152 if text else 72)
        struct.pack_into('<II16sQQQQiiII', row, 0, 0x19, len(row), name, vm, vs, off, size, 5, 5, int(text), 0)
        if text:
            struct.pack_into('<16s16sQQIIIIIIII', row, 72, b'__text', name, image + 0x4000, 64,
                             0x4000, 2, 0, 0, 0x80000400, 0, 0, 0)
        commands.append(row)
    commands += [struct.pack('<IIIIII', 2, 24, 0xc010, 1, 0xc020, 16),
                 struct.pack('<IIII', 0x26, 16, 0xc030, 4),
                 struct.pack('<IIII', 0x1d, 16, 0xc040, 0x3fc0)]
    if extra is not None:
        commands.append(extra)
    raw = bytearray(0x10000)
    packed = b''.join(commands)
    struct.pack_into('<8I', raw, 0, 0xfeedfacf, 0x100000c, 0, 2, len(commands), len(packed), 0, 0)
    raw[32:32 + len(packed)] = packed
    raw[0xc000:] = bytes([0xa5]) * 0x4000
    raw[0xc030:0xc034] = bytes.fromhex('80800100')
    plan = dict(future_region=dict(base_va=image + 0x10000, end_va=image + 0x10040))
    return raw, plan


class LayoutTests(unittest.TestCase):
    def test_segment_mapping_and_linkedit_offset_shift(self):
        original, plan = fixture()
        new, rx, _ = build.add_executable_segment(original, plan, MinimalLink)
        segments = MinimalLink.segments(new)
        self.assertEqual(segments[-2]['name'], '__EQFIX')
        self.assertEqual(rx['prot'], 5)
        self.assertEqual(segments[-1]['vm'], rx['vm'] + rx['size'])
        self.assertEqual(new[0x10000:], original[0xc000:])
        self.assertEqual(build.function_starts(new, MinimalLink)[1], [0x4000])
        self.assertTrue(all(not b for b in new[0xc000:0x10000]))

    def test_reject_changed_arena(self):
        original, plan = fixture()
        plan['future_region']['base_va'] += 0x4000
        with self.assertRaisesRegex(ValueError, 'arena'):
            build.add_executable_segment(original, plan, MinimalLink)

    def test_reject_occupied_header(self):
        original, plan = fixture()
        end = 32 + struct.unpack_from('<I', original, 20)[0]
        original[end] = 1
        with self.assertRaisesRegex(ValueError, 'header padding'):
            build.add_executable_segment(original, plan, MinimalLink)

    def test_reject_chained_fixups(self):
        original, plan = fixture(struct.pack('<IIII', 0x80000034, 16, 0xc100, 16))
        with self.assertRaisesRegex(ValueError, 'chained fixups'):
            build.add_executable_segment(original, plan, MinimalLink)

    def test_preservation_guard_rejects_unlisted_change(self):
        with self.assertRaisesRegex(ValueError, 'preexisting'):
            build.assert_preserved_ranges(b'abcdef', b'abXdef', 6, [(0, 2), (4, 6)])


class DeltaTests(unittest.TestCase):
    def test_eh_move_preserves_absolute_function(self):
        raw = bytes.fromhex(
            '1000000000000000017a520001781e01100c1f00'
            '3000000018000000b063f4f9ffffffff7c04000000000000'
            '00580e609e019d0293039404950596069707980899099a0a9b0b9c0c')
        original = finalize.eh_frames(raw, 0x106207000)
        moved, receipt = finalize.relocate_eh_frames(raw, 0x106207000, 2048)
        self.assertEqual(finalize.eh_frames(moved, 0x106207800), original)
        self.assertEqual(moved[:28], raw[:28])
        self.assertEqual(moved[36:], raw[36:])
        self.assertTrue(receipt['all_fde_targets_preserved'])

    def test_reject_unrecognized_cie(self):
        raw = bytes.fromhex('1000000000000000027a520001781e01100c1f00')
        with self.assertRaisesRegex(ValueError, 'unsupported EH CIE'):
            finalize.eh_frames(raw, 0x10000)

    def test_insert_bridge_in_old_zero_gap_and_later_functions(self):
        model = dict(common=[0, 0x4000000], personalities=[0x100], pages=[
            dict(entries=[(0x1000, 0x4000000), (0x1010, 0)], lsda=[(0x1000, 0x8000)]),
            dict(entries=[(0x2000000, 0x4000000)], lsda=[])], sentinel=0x2000020)
        raw = unwind.serialize(model)
        ranges = [(0x1800, 16, 0x2000000)] + [(0x3000000 + n * 32, 16, 0x4000000) for n in range(206)]
        packed, receipt = finalize._augment_model(raw, ranges)
        for address in (0x1000, 0x100f, 0x2000000, 0x200001f):
            self.assertEqual(lookup(packed, address), lookup(raw, address))
        self.assertEqual(lookup(packed, 0x1808), 0x2000000)
        self.assertEqual(lookup(packed, 0x1810), 0)
        self.assertEqual(lookup(packed, 0x3000008), 0x4000000)
        self.assertEqual(lookup(packed, 0x3000010), 0)
        self.assertTrue(receipt['preserved_personalities_and_lsda'])

    def test_reject_delta_over_old_unwind_function(self):
        model = dict(common=[0, 0x4000000], personalities=[], pages=[
            dict(entries=[(0x1000, 0x4000000)], lsda=[])], sentinel=0x1020)
        with self.assertRaisesRegex(ValueError, 'overlaps old nonzero'):
            finalize._augment_model(unwind.serialize(model), [(0x1008, 16, 0x4000000)])

    @staticmethod
    def switch_fixture(change=None):
        words = [0x7100051f, 0xd503201f, 0x540000e8, 0x90000009, 0x91000129,
                 0xb8a87928, 0x8b090108, 0xd61f0100, 0xd503201f, 0xd65f03c0]
        if change:
            words[change[0]] = change[1]
        raw = struct.pack('<10I2i', *words, -4, -4)
        record = types.SimpleNamespace(size=48, source_start=0, symbol='function')
        section = types.SimpleNamespace(virtual_address=0, content=raw)
        rows = [dict(offset=at, type=typ, symbol=symbol, raw=word) for at, typ, symbol, word in (
            (12, 10, None, 0xa0000028), (12, 3, 'function', 0),
            (16, 10, None, 0xa0000028), (16, 4, 'function', 0))]
        return record, section, rows

    def test_bounded_switch_table(self):
        record, section, rows = self.switch_fixture()
        proof = finalize.verify_switch_tables(record, section, rows, 40)
        self.assertEqual(proof['tables'][0]['targets'], [36, 36])
        self.assertEqual(proof['tables'][0]['dispatch']['bound_branch_target'], 36)

    def test_reject_bounds_branch_into_switch_load(self):
        # Reproduces the independent review's bad B.HI target: an out-of-range
        # selector must not still reach LDRSW.
        record, section, rows = self.switch_fixture((2, 0x54000068))
        with self.assertRaisesRegex(ValueError, 'bounded LDRSW'):
            finalize.verify_switch_tables(record, section, rows, 40)

    def test_reject_bounds_flags_clobber(self):
        record, section, rows = self.switch_fixture((1, 0x7100001f))
        with self.assertRaisesRegex(ValueError, 'bounded LDRSW'):
            finalize.verify_switch_tables(record, section, rows, 40)

    def test_reject_selector_clobber_after_bounds_compare(self):
        record, section, rows = self.switch_fixture((1, 0x2a1f03e8))
        with self.assertRaisesRegex(ValueError, 'bounded LDRSW'):
            finalize.verify_switch_tables(record, section, rows, 40)


class EhHeaderLayoutTests(unittest.TestCase):
    @staticmethod
    def carrier():
        image = 0x100000000
        eh = bytes.fromhex(
            '1000000000000000017a520001781e01100c1f00'
            '3000000018000000b063f4f9ffffffff7c04000000000000'
            '00580e609e019d0293039404950596069707980899099a0a9b0b9c0c')
        commands = [struct.pack('<II16sQQQQiiII', 0x19, 72, b'__PAGEZERO', 0, image, 0, 0, 0, 0, 0, 0)]
        text = bytearray(72 + 3 * 80)
        struct.pack_into('<II16sQQQQiiII', text, 0, 0x19, len(text), b'__TEXT', image, 0x4000, 0, 0x4000, 5, 5, 3, 0)
        for n, (name, off, size) in enumerate(((b'__text', 0x2000, 0x1000), (b'__unwind_info', 0x3000, 0x100),
                                               (b'__eh_frame', 0x3100, len(eh)))):
            struct.pack_into('<16s16sQQIIIIIIII', text, 72 + 80 * n, name, b'__TEXT', image + off, size,
                             off, 3 if n == 2 else 2, 0, 0, 0, 0, 0, 0)
        commands.append(text)
        commands.append(struct.pack('<II16sQQQQiiII', 0x19, 72, b'__LINKEDIT', image + 0x4000, 0x1000,
                                    0x4000, 0x1000, 1, 1, 0, 0))
        commands.append(struct.pack('<IIIIII', 2, 24, 0x4000, 2, 0x4100, 16))
        commands.append(struct.pack('<20I', 0xb, 80, *([0] * 18)))
        raw = bytearray(0x5000)
        payload = b''.join(commands)
        struct.pack_into('<8I', raw, 0, 0xfeedfacf, 0x100000c, 0, 2, len(commands), len(payload), 0, 0)
        raw[32:32 + len(payload)] = payload
        raw[0x3100:0x3100 + len(eh)] = eh
        raw[0x3100 + len(eh):0x3200] = bytes([0xa5]) * (0x100 - len(eh))
        struct.pack_into('<IBBHQ', raw, 0x4000, 4, 0xe, 1, 0, image + 0x2000)
        struct.pack_into('<IBBHQ', raw, 0x4010, 8, 1, 0, 0, 0)
        sections = build.sections(raw, MinimalLink)
        return raw, sections[1], sections[2]

    def test_move_and_remap_without_touching_historical_tail(self):
        raw, uw, eh = self.carrier()
        original = bytes(raw)
        new_uw, receipt, _ = finalize.move_eh_to_header_padding(raw, uw, eh, uw['size'] + 32, MinimalLink)
        names = [s['name'] for s in build.sections(raw, MinimalLink)]
        self.assertEqual(names, ['__eh_frame', '__text', '__unwind_info'])
        self.assertEqual(raw[0x4005], 2)
        self.assertEqual(raw[0x4006:0x4020], original[0x4006:0x4020])
        self.assertEqual(raw[0x3100 + eh['size']:0x3200], original[0x3100 + eh['size']:0x3200])
        self.assertEqual(new_uw['size'], uw['size'] + eh['size'])
        self.assertTrue(receipt['all_fde_targets_preserved'])

    def test_reject_header_bytes_in_use(self):
        raw, uw, eh = self.carrier()
        raw[build.align(32 + struct.unpack_from('<I', raw, 20)[0], 8)] = 1
        with self.assertRaisesRegex(ValueError, 'header padding'):
            finalize.move_eh_to_header_padding(raw, uw, eh, uw['size'] + 32, MinimalLink)

    def test_reject_symbol_pointer_into_eh(self):
        raw, uw, eh = self.carrier()
        struct.pack_into('<Q', raw, 0x4008, eh['va'])
        with self.assertRaisesRegex(ValueError, 'symbol value into EH'):
            finalize.move_eh_to_header_padding(raw, uw, eh, uw['size'] + 32, MinimalLink)

    def test_reject_rebase_pointer_into_eh(self):
        raw, uw, eh = self.carrier()
        struct.pack_into('<Q', raw, 0x2200, eh['va'])
        class Rebasing(MinimalLink):
            @staticmethod
            def read_rebase(data):
                return dict(entries=[(1, 0x2200, 1)])
        with self.assertRaisesRegex(ValueError, 'rebase points into old EH'):
            finalize.move_eh_to_header_padding(raw, uw, eh, uw['size'] + 32, Rebasing)

    def test_reject_unhandled_section_relocations(self):
        raw, uw, eh = self.carrier()
        struct.pack_into('<I', raw, eh['command'] + 60, 1)
        with self.assertRaisesRegex(ValueError, 'section relocations'):
            finalize.move_eh_to_header_padding(raw, uw, eh, uw['size'] + 32, MinimalLink)

    def test_reject_unhandled_local_relocations(self):
        raw, uw, eh = self.carrier()
        at, _, _ = next(row for row in MinimalLink.commands(raw) if row[1] == 0xb)
        struct.pack_into('<II', raw, at + 72, 0x4200, 1)
        with self.assertRaisesRegex(ValueError, 'external/local'):
            finalize.move_eh_to_header_padding(raw, uw, eh, uw['size'] + 32, MinimalLink)


if __name__ == '__main__':
    unittest.main()
