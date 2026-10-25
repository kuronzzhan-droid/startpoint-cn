"""Plan the ARM64 equipment-preload hook without writing a native image.

The generated shim has one narrowly defined normal-return contract: preserve
the resolver's x0-x7 and frame, call a reviewed full AOT function entry, then
tail-branch to the *unchanged current* resolver entry.  Its saved argument area
is not an AVM GC frame.  A separate, byte-bound review must establish the AOT
bridge's receiver, MethodEnv, pool, boxing and GC contract.  This module cannot
establish exception unwinding or device correctness from assembly alone.

There are no package, linker, assembler, filesystem or private-tool imports.
All addresses and source bytes are supplied explicitly by the caller.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import struct
from typing import Protocol


RESOLVER_METHOD_ID = 18392
RESOLVER_OWNER = "pinball.common.data.character::BattleCharacterLogic"
RESOLVER_PARAMETERS = (
    "pinball.asset.logic::IAssetPathCollectionBuilder",
    "pinball.common.data.character::BattleCharacterOwner",
    "pinball.scene.battle.battle.feature::BattleFeaturePermitData",
    "Boolean", "Boolean",
)
FRAME_BYTES = 0x50


class ContractError(ValueError):
    """The supplied bytes or method metadata do not satisfy this hook ABI."""


class NativeView(Protocol):
    def method(self, method_id: int) -> dict: ...
    def read(self, address: int, size: int) -> bytes: ...
    def offset(self, address: int, size: int = 1) -> int: ...


@dataclass(frozen=True)
class MethodABI:
    method_id: int
    owner: str
    parameters: tuple[str, ...]
    return_type: str


@dataclass(frozen=True)
class ResolverSnapshot:
    abi: MethodABI
    slot_offset: int
    entry_va: int
    prefix: bytes


@dataclass(frozen=True)
class BridgeReview:
    """External AOT review bound to the complete compiled function bytes.

    The compiler-only thunk must be compiled as method 18392 on its real
    BattleCharacterLogic owner with unchanged MethodInfo and activation data.
    Its resolver receiver and MethodEnv therefore retain their actual types.
    The evidence must cover the compiled entry, parameter boxing, native
    frame and live-reference GC roots.  Ordinary static helpers are rejected.
    Supplying this record does not perform or replace that external review.
    """
    method_id: int
    owner: str
    entry_va: int
    parameters: tuple[str, ...]
    return_type: str
    environment_register: int
    receiver_representation: str
    environment_contract: str
    pool_abc_sha1: str
    compiled_sha256: str
    evidence_reference: str


@dataclass(frozen=True)
class WordPatch:
    purpose: str
    file_offset: int
    before: bytes
    after: bytes


@dataclass(frozen=True)
class WrapperPlan:
    wrapper_va: int
    bridge_entry_va: int
    continuation_va: int
    code: bytes
    method_slot_patch: WordPatch
    resolver_prefix: bytes
    bridge_sha256: str
    abi_review_reference: str


def _aligned(address: int) -> None:
    if not isinstance(address, int) or address < 0 or address & 3:
        raise ContractError(f"Expected a nonnegative 4-byte-aligned address: {address!r}")


def branch(pc: int, target: int, *, link: bool = False) -> bytes:
    """Encode a direct A64 B/BL; never truncate an out-of-range displacement."""
    _aligned(pc); _aligned(target)
    delta = target - pc
    if not -(1 << 27) <= delta < (1 << 27):
        raise ContractError(f"Direct branch out of range: {pc:#x} -> {target:#x}")
    return struct.pack("<I", (0x94000000 if link else 0x14000000) | ((delta >> 2) & 0x3FFFFFF))


def branch_target(pc: int, raw: bytes, *, link: bool | None = None) -> int:
    _aligned(pc)
    if len(raw) != 4:
        raise ContractError("A branch instruction must contain exactly four bytes")
    word, = struct.unpack("<I", raw)
    if word & 0x7C000000 != 0x14000000:
        raise ContractError("Expected an A64 B/BL instruction")
    if link is not None and bool(word & 0x80000000) != link:
        raise ContractError("Unexpected B versus BL opcode")
    immediate = word & 0x3FFFFFF
    if immediate & (1 << 25):
        immediate -= 1 << 26
    return pc + (immediate << 2)


def _pair(load: bool, left: int, right: int, offset: int, *, mode: str = "offset") -> bytes:
    if left not in range(31) or right not in range(31) or offset % 8 or not -512 <= offset <= 504:
        raise ContractError("Invalid 64-bit pair instruction")
    bases = {("offset", False): 0xA9000000, ("offset", True): 0xA9400000,
             ("pre", False): 0xA9800000, ("post", True): 0xA8C00000}
    if (mode, load) not in bases:
        raise ContractError("Unsupported pair addressing mode")
    return struct.pack("<I", bases[mode, load] | (((offset // 8) & 0x7F) << 15)
                       | (right << 10) | (31 << 5) | left)


def _pair_fields(word: int) -> tuple[int, int, int, int]:
    imm = (word >> 15) & 0x7F
    if imm & 0x40:
        imm -= 0x80
    return word & 31, (word >> 10) & 31, (word >> 5) & 31, imm * 8


def validate_frame_entry(prefix: bytes) -> None:
    """Reject mid-function entries using the observed stack-frame convention.

    A frame allocation, an fp/lr pair save and an fp assignment must be present
    in the first 64 bytes.  This is an entry guard, not an unwind/GC validator.
    """
    if len(prefix) < 8 or len(prefix) % 4:
        raise ContractError("Function-entry evidence is short or misaligned")
    words = struct.unpack("<" + "I" * (min(len(prefix), 64) // 4), prefix[:64])
    first = words[0]
    left, right, base, offset = _pair_fields(first)
    if first & 0xFFC00000 != 0xA9800000 or base != 31 or offset >= 0 or offset % 16:
        raise ContractError("Function entry must include its actual allocating STP prologue")
    frame = -offset
    saved_fp_lr = (left, right) == (29, 30)
    assigned_fp = False
    for word in words:
        a, b, rn, displacement = _pair_fields(word)
        if word & 0xFFC00000 == 0xA9000000 and rn == 31 and (a, b) == (29, 30):
            saved_fp_lr |= 0 <= displacement <= frame - 16
        # ADD x29, sp, #imm (MOV x29, sp is the #0 alias).
        if word & 0xFFC003FF == 0x910003FD:
            assigned_fp |= ((word >> 10) & 0xFFF) <= frame - 16
        # Do not accept a frame sequence occurring only after a branch/call.
        if word & 0x7C000000 == 0x14000000 or word & 0xFFFFFC1F in (0xD61F0000, 0xD63F0000):
            break
    if not saved_fp_lr or not assigned_fp:
        raise ContractError("Function-entry evidence does not save and establish fp/lr")


def _validate_resolver_abi(abi: MethodABI) -> None:
    if (abi.method_id, abi.owner, abi.parameters, abi.return_type) != (
        RESOLVER_METHOD_ID, RESOLVER_OWNER, RESOLVER_PARAMETERS, "void"
    ):
        raise ContractError("Expected method_info 18392 and the real typed five-parameter resolver ABI")


def capture_resolver(native: NativeView, abi: MethodABI) -> ResolverSnapshot:
    _validate_resolver_abi(abi)
    row = native.method(abi.method_id)
    if row.get("method_id") != abi.method_id or not isinstance(row.get("slot_offset"), int):
        raise ContractError("Native method lookup does not match the requested method_info")
    address = row["va"]
    _aligned(address)
    prefix = native.read(address, 64)
    validate_frame_entry(prefix)
    return ResolverSnapshot(abi, row["slot_offset"], address, prefix)


def _validate_bridge(entry_va: int, code: bytes, review: BridgeReview) -> None:
    _aligned(entry_va)
    if entry_va != review.entry_va:
        raise ContractError("Bridge address differs from the reviewed full function entry")
    if (review.method_id, review.owner) != (RESOLVER_METHOD_ID, RESOLVER_OWNER):
        raise ContractError("Bridge must be compiled as method 18392 on its actual resolver owner")
    if review.parameters != RESOLVER_PARAMETERS or review.return_type != "void":
        raise ContractError("Bridge must retain the resolver's three typed pointers and two Booleans")
    if review.environment_register != 6:
        raise ContractError("Resolver-compatible bridge MethodEnv must occupy x6")
    if review.receiver_representation != "typed_resolver_receiver":
        raise ContractError("Bridge must retain its typed BattleCharacterLogic receiver")
    if review.environment_contract != "original_resolver_methodenv":
        raise ContractError("Bridge must retain the original resolver's MethodInfo and MethodEnv contract")
    if len(review.pool_abc_sha1) != 40 or any(c not in "0123456789abcdef" for c in review.pool_abc_sha1):
        raise ContractError("Bridge review must identify its shared ABC pool by SHA-1")
    if not review.evidence_reference.strip():
        raise ContractError("Bridge receiver, MethodEnv and GC review evidence is required")
    if hashlib.sha256(code).hexdigest() != review.compiled_sha256:
        raise ContractError("Bridge bytes differ from the externally reviewed compiled function")
    validate_frame_entry(code)


def generate_wrapper(*, wrapper_va: int, bridge_entry_va: int, continuation_va: int,
                     resolver: ResolverSnapshot, bridge_code: bytes,
                     bridge_review: BridgeReview) -> WrapperPlan:
    """Generate a slot-only shim; the old resolver entry must remain unchanged."""
    _validate_resolver_abi(resolver.abi)
    _aligned(wrapper_va); _aligned(continuation_va)
    if continuation_va != resolver.entry_va:
        raise ContractError("Continuation must equal the captured current resolver entry, with no +4 adjustment")
    validate_frame_entry(resolver.prefix)
    _validate_bridge(bridge_entry_va, bridge_code, bridge_review)
    if wrapper_va in (bridge_entry_va, continuation_va) or bridge_entry_va == continuation_va:
        raise ContractError("Wrapper, bridge and continuation entries must be distinct")
    chunks = [_pair(False, 29, 30, -FRAME_BYTES, mode="pre")]
    chunks += [_pair(False, i, i + 1, 16 + 8 * i) for i in range(0, 8, 2)]
    chunks.append(struct.pack("<I", 0x910003FD))  # mov x29, sp
    chunks.append(branch(wrapper_va + 4 * len(chunks), bridge_entry_va, link=True))
    chunks += [_pair(True, i, i + 1, 16 + 8 * i) for i in range(0, 8, 2)]
    chunks.append(_pair(True, 29, 30, FRAME_BYTES, mode="post"))
    chunks.append(branch(wrapper_va + 4 * len(chunks), continuation_va))
    code = b"".join(chunks)
    # Out-of-line shims may not overlap either original function interval.
    if max(wrapper_va, continuation_va) < min(wrapper_va + len(code), continuation_va + len(resolver.prefix)):
        raise ContractError("Wrapper overlaps the preserved resolver entry")
    if max(wrapper_va, bridge_entry_va) < min(wrapper_va + len(code), bridge_entry_va + len(bridge_code)):
        raise ContractError("Wrapper overlaps the reviewed bridge")
    patch = WordPatch("redirect resolver AOT slot only; preserve old entry bytes",
                      resolver.slot_offset, struct.pack("<Q", continuation_va), struct.pack("<Q", wrapper_va))
    return WrapperPlan(wrapper_va, bridge_entry_va, continuation_va, code, patch,
                       resolver.prefix, bridge_review.compiled_sha256, bridge_review.evidence_reference)


def plan_original_entry_redirect(native: NativeView, *, original_entry_va: int,
                                 wrapper_va: int, resolver: ResolverSnapshot) -> WordPatch:
    """Redirect an existing B-to-old-wrapper veneer; never modify the old shim.

    This covers the verified original resolver veneer and AOT slot.  It does
    not establish that every possible direct caller passes through either.
    The retained original body called by the current wrapper is not a veneer;
    redirecting that body would recurse and is deliberately rejected here.
    """
    _validate_resolver_abi(resolver.abi)
    _aligned(original_entry_va); _aligned(wrapper_va)
    if original_entry_va == resolver.entry_va or wrapper_va in (original_entry_va, resolver.entry_va):
        raise ContractError("Original entry veneer, old resolver wrapper and new wrapper must differ")
    before = native.read(original_entry_va, 4)
    if branch_target(original_entry_va, before, link=False) != resolver.entry_va:
        raise ContractError("Original entry does not currently branch to the preserved resolver wrapper")
    return WordPatch("redirect verified original resolver veneer; preserve old wrapper bytes",
                     native.offset(original_entry_va, 4), before, branch(original_entry_va, wrapper_va))


def plan_login_factory_restore(native: NativeView, *, factory_entry_va: int,
                               bad_wrapper_va: int, bad_bridge_entry_va: int) -> tuple[WordPatch, WordPatch]:
    """Recover method 17701's slot and displaced first instruction, without writes.

    The displaced word must be present in the actual erroneous 48-byte shim;
    the remainder of the original factory prologue is independently read back.
    """
    row = native.method(17701)
    if row.get("va") != bad_wrapper_va or not isinstance(row.get("slot_offset"), int):
        raise ContractError("Login factory AOT slot no longer matches the erroneous hook")
    first = native.read(factory_entry_va, 4)
    if branch_target(factory_entry_va, first, link=False) != bad_wrapper_va:
        raise ContractError("Factory entry no longer branches to the erroneous wrapper")
    bad = native.read(bad_wrapper_va, 48)
    if branch_target(bad_wrapper_va + 20, bad[20:24], link=True) != bad_bridge_entry_va + 20:
        raise ContractError("Erroneous wrapper no longer has the observed skipped-prologue call")
    displaced = bad[40:44]
    if branch_target(bad_wrapper_va + 44, bad[44:48], link=False) != factory_entry_va + 4:
        raise ContractError("Erroneous wrapper no longer retains the factory's +4 continuation")
    validate_frame_entry(displaced + native.read(factory_entry_va + 4, 60))
    return (
        WordPatch("restore LoginBonusKind.Item method_info 17701 AOT slot", row["slot_offset"],
                  struct.pack("<Q", bad_wrapper_va), struct.pack("<Q", factory_entry_va)),
        WordPatch("restore displaced LoginBonusKind.Item first instruction", native.offset(factory_entry_va, 4), first, displaced),
    )


def disassemble_wrapper(code: bytes, address: int) -> list[dict]:
    """Decode only the generated instruction subset, rejecting unknown bytes."""
    _aligned(address)
    if len(code) % 4:
        raise ContractError("Unaligned wrapper byte length")
    rows = []
    for at in range(0, len(code), 4):
        raw = code[at:at + 4]
        word, = struct.unpack("<I", raw)
        pc = address + at
        if word & 0xFFC00000 in (0xA9800000, 0xA9000000, 0xA9400000, 0xA8C00000):
            left, right, base, offset = _pair_fields(word)
            if base != 31:
                raise ContractError("Generated wrapper pair must address sp")
            kind = word & 0xFFC00000
            mnemonic = "ldp" if kind in (0xA9400000, 0xA8C00000) else "stp"
            operand = f"x{left}, x{right}, [sp, #{offset}]"
            if kind == 0xA9800000:
                operand += "!"
            elif kind == 0xA8C00000:
                operand = f"x{left}, x{right}, [sp], #{offset}"
        elif word == 0x910003FD:
            mnemonic, operand = "mov", "x29, sp"
        elif word & 0x7C000000 == 0x14000000:
            mnemonic = "bl" if word & 0x80000000 else "b"
            operand = f"#{branch_target(pc, raw):#x}"
        else:
            raise ContractError(f"Unknown wrapper instruction at {pc:#x}: {word:#x}")
        rows.append({"va": pc, "bytes": raw.hex(), "mnemonic": mnemonic, "operands": operand})
    return rows
