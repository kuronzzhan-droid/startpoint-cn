"""Portable byte/contract tests; no ARM64, AVM, package or device execution."""
from __future__ import annotations

from dataclasses import replace
import hashlib
import struct
import unittest

import native_preload as n


WRAPPER = 0x10C3C5800
BRIDGE = 0x10C3C5000
OLD_RESOLVER = 0x106207AA0
SYNTHETIC_VENEER = 0x106206000
RETAINED_RESOLVER = 0x104963A08
BAD_WRAPPER = 0x10C3C5700
BAD_BRIDGE = 0x10C338DA0
FACTORY = 0x10491FDE8
ABI = n.MethodABI(18392, n.RESOLVER_OWNER, n.RESOLVER_PARAMETERS, "void")

# Exact first 64 current old-resolver-wrapper bytes, retained as a small
# provenance fixture.  No native image or package is needed by these tests.
OLD_PREFIX = bytes.fromhex(
    "fd7bbaa9 f44f01a9 f65702a9 f85f03a9 fa6704a9 fb2b00f9 fd030091 f30300aa "
    "f40301aa f50302aa f60303aa f703042a f803052a f90306aa e00313aa e10314aa"
)
RETAINED_PREFIX = bytes.fromhex(
    "fc6fbaa9 fa6701a9 f85f02a9 f65703a9 f44f04a9 fd7b05a9 fd430191 ffc301d1 "
    "f30306aa 680a40f9 f60300aa a58316b8 a4c315b8 151940f9 f40303aa f90302aa"
)
BAD_CODE = bytes.fromhex(
    "fd7bbba9 e00701a9 e20f02a9 e41703a9 fd030091 a8cdfd97 e00741a9 e20f42a9 "
    "e41743a9 fd7bc5a8 f85fbca9 b0691516"
)
FACTORY_REST = bytes.fromhex(
    "f65701a9 f44f02a9 fd7b03a9 fdc30091 ff8300d1 f40302aa 880a40f9 f50301aa "
    "161940f9 d30640f9 e00313aa 50c9e697 880240f9 883300f9 e0230091"
)
# A synthetic, normally returning framed function.  Its BridgeReview below is
# a unit-test fixture, not evidence that a real compiled AOT ABI was reviewed.
SYNTHETIC_BRIDGE = bytes.fromhex("fd7bbfa9 fd030091 fd7bc1a8 c0035fd6")


class NativeFixture:
    def __init__(self):
        self.regions = {
            OLD_RESOLVER: OLD_PREFIX,
            SYNTHETIC_VENEER: n.branch(SYNTHETIC_VENEER, OLD_RESOLVER),
            RETAINED_RESOLVER: RETAINED_PREFIX,
            BAD_WRAPPER: BAD_CODE,
            FACTORY: n.branch(FACTORY, BAD_WRAPPER) + FACTORY_REST,
        }
        self.methods = {
            18392: {"method_id": 18392, "slot_offset": 163692224, "va": OLD_RESOLVER},
            17701: {"method_id": 17701, "slot_offset": 163686696, "va": BAD_WRAPPER},
        }

    def method(self, method_id):
        return self.methods[method_id]

    def read(self, address, size):
        for start, data in self.regions.items():
            if start <= address and address + size <= start + len(data):
                return data[address - start:address - start + size]
        raise n.ContractError(f"Fixture bytes absent at {address:#x}+{size:#x}")

    def offset(self, address, size=1):
        self.read(address, size)
        return address - 0x100000000


def bridge_review():
    return n.BridgeReview(
        method_id=18392, owner=n.RESOLVER_OWNER, entry_va=BRIDGE,
        parameters=n.RESOLVER_PARAMETERS, return_type="void", environment_register=6,
        receiver_representation="typed_resolver_receiver",
        environment_contract="original_resolver_methodenv", pool_abc_sha1="0" * 40,
        compiled_sha256=hashlib.sha256(SYNTHETIC_BRIDGE).hexdigest(),
        evidence_reference="synthetic unit fixture only; not an AOT/native acceptance",
    )


