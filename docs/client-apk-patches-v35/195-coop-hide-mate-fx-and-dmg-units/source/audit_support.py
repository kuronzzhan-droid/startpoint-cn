"""Byte-level preservation checks for the insert-only coop teammate effect patch."""
from __future__ import annotations

import hashlib
import struct

import bootstrap
from bootstrap import sha
import asm
import bodies
from swfabc import abcfmt as fmt
from matefx.patch import P8_FIND_ENEMY_LABEL, P8_TRY_REPLACEMENT_LABEL, TARGETS

ALLOWED_TARGETS = set(TARGETS)
ALLOWED_BALL_IMPL_TARGETS = frozenset({P8_FIND_ENEMY_LABEL, P8_TRY_REPLACEMENT_LABEL})
FORBIDDEN_CLASSES = (
    "MemberImpl",
    "BallImpl",
    "ActionEvaluator",
    "NormalAttackCalculator",
    "ActionHitAreaGroup",
    "AbilityDamageShot",
    "ListeningEvent",
    "DirectAttackScheduler",
    "ImpactManagerImpl",
    "ComboCalculatorImpl",
    "HitCountCheck",
)


def require(condition, message: str) -> None:
    if not condition:
        raise ValueError(message)


def traits_bytes(traits) -> bytes:
    writer = fmt.W()
    for trait in traits:
        fmt.write_trait(writer, trait)
    return writer.out()


def body_bytes(body) -> bytes:
    """Serialize the entire method_body_info record, including header/handlers/traits."""
    writer = fmt.W()
    for value in body[:5]:
        writer.u30(value)
    writer.u30(len(body[5]))
    writer.raw(body[5])
    writer.u30(len(body[6]))
    for handler in body[6]:
        for value in handler:
            writer.u30(value)
    writer.u30(len(body[7]))
    writer.raw(traits_bytes(body[7]))
    return writer.out()


def _class_and_pool_checks(before, after, editor):
    require((before.minor, before.major) == (after.minor, after.major), "ABC version changed")
    pool_counts = {}
    for name in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames"):
        old, new = getattr(before, name), getattr(after, name)
        require(len(new) >= len(old), f"{name} pool shrank")
        prefix = new[: len(old)]
        if name == "doubles":
            equal = b"".join(struct.pack("<d", x) for x in old) == b"".join(struct.pack("<d", x) for x in prefix)
        else:
            equal = old == prefix
        require(equal, f"existing {name} pool entries changed")
        pool_counts[name] = {
            "before": len(old),
            "after": len(new),
            "appended": len(new) - len(old),
            "prefix_byte_exact": True,
        }
    require(len(after.methods) == len(before.methods), "method count changed (no new methods allowed)")
    require(after.methods == before.methods, "method signatures changed")
    require(after.metadata == before.metadata, "ABC metadata changed")
    require(len(after.instances) == len(before.instances), "class added or removed")
    require(len(after.classes) == len(before.classes), "static class table changed size")
    require(not editor.traits, "no class/instance trait additions allowed")
    for index, old in enumerate(before.instances):
        new = after.instances[index]
        require(old[:6] == new[:6], f"instance header changed at {index}")
        require(before.classes[index][0] == after.classes[index][0], f"class initializer changed at {index}")
        require(traits_bytes(old[6]) == traits_bytes(new[6]), f"instance traits changed at {index}")
        require(
            traits_bytes(before.classes[index][1]) == traits_bytes(after.classes[index][1]),
            f"class traits changed at {index}",
        )
    require(len(after.scripts) == len(before.scripts), "script count changed")
    for old, new in zip(before.scripts, after.scripts):
        require(old[0] == new[0] and traits_bytes(old[1]) == traits_bytes(new[1]), "script metadata/traits changed")
    return pool_counts


