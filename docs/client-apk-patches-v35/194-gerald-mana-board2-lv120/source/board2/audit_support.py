"""Byte-level preservation and reversibility checks for the 129989 mana board 2 level-120 patch."""
from __future__ import annotations

import hashlib
import struct

import bootstrap
from bootstrap import sha
import asm
import bodies
from swfabc import abcfmt as fmt

ALLOWED_TARGETS = {
    "BattleCharacterLogic/getRequiredConditionsToOpenManaBoard",
    "BattleCharacterLogic/getMaxOpenableManaBoard",
}
FORBIDDEN_CLASSES = (
    "ActionEvaluator",
    "NormalAttackCalculator",
    "AbilityDamageShot",
    "ActionHitAreaGroup",
    "MemberImpl",
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def traits_bytes(traits):
    writer = fmt.W()
    for trait in traits:
        fmt.write_trait(writer, trait)
    return writer.out()


def body_bytes(body):
    """Serialize the entire method_body_info, including header/handlers/traits."""
    writer = fmt.W()
    for value in body[:5]:
        writer.u30(value)
    writer.u30(len(body[5]))
    writer.raw(body[5])
    writer.u30(len(body[6]))
    for handler in handler_list(body[6]):
        for value in handler:
            writer.u30(value)
    writer.u30(len(body[7]))
    writer.raw(traits_bytes(body[7]))
    return writer.out()


def handler_list(handlers):
    return handlers


def _class_and_pool_checks(before, after, editor):
    require((before.minor, before.major) == (after.minor, after.major), "ABC version changed")
    pool_counts = {}
    for name in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames"):
        old, new = getattr(before, name), getattr(after, name)
        prefix = new[: len(old)]
        if name == "doubles":
            equal = b"".join(struct.pack("<d", x) for x in old) == b"".join(
                struct.pack("<d", x) for x in prefix
            )
        else:
            equal = old == prefix
        require(equal, f"existing {name} pool entries changed")
        require(len(new) == len(old), f"unexpected {name} pool addition: {len(new) - len(old)}")
        pool_counts[name] = {
            "before": len(old),
            "after": len(new),
            "added": len(new) - len(old),
            "prefix_byte_exact": True,
        }
    require(after.methods == before.methods, "method signatures changed")
    require(after.metadata == before.metadata, "ABC metadata changed")
    require(len(after.instances) == len(before.instances), "class added or removed")
    require(len(after.classes) == len(before.classes), "static class table changed size")
    require(len(editor.new_methods) == 0, "no helper methods are allowed")
    require(len(editor.traits) == 0, "no class trait additions are allowed")
    for index, old in enumerate(before.instances):
        new = after.instances[index]
        require(old[:6] == new[:6], f"instance header changed at {index}")
        require(before.classes[index][0] == after.classes[index][0], f"class initializer changed at {index}")
        for static, old_traits, new_traits in (
            (False, old[6], new[6]),
            (True, before.classes[index][1], after.classes[index][1]),
        ):
            require(
                traits_bytes(old_traits) == traits_bytes(new_traits),
                f"class traits changed at {index}, static={static}",
            )
    require(len(after.scripts) == len(before.scripts), "script count changed")
    for old, new in zip(before.scripts, after.scripts):
        require(
            old[0] == new[0] and traits_bytes(old[1]) == traits_bytes(new[1]),
            "script metadata/traits changed",
        )
    return pool_counts, []


def _check_inserted_body(old, new, record, label):
    placed = record["insertions"]
    require(asm.unsplice_many(new[5], placed) == old[5], f"old instructions not recoverable: {label}")
    require(old[0] == new[0] and old[3:5] == new[3:5], f"method identity/scope changed: {label}")
    require(new[1] >= old[1] and new[2] == old[2], f"stack/local bounds invalid: {label}")
    require(traits_bytes(old[7]) == traits_bytes(new[7]), f"method traits changed: {label}")
    old_offsets = asm.encode(asm.decode(old[5]))[1]
    new_offsets = asm.encode(asm.decode(new[5]))[1]
    original_positions, accumulated = [], 0
    for position, count, _policy in placed:
        original_positions.append((position - accumulated, count))
        accumulated += count
    mapping = {}
    for index, offset in enumerate(old_offsets):
        shifted = index + sum(count for at, count in original_positions if at <= index)
        mapping[offset] = new_offsets[shifted]
    mapping[len(old[5])] = len(new[5])
    expected_handlers = [
        (mapping[start], mapping[end], mapping[target], kind, var)
        for start, end, target, kind, var in old[6]
    ]
    require(new[6] == expected_handlers, f"exception table changed beyond relocation: {label}")


def _verify_abc_reversibility(before_swf, after, editor):
    """Prove that reverting the recorded insertions + headers restores the exact input ABC bytes."""
    before = before_swf.abc
    saved = {}
    for label, record in editor.report.items():
        idx = record["body"]
        body = after.bodies[idx]
        saved[idx] = (body[5], list(body[1:5]), list(body[6]))
    try:
        for label, record in editor.report.items():
            idx = record["body"]
            body = after.bodies[idx]
            body[5] = asm.unsplice_many(body[5], record["insertions"])
            body[1:5] = list(record["before_header"])
            body[6] = list(before.bodies[idx][6])
        require(
            after.serialize() == before_swf._raw,
            "reverting insertions did not reproduce input ABC byte-for-byte",
        )
    finally:
        for idx, (code_bytes, hdr, exc) in saved.items():
            body = after.bodies[idx]
            body[5] = code_bytes
            body[1:5] = hdr
            body[6] = exc


def audit(before_swf, after_swf, editor, targets):
    before, after = before_swf.abc, after_swf.abc
    require(set(targets) <= ALLOWED_TARGETS, f"target outside approved methods: {targets}")
    require(set(editor.report) == set(targets), "changed methods do not match declared TARGETS")
    require(len(after.methods) == len(before.methods), "unregistered method signature")
    require(len(after.bodies) == len(before.bodies), "unregistered method body")
    pool_counts, appended_traits = _class_and_pool_checks(before, after, editor)
    labels = bodies.label_map(before)
    changed_indices = {bodies.resolve(before, label) for label in targets}
    preserved_digest = hashlib.sha256()

    forbidden_prefixes = tuple(
        prefix for cls in FORBIDDEN_CLASSES for prefix in (f"{cls}/", f"{cls}$/")
    )
    forbidden_counts = {cls: 0 for cls in FORBIDDEN_CLASSES}
    battle_char_unchanged = 0

    for index, old in enumerate(before.bodies):
        new, label = after.bodies[index], labels.get(index, f"anonymous#{index}")
        if index in changed_indices:
            require(
                not label.startswith(forbidden_prefixes),
                f"forbidden class modified: {label}",
            )
            require(
                label in ALLOWED_TARGETS,
                f"unauthorized BattleCharacterLogic modification: {label}",
            )
            _check_inserted_body(old, new, editor.report[label], label)
        else:
            raw = body_bytes(old)
            require(body_bytes(new) == raw, f"non-target method record changed: {label} ({index})")
            preserved_digest.update(struct.pack("<II", index, len(raw)))
            preserved_digest.update(raw)
            for cls in FORBIDDEN_CLASSES:
                if label.startswith((f"{cls}/", f"{cls}$/")):
                    forbidden_counts[cls] += 1
            if label.startswith(("BattleCharacterLogic/", "BattleCharacterLogic$/")):
                battle_char_unchanged += 1

    for cls, count in forbidden_counts.items():
        require(count > 0, f"missing forbidden class methods in ABC: {cls}")

    _verify_abc_reversibility(before_swf, after, editor)

    require(
        before_swf.signature == after_swf.signature and before_swf.version == after_swf.version,
        "SWF compression signature/version changed",
    )
    require(before_swf._prefix == after_swf._prefix, "main DoABC tag flags/name changed")
    require(
        before_swf.body[: before_swf._offset] == after_swf.body[: after_swf._offset],
        "SWF bytes before main ABC changed",
    )
    require(
        before_swf.body[before_swf._offset + before_swf._length :]
        == after_swf.body[after_swf._offset + after_swf._length :],
        "SWF bytes after main ABC changed",
    )
    return {
        "pass": True,
        "original_method_records": len(before.bodies),
        "unchanged_complete_method_records": len(before.bodies) - len(changed_indices),
        "unchanged_records_sha256": preserved_digest.hexdigest(),
        "changed_original_methods": sorted(editor.report),
        "original_instructions_recover_byte_exact": True,
        "full_abc_reversible_byte_exact": True,
        "exception_tables_only_relocated": True,
        "original_method_signatures_unchanged": True,
        "original_class_traits_byte_exact": True,
        "class_count": len(before.instances),
        "classes_added": 0,
        "appended_traits": appended_traits,
        "added_methods": editor.new_methods,
        "constant_pools": pool_counts,
        "script_and_metadata_unchanged": True,
        "non_main_abc_and_other_swf_bytes_unchanged": True,
        "forbidden_classes_unchanged_method_counts": forbidden_counts,
        "battle_character_logic_unchanged_method_count": battle_char_unchanged,
    }