def plan(native=None, **changes):
    view = native or NativeFixture()
    kwargs = dict(wrapper_va=WRAPPER, bridge_entry_va=BRIDGE, continuation_va=OLD_RESOLVER,
                  resolver=n.capture_resolver(view, ABI), bridge_code=SYNTHETIC_BRIDGE,
                  bridge_review=bridge_review())
    kwargs.update(changes)
    return n.generate_wrapper(**kwargs)


def interpret_wrapper_normal_return(code, address, bridge, continuation):
    """Bounded semantics of generated instructions and one explicit call summary.

    This interprets instruction bytes, not an ARM64 CPU.  The bridge summary
    returns normally, obeys callee-save rules and deliberately destroys x0-x17.
    No claim about the real bridge's GC, exceptions or device behavior follows.
    """
    regs = {f"x{i}": 0x40000000 + i * 0x111 for i in range(31)}
    regs["sp"] = 0x70000000
    initial = dict(regs)
    memory = {}
    pc, calls, stores = address, [], []
    for _ in range(32):
        if pc == continuation:
            return {"registers": regs, "initial": initial, "calls": calls, "stores": stores}
        offset = pc - address
        if offset < 0 or offset + 4 > len(code):
            raise AssertionError("Wrapper branched outside the known code")
        word, = struct.unpack_from("<I", code, offset)
        pc += 4
        kind = word & 0xFFC00000
        if kind in (0xA9800000, 0xA9000000, 0xA9400000, 0xA8C00000):
            left, right, base = word & 31, (word >> 10) & 31, (word >> 5) & 31
            immediate = (word >> 15) & 127
            immediate = (immediate - 128 if immediate & 64 else immediate) * 8
            assert base == 31
            if kind == 0xA9800000:
                regs["sp"] += immediate
            at = regs["sp"] + (immediate if kind in (0xA9000000, 0xA9400000) else 0)
            if kind in (0xA9800000, 0xA9000000):
                memory[at], memory[at + 8] = regs[f"x{left}"], regs[f"x{right}"]
                stores += [at, at + 8]
            else:
                regs[f"x{left}"], regs[f"x{right}"] = memory[at], memory[at + 8]
            if kind == 0xA8C00000:
                regs["sp"] += immediate
        elif word == 0x910003FD:
            regs["x29"] = regs["sp"]
        elif word & 0xFC000000 == 0x94000000:
            target = n.branch_target(pc - 4, code[offset:offset + 4], link=True)
            assert target == bridge
            assert regs["sp"] % 16 == 0
            calls.append({"target": target, "arguments": [regs[f"x{i}"] for i in range(8)],
                          "sp": regs["sp"], "fp": regs["x29"]})
            regs["x30"] = pc
            for i in range(18):
                regs[f"x{i}"] = 0xDEAD0000 + i
        elif word & 0xFC000000 == 0x14000000:
            pc = n.branch_target(pc - 4, code[offset:offset + 4], link=False)
        else:
            raise AssertionError(f"Unsupported generated instruction {word:#x}")
    raise AssertionError("Wrapper instruction limit exceeded")