def _check_inserted_body(old, new, record, label):
    placed = record["insertions"]
    require(asm.unsplice_many(new[5], placed) == old[5], f"old instructions not recoverable: {label}")
    require(old[0] == new[0] and old[3:5] == new[3:5], f"method identity/scope changed: {label}")
    require(new[1] >= old[1] and new[2] >= old[2], f"stack/local bounds shrank: {label}")
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
    mapping[len(old[5])] = len(new_code := new[5])
    expected_handlers = [
        (mapping[start], mapping[end], mapping[target], kind, var)
        for start, end, target, kind, var in old[6]
    ]
    require(new[6] == expected_handlers, f"exception table changed beyond relocation: {label}")


def audit(before_swf, after_swf, editor, targets):
    before, after = before_swf.abc, after_swf.abc
    require(set(targets) == ALLOWED_TARGETS, "targets must match the 13 approved matefx methods")
    require(set(editor.report) == set(targets), "changed methods do not match declared TARGETS")
    require(not editor.new_methods, "new methods are forbidden")
    require(len(after.bodies) == len(before.bodies), "method body count changed")
    pool_counts = _class_and_pool_checks(before, after, editor)

    labels = bodies.label_map(before)
    changed_indices = {bodies.resolve(before, label) for label in targets}
    preserved_digest = hashlib.sha256()

    forbidden_stats = {
        cls: {"method_count": 0, "hasher": hashlib.sha256()}
        for cls in FORBIDDEN_CLASSES
    }
    forbidden_prefixes = {cls: (f"{cls}/", f"{cls}$/") for cls in FORBIDDEN_CLASSES}

    for index, old in enumerate(before.bodies):
        new = after.bodies[index]
        label = labels.get(index, f"anonymous#{index}")
        matched_forbidden = [cls for cls, prefixes in forbidden_prefixes.items() if label.startswith(prefixes)]
        if index in changed_indices:
            for cls in matched_forbidden:
                require(
                    cls == "BallImpl" and label in ALLOWED_BALL_IMPL_TARGETS,
                    f"forbidden class modified: {label}",
                )
            _check_inserted_body(old, new, editor.report[label], label)
        else:
            raw = body_bytes(old)
            require(body_bytes(new) == raw, f"non-target method record changed: {label} ({index})")
            preserved_digest.update(struct.pack("<II", index, len(raw)))
            preserved_digest.update(raw)
            for cls in matched_forbidden:
                forbidden_stats[cls]["method_count"] += 1
                forbidden_stats[cls]["hasher"].update(struct.pack("<II", index, len(raw)))
                forbidden_stats[cls]["hasher"].update(raw)

    forbidden_report = {}
    for cls, info in forbidden_stats.items():
        require(info["method_count"] > 0, f"forbidden class not found in ABC: {cls}")
        entry = {
            "method_records": info["method_count"],
            "records_sha256": info["hasher"].hexdigest(),
            "byte_exact_with_input": True,
        }
        if cls == "BallImpl":
            v2_landing_idx = bodies.resolve(before, "BallImpl/wfxDashV2Landing")
            require(
                body_bytes(after.bodies[v2_landing_idx]) == body_bytes(before.bodies[v2_landing_idx]),
                "BallImpl/wfxDashV2Landing must remain byte-for-byte identical to input SWF",
            )
            entry["allowed_patched_methods"] = sorted(ALLOWED_BALL_IMPL_TARGETS)
            entry["wfxDashV2Landing_byte_exact_with_input"] = True
            entry["wfxDashV2Landing_code_sha256"] = sha(after.bodies[v2_landing_idx][5])
        forbidden_report[cls] = entry

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
        "exception_tables_only_relocated": True,
        "original_method_signatures_unchanged": True,
        "original_class_traits_byte_exact": True,
        "class_count": len(before.instances),
        "classes_added": 0,
        "methods_added": 0,
        "traits_added": 0,
        "constant_pools": pool_counts,
        "script_and_metadata_unchanged": True,
        "non_main_abc_and_other_swf_bytes_unchanged": True,
        "forbidden_classes_preserved": forbidden_report,
    }
