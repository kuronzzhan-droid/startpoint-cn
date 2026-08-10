#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Reusable three-phase Boss hit-trial template support.

The module intentionally separates portable trial mechanics from a Boss's
visual shell.  A JSON template selects the source Boss and animation carriers;
the generated hit gauges, linked protected resistances and phase records use
only native generic client data structures.
"""
from __future__ import annotations

import argparse
import copy
import csv
import io
import json
from pathlib import Path
from typing import Any

import wf_field_catalog as field_catalog
import wf_rogue_build as rogue


TRIAL_KINDS = {
    "direct_attack": (0, "DirectAttack"),
    "skill": (1, "Skill"),
    "power_flip": (2, "PowerFlip"),
    "skill_chain": (3, "SkillChain"),
}

RESISTANCE_KINDS = {
    "ability": "ACAbilityDamageResistance",
    "direct_attack": "ACDirectAttackDamageResistance",
    "power_flip": "ACPowerFlipDamageResistance",
    "skill": "ACSkillDamageResistance",
}

COMMON_TRIAL_BUFF_KINDS = {
    "debuff_immunity": "ACToleranceOfDebuff",
    "attack_up": "ACAttackPoint",
}

# Eye Dragon and the other native GeneralEnemy state graphs use these three
# columns for state-to-state transitions.  Identity/timeline (0), next native
# phase (14), and trial success (26) are deliberately not graph edges here.
NATIVE_STATE_REFERENCE_COLUMNS = (31, 32, 40)


def cells(leaf: bytes | str) -> list[str]:
    text = leaf.decode("utf-8") if isinstance(leaf, bytes) else leaf
    return next(csv.reader(io.StringIO(text)))


def join(row: list[str], like: bytes | str) -> bytes | str:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="").writerow(row)
    text = buffer.getvalue()
    return text.encode("utf-8") if isinstance(like, bytes) else text


def _condition_range(value: float | int) -> list[dict[str, float | int]]:
    return [{"min": value, "max": value}]


def transition_handoff_states(handoff: dict[str, Any]) -> list[tuple[str, int]]:
    """Return deterministic short timer states for one phase handoff.

    The client reliably exits the native timer state at 60 frames, while a
    single 300-frame clone can remain active indefinitely.  Longer locks are
    therefore represented as a chain of independently exiting short states.
    ``frames`` is the requested total duration and ``segment_frames`` opts in
    to the safe chained representation.
    """
    name = str(handoff["name"])
    total = int(handoff["frames"])
    segment = int(handoff.get("segment_frames", total))
    count = (total + segment - 1) // segment
    result: list[tuple[str, int]] = []
    remaining = total
    for index in range(1, count + 1):
        state_name = name if index == 1 else f"{name}__wait{index}"
        duration = min(segment, remaining)
        result.append((state_name, duration))
        remaining -= duration
    return result


def load_template(path: Path | str, name: str) -> dict[str, Any]:
    source = Path(path)
    payload = json.loads(source.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1:
        raise ValueError(f"unsupported Boss trial schema: {payload.get('schema_version')}")
    templates = payload.get("templates")
    if not isinstance(templates, dict) or name not in templates:
        raise KeyError(f"Boss trial template is missing: {name}")
    template = copy.deepcopy(templates[name])
    template["name"] = name
    validate_template(template)
    return template


def _require_text(mapping: dict, key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Boss trial field must be non-empty text: {key}")
    return value


def _validate_carrier(carrier: Any, label: str) -> None:
    if carrier is None:
        return
    if not isinstance(carrier, dict):
        raise ValueError(f"{label} must be an object or null")
    templates = carrier.get("templates")
    names = carrier.get("names")
    if (
        not isinstance(templates, list)
        or not isinstance(names, list)
        or not templates
        or len(templates) != len(names)
        or not all(isinstance(value, str) and value for value in templates + names)
    ):
        raise ValueError(f"{label} templates/names must be equal non-empty text lists")


def _validate_trial_buffs(value: Any, label: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    unknown = set(value) - set(COMMON_TRIAL_BUFF_KINDS)
    if unknown:
        raise ValueError(f"{label} has an unknown buff: " + ", ".join(sorted(unknown)))
    for key, strength in value.items():
        if isinstance(strength, bool) or not isinstance(strength, (int, float)):
            raise ValueError(f"{label} buff {key} must be numeric")
        numeric = float(strength)
        if key == "debuff_immunity" and not 0 <= numeric <= 1:
            raise ValueError(f"{label} debuff_immunity must be between 0 and 1")
        if key == "attack_up" and not 0 <= numeric <= 10:
            raise ValueError(f"{label} attack_up must be between 0 and 10")


def validate_template(template: dict[str, Any]) -> None:
    if not isinstance(template, dict):
        raise ValueError("Boss trial template must be an object")
    _require_text(template, "source_boss")
    _require_text(template, "source_phase")
    _require_text(template, "entry_state")
    target = template.get("target")
    if not isinstance(target, dict):
        raise ValueError("Boss trial target must be an object")
    is_rush = int(target.get("rush_event_id", 0)) > 0 and int(target.get("round", 0)) > 0
    is_advent = (
        int(target.get("advent_event_id", 0)) > 0
        and int(target.get("quest_no", 0)) > 0
    )
    if is_rush == is_advent:
        raise ValueError("Boss trial target must select exactly one Rush or Advent quest")
    placement = template.get("placement")
    if placement is not None:
        if not isinstance(placement, dict):
            raise ValueError("Boss trial placement must be an object")
        for key in ("source_kind", "source_boss", "target_kind"):
            _require_text(placement, key)
    ids = template.get("ids")
    if not isinstance(ids, dict):
        raise ValueError("Boss trial ids must be an object")
    for key in ("boss", "field", "zone", "routine"):
        _require_text(ids, key)
    actions = template.get("actions")
    if not isinstance(actions, dict):
        raise ValueError("Boss trial actions must be an object")
    _require_text(actions, "guard")
    phase_reentry = actions.get("phase_reentry")
    phase_reentry_slots = template.get("phase_reentry_action_slots", [])
    if (phase_reentry is None) != (not phase_reentry_slots):
        raise ValueError(
            "Boss trial phase_reentry action and action slots must be configured together"
        )
    if phase_reentry is not None:
        _require_text(actions, "phase_reentry")
        if (
            not isinstance(phase_reentry_slots, list)
            or not phase_reentry_slots
            or any(
                isinstance(slot, bool) or not 111 <= int(slot) <= 160
                for slot in phase_reentry_slots
            )
            or len({int(slot) for slot in phase_reentry_slots})
            != len(phase_reentry_slots)
        ):
            raise ValueError(
                "Boss trial phase_reentry_action_slots must be unique Boss action slots 111..160"
            )
    legacy = actions.get("legacy", [])
    if not isinstance(legacy, list):
        raise ValueError("Boss trial legacy actions must be a list")
    for item in legacy:
        if not isinstance(item, dict):
            raise ValueError("Boss trial legacy action must be an object")
        _require_text(item, "logical")
        if item.get("mode") not in {"empty", "phase"}:
            raise ValueError("Boss trial legacy action mode must be empty or phase")
    retry = template.get("retry")
    if not isinstance(retry, dict):
        raise ValueError("Boss trial retry must be an object")
    if int(retry.get("interval_frames", 0)) <= 0 or int(retry.get("count", 0)) <= 0:
        raise ValueError("Boss trial retry interval/count must be positive")
    post_trial_suffix = template.get("post_trial_suffix", "__mod_after_trial")
    if not isinstance(post_trial_suffix, str) or not post_trial_suffix:
        raise ValueError("Boss trial post_trial_suffix must be non-empty text")

    _validate_trial_buffs(
        template.get("common_trial_buffs", {}),
        "Boss trial common_trial_buffs",
    )
    resistance_layers = int(template.get("resistance_layers", 1))
    if not 1 <= resistance_layers <= 99:
        raise ValueError("Boss trial resistance_layers must be 1..99")
    resistance_strength = float(template.get("resistance_strength", 0.99))
    if not 0 <= resistance_strength <= 100:
        raise ValueError("Boss trial resistance_strength must be 0..100")

    phases = template.get("phases")
    if not isinstance(phases, list) or len(phases) != 3:
        raise ValueError("the current native template requires exactly three phases")
    thresholds: list[float] = []
    linked_kinds: list[str] = []
    for index, phase in enumerate(phases, start=1):
        if not isinstance(phase, dict):
            raise ValueError(f"Boss trial phase {index} must be an object")
        if index < 3:
            threshold = float(phase.get("hp_threshold", 0))
            if not 0 < threshold < 1:
                raise ValueError(f"Boss trial phase {index} HP threshold must be between 0 and 1")
            thresholds.append(threshold)
        elif phase.get("hp_threshold") is not None:
            raise ValueError("the final Boss trial phase cannot have an HP threshold")
        trial = phase.get("trial")
        resistances = phase.get("resistances", [])
        resistance_strengths = phase.get("resistance_strengths", {})
        phase_resistance_layers = int(phase.get("resistance_layers", resistance_layers))
        if not 1 <= phase_resistance_layers <= 99:
            raise ValueError(
                f"Boss trial phase {index} resistance_layers must be 1..99"
            )
        _validate_trial_buffs(
            phase.get("trial_buffs", {}),
            f"Boss trial phase {index} trial_buffs",
        )
        if not isinstance(resistances, list) or any(
            resistance not in RESISTANCE_KINDS for resistance in resistances
        ):
            raise ValueError(f"Boss trial phase {index} has an unknown resistance")
        if not isinstance(resistance_strengths, dict) or any(
            resistance not in RESISTANCE_KINDS
            or resistance not in resistances
            or not 0 <= float(strength) <= 100
            for resistance, strength in resistance_strengths.items()
        ):
            raise ValueError(
                f"Boss trial phase {index} has invalid per-resistance strengths"
            )
        if trial is None:
            if resistances:
                raise ValueError(f"Boss trial phase {index} cannot guard a missing trial")
        else:
            if not isinstance(trial, dict) or trial.get("kind") not in TRIAL_KINDS:
                raise ValueError(f"Boss trial phase {index} has an unknown trial kind")
            if int(trial.get("target", 0)) <= 0:
                raise ValueError(f"Boss trial phase {index} target must be positive")
            _require_text(trial, "success_state")
            _validate_carrier(trial.get("clear_carrier"), f"phase {index} clear_carrier")
            if resistances:
                linked_kinds.append(TRIAL_KINDS[trial["kind"]][1])
        _validate_carrier(phase.get("entry_carrier"), f"phase {index} entry_carrier")
        handoff = phase.get("transition_handoff")
        if handoff is not None:
            if index == 3 and template.get("preserve_native_phases") is not True:
                raise ValueError("the final Boss trial phase cannot define a transition handoff")
            if not isinstance(handoff, dict):
                raise ValueError(f"Boss trial phase {index} transition_handoff must be an object")
            _require_text(handoff, "name")
            frames = int(handoff.get("frames", 0))
            if not 1 <= frames <= 600:
                raise ValueError(
                    f"Boss trial phase {index} transition_handoff frames must be 1..600"
                )
            segment_frames = int(handoff.get("segment_frames", frames))
            if not 1 <= segment_frames <= 60:
                raise ValueError(
                    f"Boss trial phase {index} transition_handoff segment_frames "
                    "must be 1..60"
                )
            if int(phase.get("phase_kind", 0)) != 1:
                raise ValueError(
                    f"Boss trial phase {index} transition_handoff requires phase_kind=1"
                )
            end_state = phase.get("transition_invincible_end_state")
            if not isinstance(end_state, str) or not end_state:
                raise ValueError(
                    f"Boss trial phase {index} transition handoff requires an "
                    "invincibility end state"
                )
            # GeneralBossOrFunnel clears old-style Withstand only when the
            # configured state exits.  A long handoff is a chain of native
            # short timers, so the final timer is the invincibility end state.
            expected_end_state = transition_handoff_states(handoff)[-1][0]
            if end_state != expected_end_state:
                raise ValueError(
                    f"Boss trial phase {index} invincibility end state must be the "
                    f"final timed transition handoff: {expected_end_state}"
                )
        if template.get("preserve_native_phases") is True:
            _require_text(phase, "native_phase")
            _require_text(phase, "native_entry_state")
    if not thresholds[0] > thresholds[1]:
        raise ValueError("Boss trial HP thresholds must decrease by phase")
    # Later guards are retried from spawn and match by native trial kind. Two
    # guarded phases with the same kind would therefore activate together.
    if len(linked_kinds) != len(set(linked_kinds)):
        raise ValueError("guarded phases must use distinct native trial kinds")


def action_logicals(template: dict[str, Any]) -> tuple[str, ...]:
    actions = template["actions"]
    result = [actions["guard"] + ".action.dsl.amf3.deflate"]
    if actions.get("phase_reentry"):
        result.append(actions["phase_reentry"] + ".action.dsl.amf3.deflate")
    result.extend(item["logical"] + ".action.dsl.amf3.deflate" for item in actions.get("legacy", []))
    return tuple(result)


def create_condition_command(
    condition_kind: str,
    *,
    strength: float,
    duration_frames: int,
    linked_kind: str,
    allow_retry: bool,
    layers: int = 1,
) -> list:
    return [
        "Command",
        [
            "CreateCondition",
            -17,
            [[
                condition_kind,
                _condition_range(duration_frames),
                _condition_range(strength),
                _condition_range(layers),
            ]],
            _condition_range(1),
            ["None"],
            False,             # non-cancelable: player buff removal cannot erase it
            allow_retry,       # do not memoize a pre-trial rejected attempt
            "",
            [linked_kind],
            False,
            3,
            _condition_range(1),
            False,
        ],
    ]


def create_resistance_command(
    resistance: str,
    *,
    strength: float,
    duration_frames: int,
    linked_kind: str,
    allow_retry: bool,
    layers: int = 1,
) -> list:
    return create_condition_command(
        RESISTANCE_KINDS[resistance],
        strength=strength,
        duration_frames=duration_frames,
        linked_kind=linked_kind,
        allow_retry=allow_retry,
        layers=layers,
    )


def action_dsl(expressions: list[list]) -> list:
    return [
        "ActionDsl", 1, ["None"],
        False, False, False, False, False, False, False, 0,
        ["Block", expressions],
    ]


def _phase_guard_commands(
    template: dict[str, Any],
    phase_index: int,
    *,
    retry: bool,
) -> list[list]:
    phase = template["phases"][phase_index - 1]
    trial = phase.get("trial")
    if trial is None:
        return []
    linked_kind = TRIAL_KINDS[trial["kind"]][1]
    strength = float(phase.get("resistance_strength", template.get("resistance_strength", 0.99)))
    resistance_strengths = phase.get("resistance_strengths", {})
    resistance_layers = int(phase.get(
        "resistance_layers", template.get("resistance_layers", 1)
    ))
    duration = int(template.get("condition_duration_frames", 99999999))
    commands = [
        create_resistance_command(
            resistance,
            strength=float(resistance_strengths.get(resistance, strength)),
            duration_frames=duration,
            linked_kind=linked_kind,
            allow_retry=retry,
            layers=resistance_layers,
        )
        for resistance in phase.get("resistances", [])
    ]
    common_trial_buffs = dict(template.get("common_trial_buffs", {}))
    common_trial_buffs.update(phase.get("trial_buffs", {}))
    commands.extend(
        create_condition_command(
            COMMON_TRIAL_BUFF_KINDS[buff],
            strength=float(strength),
            duration_frames=duration,
            linked_kind=linked_kind,
            allow_retry=retry,
        )
        for buff, strength in common_trial_buffs.items()
    )
    return commands


def build_action_assets(template: dict[str, Any]) -> dict[str, bytes]:
    validate_template(template)
    first_commands = _phase_guard_commands(template, 1, retry=False)
    retry_commands: list[list] = []
    # Re-apply every active trial guard, including phase 1.  A linked
    # CreateCondition is rejected while its native gauge is absent, and is
    # rejected again after that gauge has completed.  The retry therefore
    # discovers later native phases without recreating a completed guard.
    #
    # Do not interpret the number rendered beside a linked resistance icon as
    # CreateCondition layers: the client displays the linked trial's remaining
    # target there.  Strong trial immunity is represented by one high-strength
    # layer and is removed atomically by native gauge completion.
    for phase_index in range(1, 4):
        retry_commands.extend(_phase_guard_commands(template, phase_index, retry=True))
    if retry_commands:
        retry = template["retry"]
        first_commands.append([
            "Event",
            [
                "Repeat",
                int(retry["interval_frames"]),
                int(retry["count"]),
                "*",
                ["Block", retry_commands],
            ],
        ])

    trees: dict[str, list] = {template["actions"]["guard"]: action_dsl(first_commands)}
    phase_reentry = template["actions"].get("phase_reentry")
    if phase_reentry:
        # GeneralBoss pre-action Repeat events are owned by the active
        # subroutine and are discarded during a Fire Beast phase change.
        # Re-enter through the exact native animation actions used by the
        # destination carriers (Fire Beast skill2/skill3), then start an
        # independent loop for that phase.  Linked retry commands are accepted
        # only by the currently declared native gauge, so one shared action
        # safely covers all three distinct trial kinds.
        reentry_commands = list(retry_commands)
        if retry_commands:
            retry = template["retry"]
            reentry_commands.append([
                "Event",
                [
                    "Repeat",
                    int(retry["interval_frames"]),
                    int(retry["count"]),
                    "*",
                    ["Block", retry_commands],
                ],
            ])
        trees[phase_reentry] = action_dsl(reentry_commands)
    for item in template["actions"].get("legacy", []):
        if item["mode"] == "empty":
            expressions: list[list] = []
        else:
            expressions = _phase_guard_commands(template, int(item["phase"]), retry=True)
        trees[item["logical"]] = action_dsl(expressions)

    assets = {
        logical + ".action.dsl.amf3.deflate": field_catalog.build_dsl(tree)
        for logical, tree in trees.items()
    }
    for logical, blob in assets.items():
        parsed = field_catalog.parse_dsl(blob)
        expected = trees[logical.removesuffix(".action.dsl.amf3.deflate")]
        if parsed != expected:
            raise ValueError(f"Boss trial action roundtrip failed: {logical}")
    return assets


def _rewrite_next_phase(states: dict, next_state: str) -> None:
    for key, leaf in list(states.items()):
        row = cells(leaf)
        while len(row) <= 52:
            row.append("")
        row[14] = next_state
        states[key] = join(row, leaf)


def _attach_trial(
    states: dict,
    trial: dict[str, Any],
    *,
    state_names: set[str] | None = None,
) -> None:
    """Attach one shared native gauge to the pre-clear active loop.

    Some Boss shells change action state immediately after entering a phase.
    A descriptor only on the first state therefore disappears before the
    client can display it.  Repeating the same descriptor over the *active
    pre-clear loop* is the native representation of one logical gauge.  The
    post-clear loop is deliberately excluded, so completion remains one-shot.
    """
    kind = TRIAL_KINDS[trial["kind"]][0]
    for key, leaf in list(states.items()):
        if state_names is not None and key not in state_names:
            continue
        row = cells(leaf)
        while len(row) <= 52:
            row.append("")
        row[22:27] = [
            str(kind),
            str(int(trial["target"])),
            "true" if trial.get("countdown", False) else "false",
            "true",
            trial["success_state"],
        ]
        states[key] = join(row, leaf)


def _attach_trial_once(states: dict, state: str, trial: dict[str, Any]) -> None:
    """Create a native hit trial at exactly one phase-entry state.

    Copying a descriptor onto every animation state lets an ordinary Boss
    loop create the same gauge again after success.  Native gauges survive
    state changes, so one entry descriptor is sufficient and is the reusable
    one-shot contract for every trial kind.
    """
    if state not in states:
        raise KeyError(f"Boss trial one-shot entry state is missing: {state}")
    leaf = states[state]
    row = cells(leaf)
    while len(row) <= 52:
        row.append("")
    kind = TRIAL_KINDS[trial["kind"]][0]
    row[22:27] = [
        str(kind),
        str(int(trial["target"])),
        "true" if trial.get("countdown", False) else "false",
        "true",
        trial["success_state"],
    ]
    states[state] = join(row, leaf)


def _attach_native_no_jump_trial(
    states: dict,
    trial: dict[str, Any],
    *,
    state_names: set[str] | None = None,
) -> None:
    """Attach an official completing hit gauge without a state jump.

    Complex native Bosses such as Eye Dragon only publish timeline clips for
    their official state names.  Their stock hit gauges therefore use
    ``enabled=true`` and ``success_state=(None)``: completion closes the gauge
    and clears linked conditions, but never asks ``GeneralEnemy`` to enter a
    synthetic state whose timeline clip does not exist.
    """
    kind = TRIAL_KINDS[trial["kind"]][0]
    for key, leaf in list(states.items()):
        if state_names is not None and key not in state_names:
            continue
        row = cells(leaf)
        while len(row) <= 52:
            row.append("")
        row[22:27] = [
            str(kind),
            str(int(trial["target"])),
            "true" if trial.get("countdown", False) else "false",
            "true",
            "(None)",
        ]
        states[key] = join(row, leaf)


def _partition_native_trial_phase(
    states: dict,
    trial: dict[str, Any],
    partition: dict[str, Any],
) -> None:
    """Split one official phase into trial and cleared native subgraphs.

    A completing hit gauge is owned by every state that declares its
    descriptor.  Merely pointing completion at ``(None)`` leaves the empty
    gauge alive, while a synthetic state name crashes native bosses because
    no matching timeline sequence exists.  This adapter instead uses an
    existing official state as the descriptor-free completion destination.

    Cross-boundary state references are folded back into their own side so a
    cleared loop cannot recreate the trial and an unfinished loop cannot
    accidentally enter the cleared half before satisfying the gauge.
    """
    if not isinstance(partition, dict):
        raise ValueError("native_state_partition must be an object")
    raw_pre_states = partition.get("pre_states")
    if not isinstance(raw_pre_states, list) or not raw_pre_states or any(
        not isinstance(name, str) or not name for name in raw_pre_states
    ):
        raise ValueError("native trial pre_states must be a non-empty text list")
    pre_states = set(raw_pre_states)
    if len(pre_states) != len(raw_pre_states):
        raise ValueError("native trial pre_states must not contain duplicates")
    pre_loop_state = str(partition.get("pre_loop_state", ""))
    post_entry_state = str(partition.get("post_entry_state", ""))
    all_states = set(states)
    missing = pre_states - all_states
    if missing:
        raise KeyError(
            "native trial partition references missing pre states: "
            + ", ".join(sorted(missing))
        )
    if pre_loop_state not in pre_states:
        raise ValueError("native trial pre_loop_state must belong to pre_states")
    if post_entry_state not in all_states or post_entry_state in pre_states:
        raise ValueError(
            "native trial post_entry_state must be an existing post-trial state"
        )
    if trial["success_state"] != post_entry_state:
        raise ValueError(
            "native trial success_state must equal partition post_entry_state"
        )
    post_entry_row = cells(states[post_entry_state])
    if not post_entry_row or post_entry_row[0] != post_entry_state:
        raise ValueError(
            "native trial post_entry_state must own an official matching timeline"
        )

    # Remove stock descriptors first.  Eye Dragon phase 3 contains an
    # unrelated native PowerFlip gauge which otherwise survives in BUFF32.
    for key, leaf in list(states.items()):
        row = cells(leaf)
        while len(row) <= 52:
            row.append("")
        row[22:27] = ["(None)", "", "false", "false", "(None)"]
        states[key] = join(row, leaf)

    for key, leaf in list(states.items()):
        row = cells(leaf)
        for index in NATIVE_STATE_REFERENCE_COLUMNS:
            if index >= len(row) or row[index] not in all_states:
                continue
            target_is_pre = row[index] in pre_states
            if key in pre_states and not target_is_pre:
                row[index] = pre_loop_state
            elif key not in pre_states and target_is_pre:
                row[index] = post_entry_state
        states[key] = join(row, leaf)

    _attach_trial(states, trial, state_names=pre_states)

    descriptors: set[str] = set()
    for key, leaf in states.items():
        row = cells(leaf)
        if row[22] not in {"", "(None)"}:
            descriptors.add(key)
            if row[26] != post_entry_state:
                raise ValueError(f"native trial clear target diverged: {key}")
        for index in NATIVE_STATE_REFERENCE_COLUMNS:
            if index >= len(row) or row[index] not in all_states:
                continue
            if (key in pre_states) != (row[index] in pre_states):
                raise ValueError(
                    f"native trial partition still has a cross edge: "
                    f"{key}[{index}] -> {row[index]}"
                )
    if descriptors != pre_states:
        raise ValueError(
            "native trial descriptor partition is incomplete: "
            f"expected {sorted(pre_states)}, got {sorted(descriptors)}"
        )
    if cells(states[post_entry_state])[22] not in {"", "(None)"}:
        raise ValueError("native trial post entry still owns a trial descriptor")


def _audit_one_shot_phase(
    states: dict,
    *,
    trial: dict[str, Any],
    expected_trial_states: set[str],
    post_trial_suffix: str,
) -> None:
    """Reject builds that expose a trial outside its one-shot entry carrier."""
    descriptors = []
    post_names = {key for key in states if key.endswith(post_trial_suffix)}
    base_names = {key.removesuffix(post_trial_suffix) for key in post_names}
    for key, leaf in states.items():
        row = cells(leaf)
        if len(row) > 26 and row[22] not in {"", "(None)"} and row[25] == "true":
            descriptors.append(key)
        if key in post_names:
            if len(row) > 26 and row[22] not in {"", "(None)"}:
                raise ValueError(f"post-trial state still creates a trial: {key}")
            for index, value in enumerate(row):
                if index not in {0, 14} and value in base_names:
                    raise ValueError(
                        f"post-trial state returns to the original trial chain: "
                        f"{key}[{index}]"
                    )
    if set(descriptors) != expected_trial_states:
        raise ValueError(
            "one-shot trial descriptors must stay inside the entry carrier: "
            f"expected {sorted(expected_trial_states)}, got {sorted(descriptors)}"
        )
    success_state = trial["success_state"]
    for key in descriptors:
        row = cells(states[key])
        if row[26] != success_state:
            raise ValueError(f"trial state has a divergent clear target: {key}")


def _build_post_trial_chain(
    states: dict,
    suffix: str,
    *,
    preserve_timeline_sequence: bool = False,
) -> tuple[dict, dict[str, str]]:
    mapping = {key: f"{key}{suffix}" for key in states}
    result = {}
    for key, leaf in states.items():
        row = cells(copy.deepcopy(leaf))
        while len(row) <= 52:
            row.append("")
        # GeneralBoss state-table keys and timeline sequence names are
        # separate identifiers.  Portable GeneralEnemy templates own their
        # generated sequences and may rename both.  Complex native bosses
        # (notably eye_dragon_multibattle_boss), however, only have timeline
        # clips for the official row[0] names.  Their descriptor-free clone
        # therefore needs a new lookup key while retaining the native
        # sequence name, otherwise trial completion crashes in
        # PlayheadTimeline.getSequenceByName.
        if not preserve_timeline_sequence:
            row[0] = mapping[key]
        row[22:27] = ["(None)", "", "false", "false", "(None)"]
        for index, value in enumerate(row):
            if index not in {0, 14} and value in mapping:
                row[index] = mapping[value]
        result[mapping[key]] = join(row, leaf)
    return result, mapping


def _build_carrier_chain(
    source_states: dict,
    carrier: dict,
    final_destination: str,
    *,
    next_phase_state: str,
    exit_mapping: dict[str, str] | None = None,
) -> dict:
    templates = tuple(carrier["templates"])
    names = tuple(carrier["names"])
    mapping = dict(zip(templates, names))
    result = {}
    for position, (source_name, target_name) in enumerate(zip(templates, names)):
        if source_name not in source_states:
            raise KeyError(f"Boss trial carrier state is missing: {source_name}")
        leaf = source_states[source_name]
        row = cells(copy.deepcopy(leaf))
        while len(row) <= 52:
            row.append("")
        row[0] = target_name
        row[14] = next_phase_state
        row[22:27] = ["(None)", "", "false", "false", "(None)"]
        for index, value in enumerate(row):
            if index in {0, 14}:
                continue
            if value in mapping:
                row[index] = mapping[value]
            elif exit_mapping is not None and value in exit_mapping:
                # A native animation can leave its nominal five-state chain
                # through secondary timeout/reaction branches.  Trial-clear
                # carriers must redirect every such exit to the descriptor-
                # free post-trial clone, otherwise the completed gauge is
                # recreated when one branch leaks back to the active loop.
                row[index] = exit_mapping[value]
        if carrier.get("deterministic") is True and position < len(templates) - 1:
            # Some native animation families (notably the fire-beast third
            # phase carrier) branch to fb_cancel instead of their nominal
            # sibling state.  A generated carrier must never inherit that
            # model-specific cancellation edge: keep its wait fallback local
            # and advance through the explicitly configured sequence.
            row[31] = names[position + 1]
            row[32] = names[position + 1]
            row[40] = target_name
        if position == len(templates) - 1:
            row[31] = final_destination
            if carrier.get("deterministic") is True:
                row[32] = final_destination
            row[40] = final_destination
            if row[41] not in {"", "(None)"}:
                row[41] = final_destination
        result[target_name] = join(row, leaf)
    return result


def _audit_clear_carrier_exits(
    states: dict,
    *,
    clear_names: set[str],
    pre_trial_names: set[str],
) -> None:
    """Ensure a trial-clear animation cannot leak to the pre-clear loop."""
    for name in clear_names:
        row = cells(states[name])
        for index, value in enumerate(row):
            if index in {0, 14}:
                continue
            if value in pre_trial_names:
                raise ValueError(
                    f"trial clear carrier leaks to pre-clear state: "
                    f"{name}[{index}] -> {value}"
                )


def apply_template(
    *,
    rush_quests: dict,
    advent_quests: dict | None = None,
    field_data: dict,
    zones: dict,
    bosses: dict,
    boss_states: dict,
    boss_levels: dict,
    template: dict[str, Any],
    boss_identity: bytes | str | None = None,
) -> dict[str, Any]:
    """Apply a validated trial template and return generated identifiers."""
    validate_template(template)
    target = template["target"]
    if "rush_event_id" in target:
        event_key = str(int(target["rush_event_id"]))
        round_key = str(int(target["round"]))
        quest_table = rush_quests
        field_index = 98
        target_label = "Rush round"
    else:
        event_key = str(int(target["advent_event_id"]))
        round_key = str(int(target["quest_no"]))
        if advent_quests is None:
            raise ValueError("Boss trial Advent target requires advent_quests")
        quest_table = advent_quests
        field_index = 115
        target_label = "Advent quest"
    if event_key not in quest_table or round_key not in quest_table[event_key]:
        raise KeyError(f"Boss trial target {target_label} is missing: {event_key}/{round_key}")
    quest_round = cells(quest_table[event_key][round_key])
    source_field = quest_round[field_index]
    source_field_row = cells(field_data[source_field])
    source_zone = source_field_row[2]
    if not isinstance(zones.get(source_zone), dict):
        raise ValueError("Boss trial source field has no cloneable zone")

    source_boss = template["source_boss"]
    source_phase = str(template["source_phase"])
    if source_boss not in bosses or source_boss not in boss_states:
        raise KeyError(f"Boss trial source Boss is missing: {source_boss}")
    if not isinstance(boss_states[source_boss].get(source_phase), dict):
        raise ValueError(f"Boss trial source phase is missing: {source_boss}/{source_phase}")

    ids = template["ids"]
    phases = template["phases"]
    entry_state = template["entry_state"]
    guard_action = template["actions"]["guard"]
    post_trial_suffix = template.get("post_trial_suffix", "__mod_after_trial")

    def phase_entry(index: int) -> str:
        carrier = phases[index - 1].get("entry_carrier")
        return carrier["names"][0] if carrier else entry_state

    def transition_entry(source_index: int) -> str:
        handoff = phases[source_index - 1].get("transition_handoff")
        return handoff["name"] if handoff else phase_entry(source_index + 1)

    def clone_boss_node(node):
        if isinstance(node, dict):
            return {key: clone_boss_node(value) for key, value in node.items()}
        row = cells(node)
        while len(row) <= 109:
            row.append("")
        row[42] = ids["routine"]
        row[43] = entry_state
        row[109] = guard_action
        phase_reentry = template["actions"].get("phase_reentry")
        if phase_reentry:
            for slot in template.get("phase_reentry_action_slots", []):
                slot = int(slot)
                while len(row) <= slot:
                    row.append("")
                paths = [path for path in row[slot].split(",") if path]
                if phase_reentry not in paths:
                    paths.append(phase_reentry)
                row[slot] = ",".join(paths)
        row[45:52] = [
            transition_entry(1), "(None)", str(phases[0]["hp_threshold"]),
            str(phases[0].get("phase_kind", 0)),
            str(phases[0].get("transition_invincible_end_state", "")),
            "(None)", "(None)",
        ]
        row[52:59] = [
            transition_entry(2), "(None)", str(phases[1]["hp_threshold"]),
            str(phases[1].get("phase_kind", 0)),
            str(phases[1].get("transition_invincible_end_state", "")),
            "(None)", "(None)",
        ]
        return join(row, node)

    bosses[ids["boss"]] = clone_boss_node(bosses[source_boss])
    if boss_identity is not None:
        identity = cells(boss_identity)
        if len(identity) < 24:
            raise ValueError("Boss trial identity row is too short")
        for variant, leaf in list(bosses[ids["boss"]].items()):
            row = cells(leaf)
            row[1:3] = identity[1:3]
            row[15:20] = identity[15:20]
            row[24:27] = [identity[21], identity[22], identity[23]]
            bosses[ids["boss"]][variant] = join(row, leaf)
    native_states = boss_states[source_boss][source_phase]
    routine = {str(index): copy.deepcopy(native_states) for index in range(1, 4)}

    for phase_index in range(1, 4):
        phase = phases[phase_index - 1]
        # gotoNextPhaseIfPossible() gives the current state's
        # initial_state_id_of_next_subroutine precedence over the Boss row's
        # phase-change start state.  Therefore every source-phase state must
        # point at the same short handoff as the Boss row; otherwise the
        # handoff is bypassed, Withstand never observes its end state, and the
        # Boss remains invincible even though its native action loop resumes.
        next_state = transition_entry(phase_index) if phase_index < 3 else "(None)"
        _rewrite_next_phase(routine[str(phase_index)], next_state)
        trial_state_names = set(routine[str(phase_index)])
        trial = phase.get("trial")
        if trial is not None:
            post, mapping = _build_post_trial_chain(
                routine[str(phase_index)], post_trial_suffix
            )
            routine[str(phase_index)].update(post)
            clear_carrier = trial.get("clear_carrier")
            if clear_carrier:
                clear_chain = _build_carrier_chain(
                    native_states,
                    clear_carrier,
                    mapping[entry_state],
                    next_phase_state=next_state,
                    exit_mapping=mapping,
                )
                routine[str(phase_index)].update(clear_chain)
                _audit_clear_carrier_exits(
                    routine[str(phase_index)],
                    clear_names=set(clear_chain),
                    pre_trial_names=trial_state_names,
                )
        entry_carrier = phase.get("entry_carrier")
        entry_trial_states: set[str] = set()
        if entry_carrier:
            entry_chain = _build_carrier_chain(
                native_states,
                entry_carrier,
                entry_state,
                next_phase_state=next_state,
            )
            routine[str(phase_index)].update(entry_chain)
            entry_trial_states.update(entry_chain)
        if trial is not None:
            if not entry_trial_states:
                raise ValueError(
                    f"trial phase {phase_index} requires a dedicated entry carrier"
                )
            # The native gauge must remain declared throughout the active
            # phase loop; restricting it to the short entry animation makes
            # the client remove it as soon as that animation ends.  The clear
            # carrier now has an exhaustive exit mapping to the post-trial
            # clone, so the completed gauge cannot be recreated.
            trial_state_names.update(entry_trial_states)
            _attach_trial(
                routine[str(phase_index)],
                trial,
                state_names=trial_state_names,
            )
            _audit_one_shot_phase(
                routine[str(phase_index)],
                trial=trial,
                expected_trial_states=trial_state_names,
                post_trial_suffix=post_trial_suffix,
            )

    # GeneralBossOrFunnel clears old-style Withstand when the configured end
    # state exits.  Long windows use a chain of proven 60-frame native timers;
    # the phase starts at the first timer and Withstand ends when the last one
    # exits.  The trial carrier begins only after invincibility is cleared.
    for source_phase in (1, 2):
        handoff = phases[source_phase - 1].get("transition_handoff")
        if handoff is None:
            continue
        destination_phase = str(source_phase + 1)
        destination = phase_entry(source_phase + 1)
        states = routine[destination_phase]
        if entry_state not in states:
            raise ValueError(
                f"transition handoff template state is missing: "
                f"{destination_phase}/{entry_state}"
            )
        leaf = states[entry_state]
        timer_states = transition_handoff_states(handoff)
        for timer_index, (name, duration) in enumerate(timer_states):
            if name in states:
                raise ValueError(
                    f"transition handoff state already exists: "
                    f"{destination_phase}/{name}"
                )
            next_state = (
                timer_states[timer_index + 1][0]
                if timer_index + 1 < len(timer_states)
                else destination
            )
            row = cells(copy.deepcopy(leaf))
            while len(row) <= 52:
                row.append("")
            row[0] = name
            for edge_index in NATIVE_STATE_REFERENCE_COLUMNS:
                row[edge_index] = next_state
            if row[41] not in {"", "(None)"}:
                row[41] = next_state
            row[46] = "2"
            row[47] = str(duration)
            states[name] = join(row, leaf)

    # GeneralBossSubroutineChangeKind.Withstand (kind=1) clamps HP at the
    # divider and keeps the Boss invincible until the configured destination
    # state exits.  Validate the destination after all states have been
    # generated so a typo cannot create a permanently invincible Boss.
    for source_phase in (1, 2):
        end_state = phases[source_phase - 1].get(
            "transition_invincible_end_state"
        )
        if not end_state:
            continue
        if int(phases[source_phase - 1].get("phase_kind", 0)) != 1:
            raise ValueError(
                "transition_invincible_end_state requires phase_kind=1"
            )
        destination_phase = str(source_phase + 1)
        if end_state not in routine[destination_phase]:
            raise ValueError(
                "Withstand end state is missing from destination phase: "
                f"{destination_phase}/{end_state}"
            )

    boss_states[ids["routine"]] = routine
    if source_boss in boss_levels:
        boss_levels[ids["boss"]] = copy.deepcopy(boss_levels[source_boss])

    cloned_zone = {}
    swapped = 0
    for wave, leaf in zones[source_zone].items():
        if isinstance(leaf, dict):
            raise ValueError("Boss trial source zone is unexpectedly nested")
        row = cells(leaf)
        before = list(row)
        placement = template.get("placement")
        if placement:
            for kind_index, boss_index in ((23, 24), (25, 26), (27, 28), (31, 32)):
                if (
                    len(row) > boss_index
                    and row[kind_index] == placement["source_kind"]
                    and row[boss_index] == placement["source_boss"]
                ):
                    row[kind_index] = placement["target_kind"]
                    row[boss_index] = ids["boss"]
                    swapped += 1
        else:
            rogue.apply_boss_swap(row, source_boss, ids["boss"])
            swapped += sum(1 for old, new in zip(before, row) if old == source_boss and new == ids["boss"])
        cloned_zone[wave] = join(row, leaf)
    if swapped == 0:
        raise ValueError("Boss trial template did not replace a Boss slot")
    zones[ids["zone"]] = cloned_zone

    cloned_field = list(source_field_row)
    cloned_field[2] = ids["zone"]
    field_data[ids["field"]] = join(cloned_field, field_data[source_field])
    quest_round[field_index] = ids["field"]
    quest_table[event_key][round_key] = join(
        quest_round, quest_table[event_key][round_key]
    )
    return {
        "event_id": int(event_key),
        "round": int(round_key),
        "source_boss": source_boss,
        **ids,
        "actions": action_logicals(template),
    }


def apply_native_phase_template(
    *,
    rush_quests: dict,
    advent_quests: dict | None = None,
    field_data: dict,
    zones: dict,
    bosses: dict,
    boss_states: dict,
    boss_levels: dict,
    template: dict[str, Any],
) -> dict[str, Any]:
    """Overlay one-shot trials while preserving a Boss's native phase graph.

    Unlike :func:`apply_template`, this adapter does not manufacture three
    phases from one portable source phase and does not replace any native HP
    divider.  Each configured trial selects an existing native phase and its
    official entry state.  The active native loop receives the descriptor;
    its descriptor-free clone becomes the only destination after success.
    Any additional native phases are retained untouched.

    This is intended for complex official multiplayer bosses whose later
    phases own model-specific actions that must not be flattened into a
    generic three-phase shell.
    """
    validate_template(template)
    if template.get("preserve_native_phases") is not True:
        raise ValueError("native-phase Boss trial template must opt in explicitly")

    target = template["target"]
    if "rush_event_id" in target:
        event_key = str(int(target["rush_event_id"]))
        round_key = str(int(target["round"]))
        quest_table = rush_quests
        field_index = 98
        target_label = "Rush round"
    else:
        event_key = str(int(target["advent_event_id"]))
        round_key = str(int(target["quest_no"]))
        if advent_quests is None:
            raise ValueError("native-phase Advent target requires advent_quests")
        quest_table = advent_quests
        field_index = 115
        target_label = "Advent quest"
    if event_key not in quest_table or round_key not in quest_table[event_key]:
        raise KeyError(
            f"native-phase Boss trial target {target_label} is missing: "
            f"{event_key}/{round_key}"
        )

    quest_round = cells(quest_table[event_key][round_key])
    source_field = quest_round[field_index]
    source_field_row = cells(field_data[source_field])
    source_zone = source_field_row[2]
    if not isinstance(zones.get(source_zone), dict):
        raise ValueError("native-phase Boss trial source field has no cloneable zone")

    source_boss = template["source_boss"]
    if source_boss not in bosses or source_boss not in boss_states:
        raise KeyError(f"native-phase Boss trial source Boss is missing: {source_boss}")
    source_routine = boss_states[source_boss]
    if not isinstance(source_routine, dict):
        raise ValueError("native-phase Boss trial source routine is malformed")

    ids = template["ids"]
    guard_action = template["actions"]["guard"]
    post_trial_suffix = template.get("post_trial_suffix", "__mod_after_trial")
    no_jump_completion = template.get("native_no_jump_completion") is True

    def clone_boss_node(node):
        if isinstance(node, dict):
            return {key: clone_boss_node(value) for key, value in node.items()}
        row = cells(node)
        while len(row) <= 109:
            row.append("")
        # Preserve the official entry state, phase dividers and all dedicated
        # action slots.  Only isolate the routine and add the linked guard.
        row[42] = ids["routine"]
        row[109] = guard_action
        return join(row, node)

    bosses[ids["boss"]] = clone_boss_node(bosses[source_boss])
    # Opt into the client's official Withstand transition for native bosses.
    # Kind=1 clamps HP at the divider.  When a transition_handoff is present,
    # enter a chain of short native-timeline timer rows and clear Withstand
    # only after the final timer exits.  This is the same proven contract used
    # by the portable three-phase template, while row[0] remains the official
    # destination sequence so complex native Bosses keep valid timelines.
    transition_specs = {
        int(phase["native_phase"]): phase
        for phase in template["phases"]
        if phase.get("transition_invincible_end_state")
    }
    native_transition_entries: dict[int, str] = {}
    if transition_specs:
        for variant, leaf in list(bosses[ids["boss"]].items()):
            row = cells(leaf)
            while len(row) <= 65:
                row.append("")
            for native_phase, phase_config in transition_specs.items():
                end_state = str(phase_config["transition_invincible_end_state"])
                if native_phase not in (1, 2, 3):
                    raise ValueError(
                        "native Withstand transition must originate from phase 1-3"
                    )
                destination_phase = str(native_phase + 1)
                offset = 45 + (native_phase - 1) * 7
                if row[offset] in ("", "(None)"):
                    raise ValueError(
                        f"native phase divider {native_phase + 1} is missing"
                    )
                native_entry = row[offset]
                previous_entry = native_transition_entries.setdefault(
                    native_phase, native_entry
                )
                if previous_entry != native_entry:
                    raise ValueError(
                        f"native phase {destination_phase} entry diverges by variant: "
                        f"{previous_entry} != {native_entry}"
                    )
                handoff = phase_config.get("transition_handoff")
                if handoff is not None:
                    row[offset] = str(handoff["name"])
                elif end_state not in source_routine.get(destination_phase, {}):
                    raise ValueError(
                        f"native Withstand end state is missing: "
                        f"phase {destination_phase}/{end_state}"
                    )
                if phase_config.get("hp_threshold") is not None:
                    row[offset + 2] = str(float(phase_config["hp_threshold"]))
                row[offset + 3] = "1"
                row[offset + 4] = end_state
            bosses[ids["boss"]][variant] = join(row, leaf)
    routine = copy.deepcopy(source_routine)

    configured_phases: set[str] = set()
    for phase in template["phases"]:
        phase_key = str(phase["native_phase"])
        entry_state = str(phase["native_entry_state"])
        if phase_key in configured_phases:
            raise ValueError(f"native Boss phase is configured twice: {phase_key}")
        configured_phases.add(phase_key)
        states = routine.get(phase_key)
        if not isinstance(states, dict) or not states:
            raise ValueError(f"native Boss phase is missing: {phase_key}")
        if entry_state not in states:
            raise KeyError(
                f"native Boss phase entry is missing: {phase_key}/{entry_state}"
            )

        trial = copy.deepcopy(phase["trial"])
        pre_trial_names = set(states)
        partition = phase.get("native_state_partition")
        if partition is not None:
            _partition_native_trial_phase(states, trial, partition)
        elif no_jump_completion:
            if trial["success_state"] != "(None)":
                raise ValueError(
                    f"native no-jump phase {phase_key} must not name a success state"
                )
            _attach_native_no_jump_trial(
                states, trial, state_names=pre_trial_names
            )
        else:
            expected_success = f"{entry_state}{post_trial_suffix}"
            if trial["success_state"] != expected_success:
                raise ValueError(
                    f"native phase {phase_key} success state must be "
                    f"{expected_success}"
                )
            post_states, mapping = _build_post_trial_chain(
                states,
                post_trial_suffix,
                preserve_timeline_sequence=True,
            )
            if mapping[entry_state] != expected_success:
                raise ValueError(f"native phase {phase_key} post-trial entry diverged")
            states.update(post_states)
            _attach_trial(states, trial, state_names=pre_trial_names)
            _audit_one_shot_phase(
                states,
                trial=trial,
                expected_trial_states=pre_trial_names,
                post_trial_suffix=post_trial_suffix,
            )

    # Route every native phase exit through the same deterministic timer chain
    # named by the GeneralBoss divider.  Synthetic lookup keys retain the
    # official destination row[0] timeline sequence; their trial descriptor is
    # cleared so the next phase guard appears only after invincibility ends.
    for native_phase, phase_config in transition_specs.items():
        handoff = phase_config.get("transition_handoff")
        if handoff is None:
            continue
        destination_phase = str(native_phase + 1)
        destination = native_transition_entries[native_phase]
        states = routine.get(destination_phase)
        if not isinstance(states, dict) or destination not in states:
            raise ValueError(
                f"native transition destination is missing: "
                f"phase {destination_phase}/{destination}"
            )
        leaf = states[destination]
        timer_states = transition_handoff_states(handoff)
        for timer_index, (name, duration) in enumerate(timer_states):
            if name in states:
                raise ValueError(
                    f"native transition handoff state already exists: "
                    f"{destination_phase}/{name}"
                )
            next_state = (
                timer_states[timer_index + 1][0]
                if timer_index + 1 < len(timer_states)
                else destination
            )
            row = cells(copy.deepcopy(leaf))
            while len(row) <= 52:
                row.append("")
            row[22:27] = ["(None)", "", "false", "false", "(None)"]
            for edge_index in NATIVE_STATE_REFERENCE_COLUMNS:
                row[edge_index] = next_state
            if row[41] not in {"", "(None)"}:
                row[41] = next_state
            row[46] = "2"
            row[47] = str(duration)
            states[name] = join(row, leaf)
        _rewrite_next_phase(
            routine[str(native_phase)], timer_states[0][0]
        )
        end_state = str(phase_config["transition_invincible_end_state"])
        if end_state not in states:
            raise ValueError(
                f"native timed Withstand end state is missing: "
                f"phase {destination_phase}/{end_state}"
            )

    boss_states[ids["routine"]] = routine
    if source_boss in boss_levels:
        boss_levels[ids["boss"]] = copy.deepcopy(boss_levels[source_boss])

    cloned_zone = {}
    swapped = 0
    for wave, leaf in zones[source_zone].items():
        if isinstance(leaf, dict):
            raise ValueError("native-phase Boss trial source zone is unexpectedly nested")
        row = cells(leaf)
        before = list(row)
        rogue.apply_boss_swap(row, source_boss, ids["boss"])
        swapped += sum(
            1
            for old, new in zip(before, row)
            if old == source_boss and new == ids["boss"]
        )
        cloned_zone[wave] = join(row, leaf)
    if swapped == 0:
        raise ValueError("native-phase Boss trial did not replace a Boss slot")
    zones[ids["zone"]] = cloned_zone

    cloned_field = list(source_field_row)
    cloned_field[2] = ids["zone"]
    field_data[ids["field"]] = join(cloned_field, field_data[source_field])
    quest_round[field_index] = ids["field"]
    quest_table[event_key][round_key] = join(
        quest_round, quest_table[event_key][round_key]
    )
    return {
        "event_id": int(event_key),
        "round": int(round_key),
        "source_boss": source_boss,
        "native_phases": tuple(sorted(configured_phases, key=int)),
        **ids,
        "actions": action_logicals(template),
    }


def describe_template(template: dict[str, Any]) -> str:
    target = template["target"]
    if "rush_event_id" in target:
        target_text = f"rush:{target['rush_event_id']}/{target['round']}"
    else:
        target_text = f"advent:{target['advent_event_id']}/{target['quest_no']}"
    lines = [
        f"template={template['name']}",
        f"target={target_text}",
        f"source_boss={template['source_boss']}",
    ]
    for index, phase in enumerate(template["phases"], start=1):
        trial = phase.get("trial")
        trial_text = "none" if trial is None else f"{trial['kind']} x{trial['target']}"
        lines.append(
            f"phase{index}: threshold={phase.get('hp_threshold', 'final')} "
            f"trial={trial_text} resistances={','.join(phase.get('resistances', [])) or 'none'}"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--template", required=True)
    parser.add_argument("--check-actions", action="store_true")
    args = parser.parse_args()
    try:
        template = load_template(args.config, args.template)
        if args.check_actions:
            assets = build_action_assets(template)
            print(f"action_assets={len(assets)}")
        print(describe_template(template))
    except Exception as exc:
        print(f"[ERR] {exc}")
        return 1
    print("[OK] Boss trial template is valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