class NativePreloadTests(unittest.TestCase):
    def test_branch_encoding_roundtrip(self):
        for delta in (-(1 << 27), -4, 0, 4, (1 << 27) - 4):
            for link in (False, True):
                raw = n.branch(0x20000000, 0x20000000 + delta, link=link)
                self.assertEqual(n.branch_target(0x20000000, raw, link=link), 0x20000000 + delta)

    def test_bad_branch_ranges_and_alignment_rejected(self):
        for delta in (-(1 << 27) - 4, 1 << 27, 2):
            with self.assertRaises(n.ContractError):
                n.branch(0x20000000, 0x20000000 + delta)
        with self.assertRaises(n.ContractError):
            n.branch_target(0, b"\0\0\0\0")

    def test_actual_18392_prefix_is_a_complete_entry(self):
        captured = n.capture_resolver(NativeFixture(), ABI)
        self.assertEqual(captured.entry_va, OLD_RESOLVER)
        self.assertEqual(captured.prefix, OLD_PREFIX)

    def test_body_index_17701_is_not_a_resolver_method_id(self):
        with self.assertRaisesRegex(n.ContractError, "method_info 18392"):
            n.capture_resolver(NativeFixture(), replace(ABI, method_id=17701))

    def test_real_resolver_metadata_is_required(self):
        for changes in ({"parameters": ("Object",) * 5}, {"owner": "AuthorState"}, {"return_type": "Object"}):
            with self.assertRaises(n.ContractError):
                n.capture_resolver(NativeFixture(), replace(ABI, **changes))

    def test_wrong_snapshot_metadata_cannot_bypass_generator_guard(self):
        snapshot = n.capture_resolver(NativeFixture(), ABI)
        with self.assertRaises(n.ContractError):
            plan(resolver=replace(snapshot, abi=replace(ABI, method_id=17701)))

    def test_full_entry_and_tail_entry_are_exact(self):
        result = plan()
        rows = n.disassemble_wrapper(result.code, WRAPPER)
        self.assertEqual(len(result.code), 52)
        self.assertEqual(rows[6]["mnemonic"], "bl")
        self.assertEqual(n.branch_target(WRAPPER + 24, result.code[24:28], link=True), BRIDGE)
        self.assertEqual(n.branch_target(WRAPPER + 48, result.code[48:52], link=False), OLD_RESOLVER)
        self.assertEqual(result.method_slot_patch.after, struct.pack("<Q", WRAPPER))

    def test_normal_return_restores_all_argument_and_callee_state_before_old_wrapper(self):
        result = plan()
        observed = interpret_wrapper_normal_return(result.code, WRAPPER, BRIDGE, OLD_RESOLVER)
        for register in ["sp"] + [f"x{i}" for i in range(31) if i < 8 or i >= 18]:
            self.assertEqual(observed["registers"][register], observed["initial"][register], register)
        self.assertEqual(observed["calls"][0]["arguments"], [observed["initial"][f"x{i}"] for i in range(8)])
        self.assertEqual(observed["calls"][0]["sp"], observed["initial"]["sp"] - 80)
        self.assertTrue(all(observed["initial"]["sp"] - 80 <= a < observed["initial"]["sp"] for a in observed["stores"]))

    def test_bridge_mid_entry_or_old_object_signature_is_rejected(self):
        for changes in ({"entry_va": BRIDGE + 20}, {"parameters": ("Object", "Object", "Object", "Boolean", "Boolean")},
                        {"method_id": 101444}, {"owner": "cn.mod::AuthorState"}, {"environment_register": 2},
                        {"receiver_representation": "class_closure"}, {"environment_contract": "borrow_any_env"}):
            with self.assertRaises(n.ContractError):
                plan(bridge_review=replace(bridge_review(), **changes))

    def test_review_is_bound_to_actual_compiled_bytes(self):
        with self.assertRaisesRegex(n.ContractError, "differ"):
            plan(bridge_code=SYNTHETIC_BRIDGE + b"\0\0\0\0")
        with self.assertRaises(n.ContractError):
            plan(bridge_review=replace(bridge_review(), evidence_reference=""))

    def test_skipped_prologue_is_rejected_even_with_a_matching_hash(self):
        # Actual old bridge+0x14 begins SUB sp, sp, #0x20, not its allocating STP.
        skipped = bytes.fromhex("ff8300d1 f60306aa c80a40f9 e9230091")
        review = replace(bridge_review(), compiled_sha256=hashlib.sha256(skipped).hexdigest())
        with self.assertRaisesRegex(n.ContractError, "actual allocating STP"):
            plan(bridge_code=skipped, bridge_review=review)

    def test_continuation_plus_four_or_alias_is_rejected(self):
        for address in (OLD_RESOLVER + 4, WRAPPER, BRIDGE):
            with self.assertRaises(n.ContractError):
                plan(continuation_va=address)

    def test_overlap_and_out_of_range_are_rejected(self):
        for address in (BRIDGE + 4, OLD_RESOLVER + 4, 0x200000000):
            with self.assertRaises(n.ContractError):
                plan(wrapper_va=address)

    def test_optional_original_veneer_redirect_does_not_change_old_wrapper(self):
        native = NativeFixture()
        before = dict(native.regions)
        snapshot = n.capture_resolver(native, ABI)
        patch = n.plan_original_entry_redirect(native, original_entry_va=SYNTHETIC_VENEER,
                                              wrapper_va=WRAPPER, resolver=snapshot)
        self.assertEqual(n.branch_target(SYNTHETIC_VENEER, patch.after, link=False), WRAPPER)
        self.assertEqual(patch.before, n.branch(SYNTHETIC_VENEER, OLD_RESOLVER))
        self.assertEqual(native.regions, before)

    def test_cannot_redirect_old_wrapper_to_itself_or_accept_a_changed_veneer(self):
        native = NativeFixture()
        snapshot = n.capture_resolver(native, ABI)
        with self.assertRaises(n.ContractError):
            n.plan_original_entry_redirect(native, original_entry_va=OLD_RESOLVER, wrapper_va=WRAPPER, resolver=snapshot)
        native.regions[SYNTHETIC_VENEER] = n.branch(SYNTHETIC_VENEER, BAD_WRAPPER)
        with self.assertRaises(n.ContractError):
            n.plan_original_entry_redirect(native, original_entry_va=SYNTHETIC_VENEER, wrapper_va=WRAPPER, resolver=snapshot)

    def test_real_retained_resolver_has_no_existing_veneer_to_redirect(self):
        native = NativeFixture()
        with self.assertRaises(n.ContractError):
            n.plan_original_entry_redirect(native, original_entry_va=RETAINED_RESOLVER,
                                          wrapper_va=WRAPPER, resolver=n.capture_resolver(native, ABI))

    def test_wrong_login_factory_hook_restoration_uses_displaced_actual_word(self):
        native = NativeFixture()
        before = dict(native.regions)
        patches = n.plan_login_factory_restore(native, factory_entry_va=FACTORY,
                                               bad_wrapper_va=BAD_WRAPPER, bad_bridge_entry_va=BAD_BRIDGE)
        self.assertEqual(patches[0].before, struct.pack("<Q", BAD_WRAPPER))
        self.assertEqual(patches[0].after, struct.pack("<Q", FACTORY))
        self.assertEqual(patches[1].after.hex(), "f85fbca9")
        self.assertEqual(native.regions, before)

    def test_changed_bad_hook_is_not_silently_restored(self):
        for mutate in ("slot", "factory", "bridge", "continuation"):
            native = NativeFixture()
            if mutate == "slot":
                native.methods[17701]["va"] = FACTORY
            elif mutate == "factory":
                native.regions[FACTORY] = b"\0" * 4 + FACTORY_REST
            elif mutate == "bridge":
                native.regions[BAD_WRAPPER] = BAD_CODE[:20] + n.branch(BAD_WRAPPER + 20, BAD_BRIDGE, link=True) + BAD_CODE[24:]
            else:
                native.regions[BAD_WRAPPER] = BAD_CODE[:44] + n.branch(BAD_WRAPPER + 44, FACTORY + 8)
            with self.subTest(mutate=mutate), self.assertRaises(n.ContractError):
                n.plan_login_factory_restore(native, factory_entry_va=FACTORY,
                                             bad_wrapper_va=BAD_WRAPPER, bad_bridge_entry_va=BAD_BRIDGE)

    def test_unknown_instruction_is_rejected(self):
        with self.assertRaises(n.ContractError):
            n.disassemble_wrapper(b"\0\0\0\0", WRAPPER)


if __name__ == "__main__":
    unittest.main(verbosity=2)
