"""Client SWF & APK Merge Pipeline v4 (`merge_1008093.py` / `merge_client.py`).

Steps (v4):
  0.  base      : Verify base SWF `riven-wt-1008092.swf`
  1.  guard     : Code 43 guard fix (`gerald-guard-20261027/build_swf.py`)
  1b. board2    : Water Gerald ManaBoard 2 Lv120 requirement (`gerald-guard-20261027/board2/build_swf.py`)
  2.  matefx    : Coop mate FX + lightweight mode + 'm' unit + P8 drill-dash in-bounds lock (`coop-hide-mate-fx-20261027/build_swf.py`)
  2b. digits    : Optional digits suffix step (`--digits "<cmd>"` + `--digits-cwd`, marked `pending` when omitted)
  3.  dash      : Optional standalone dash step (`--dash "<cmd>"`, skipped by default since P8 is in matefx)
  4.  contcost  : Optional continue-cost fix (`--contcost "<cmd>"`, skipped by default)
  5.  r2        : Riven round2 (`round2/client/source/r2_apply.py`, parameterized `--catalog-json`, `--catalog-resources`, `--catalog-id`)
  6.  c23       : Riven C23 decompose (`round2/c23/source/c23_apply.py`)
  7.  c24       : Optional Riven C24 (`--c24 "<cmd>"`, skipped by default)
  7b. c25       : Optional Riven C25 workshop batch decompose fix (`--c25`, `round2/c25/source/c25_apply.py`)
  7c. c26       : Optional Riven C26 '持有裂罅' weapon filter + item list themed riven promotion (`--c26`, `round2/c26/source/c26_apply.py`)
  8.  admission : Admission Build ID (`admission_patch.py`, `--build-id`) -> `<out-dir>/merge-wt-<version-code>.swf`
  9.  local_swf : Optional local wf SWF (`--local-wf`, `local/make_local_swf.py`) -> `<out-dir>/merge-local-wf-<version-code>.swf`
  10. apk       : M-glyph bundle patch (`bundle_m_glyph.py`) + `apk_nocache.refresh(..., version_code=<version-code>)` + `--check` verification
                  -> wt x86, wt arm64, and (if `--local-wf`) local wf x86 APKs + `<out-dir>/SHA256SUMS.txt`
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shlex
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

MERGE_ROOT = Path(__file__).resolve().parent
GUARD_ROOT = MERGE_ROOT.parent
WORK_ROOT = GUARD_ROOT.parent

sys.dont_write_bytecode = True
if str(GUARD_ROOT / "vendor") not in sys.path:
    sys.path.insert(0, str(GUARD_ROOT / "vendor"))

import asm  # noqa: E402
import bodies  # noqa: E402
from swfabc import SwfAbc, abcfmt as fmt  # noqa: E402
from admission_patch import NEW_BUILD, OLD_BUILD, unpack as unpack_swf  # noqa: E402

# Fixed input paths and expected digests
BASE_SWF = GUARD_ROOT / "input" / "riven-wt-1008092.swf"
BASE_SWF_SHA256 = "39acc27b8126fc51450dcf5fab53a8c21d8d4b0cebd4a2384ed60617a3eee97d"

GUARD_SCRIPT = GUARD_ROOT / "build_swf.py"
MATEFX_ROOT = WORK_ROOT / "coop-hide-mate-fx-20261027"
MATEFX_SCRIPT = MATEFX_ROOT / "build_swf.py"
BUNDLE_M_GLYPH_SCRIPT = MATEFX_ROOT / "bundle_m_glyph.py"

RIVEN_ROUND2_ROOT = WORK_ROOT / "weapon-riven-20261025" / "round2"
R2_CLIENT_ROOT = RIVEN_ROUND2_ROOT / "client"
R2_SCRIPT = R2_CLIENT_ROOT / "source" / "r2_apply.py"
DEFAULT_CATALOG_JSON = r"..\p2-catalog.json"
DEFAULT_CATALOG_RESOURCES = str(RIVEN_ROUND2_ROOT / "data-edges" / "out-325-on324" / "p2-assets")
DEFAULT_CATALOG_ID = "riven-multi-v1-fcf6de9c6aee669eda6a0560be58b862"

C23_ROOT = RIVEN_ROUND2_ROOT / "c23"
C23_SCRIPT = C23_ROOT / "source" / "c23_apply.py"
C24_ROOT = RIVEN_ROUND2_ROOT / "c24"
C25_ROOT = RIVEN_ROUND2_ROOT / "c25"
C25_SCRIPT = C25_ROOT / "source" / "c25_apply.py"
C26_ROOT = RIVEN_ROUND2_ROOT / "c26"
C26_SCRIPT = C26_ROOT / "source" / "c26_apply.py"

ADMISSION_SCRIPT = MERGE_ROOT / "admission_patch.py"
MAKE_LOCAL_SWF_SCRIPT = MERGE_ROOT / "local" / "make_local_swf.py"

PORT175_ROOT = WORK_ROOT / "weapon-riven-20261025" / "port175"
APK_NOCACHE_DIR = PORT175_ROOT / "packaging" / "nocache"
BASE_APK_DIR = PORT175_ROOT / "client-1008092"
BASE_APK_WT_X86 = BASE_APK_DIR / "riven-wt-1008092-x86.signed.apk"
BASE_APK_WT_ARM64 = BASE_APK_DIR / "riven-wt-1008092-arm64.signed.apk"
BASE_APK_WT_X86_SHA256 = "eec058ca86e704f2b14e552a2838e82dfa269a84eecb6f42fcc8a13cc3e2e412"
BASE_APK_WT_ARM64_SHA256 = "7f0004725cbd03ea85e3205f04cf1fbe153e726f39ab5789641f109f5319a917"

BASE_APK_LOCAL_WF_X86 = Path(r"<WORKDIR>\outputs\apk\continue-cost-20261026\contcost-p13c-local-wf-x86.signed.apk")
BASE_APK_LOCAL_WF_X86_SHA256 = "0ac4a71f55fa8f1cc368b4cbd8f5fca09318bc7b1509fd2d2e89152e786adbca"

DEFAULT_VERSION_CODE = 1008093
VERSION_CODE = DEFAULT_VERSION_CODE
DEFAULT_BUILD_ID = NEW_BUILD
PACKAGE_WT = "com.leiting.wt"
PACKAGE_WF = "com.leiting.wf"

# Strictly forbidden classes across all steps (TASK-MERGE.md)
STRICT_FORBIDDEN_CLASSES = (
    "ActionEvaluator",
    "NormalAttackCalculator",
    "AbilityDamageShot",
    "ActionHitAreaGroup",
)

# Documented intra-round2 shared methods between r2 and c23 (see C23-NOTES.md)
DOCUMENTED_R2_C23_SHARED_METHODS = frozenset(
    {
        "EquipmentListTableItemView/apply",
        "GeneralDialog/buttonClicked",
    }
)

# Documented intra-round2 shared methods between c23 and c25 (see C25-NOTES.md)
DOCUMENTED_C23_C25_SHARED_METHODS = frozenset(
    {
        "EquipmentListScene/buttonClicked",
        "EquipmentListScene/update",
    }
)

# Documented intra-round2 shared methods between c23 and c26 (see C26-NOTES.md)
DOCUMENTED_C23_C26_SHARED_METHODS = frozenset(
    {
        "EquipmentListScene/buttonClicked",
        "EquipmentListScene/filterDialogOkHandler",
    }
)

# Documented intra-round2 shared methods between c25 and c26 (see C26-NOTES.md)
DOCUMENTED_C25_C26_SHARED_METHODS = frozenset(
    {
        "EquipmentListScene/buttonClicked",
    }
)


class MergeError(RuntimeError):
    """Raised when any step or safety verification fails."""


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def ensure_inside_merge(path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(MERGE_ROOT):
        raise MergeError(f"Refusing to write outside merge workspace: {resolved}")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def resolve_catalog_json_path(raw_arg: str) -> Path:
    p = Path(raw_arg)
    if p.is_absolute():
        return p.resolve()
    cand_r2 = (R2_CLIENT_ROOT / p).resolve()
    if cand_r2.exists():
        return cand_r2
    return (MERGE_ROOT / p).resolve()


def resolve_catalog_resources_path(raw_arg: str) -> Path:
    p = Path(raw_arg)
    if p.is_absolute():
        return p.resolve()
    cand_r2 = (R2_CLIENT_ROOT / p).resolve()
    if cand_r2.exists():
        return cand_r2
    return (MERGE_ROOT / p).resolve()


def traits_bytes(traits) -> bytes:
    writer = fmt.W()
    for trait in traits:
        fmt.write_trait(writer, trait)
    return writer.out()


def body_bytes(body) -> bytes:
    """Serialize complete method_body_info (header, code, exception handlers, traits)."""
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


def snapshot_abc_methods(swf_path: Path) -> dict:
    """Load SWF main ABC and return method body digests, labels, and forbidden-class digests."""
    swf = SwfAbc(swf_path)
    abc = swf.abc
    labels = bodies.label_map(abc)
    raw_bodies = [body_bytes(b) for b in abc.bodies]

    forbidden_summary = {}
    for cls in STRICT_FORBIDDEN_CLASSES:
        prefixes = (f"{cls}/", f"{cls}$/")
        h = hashlib.sha256()
        count = 0
        for idx, raw in enumerate(raw_bodies):
            lbl = labels.get(idx, f"anonymous#{idx}")
            if lbl.startswith(prefixes):
                count += 1
                h.update(struct.pack("<II", idx, len(raw)))
                h.update(raw)
        if count == 0:
            raise MergeError(f"Forbidden class {cls} not found in ABC of {swf_path}")
        forbidden_summary[cls] = {
            "method_count": count,
            "records_sha256": h.hexdigest(),
        }

    return {
        "swf": swf,
        "abc": abc,
        "labels": labels,
        "raw_bodies": raw_bodies,
        "forbidden_summary": forbidden_summary,
    }


def diff_step_methods(before_snap: dict, after_snap: dict, baseline_snap: dict) -> dict:
    """Compare main ABC method bodies before and after a step, and verify forbidden classes vs base."""
    before_raw = before_snap["raw_bodies"]
    after_raw = after_snap["raw_bodies"]
    before_labels = before_snap["labels"]
    after_labels = after_snap["labels"]

    if len(after_raw) < len(before_raw):
        raise MergeError(f"Method body count shrank: {len(before_raw)} -> {len(after_raw)}")

    changed_original = []
    for idx in range(len(before_raw)):
        if before_raw[idx] != after_raw[idx]:
            lbl = after_labels.get(idx) or before_labels.get(idx) or f"anonymous#{idx}"
            changed_original.append(lbl)

    added_methods = []
    for idx in range(len(before_raw), len(after_raw)):
        lbl = after_labels.get(idx, f"anonymous#{idx}")
        added_methods.append(lbl)

    # Verify forbidden classes against Step 0 baseline
    base_forbidden = baseline_snap["forbidden_summary"]
    after_forbidden = after_snap["forbidden_summary"]
    forbidden_checks = {}
    for cls in STRICT_FORBIDDEN_CLASSES:
        for lbl in changed_original + added_methods:
            if lbl.startswith((f"{cls}/", f"{cls}$/")):
                raise MergeError(f"Forbidden class method modified: {lbl}")
        if after_forbidden[cls] != base_forbidden[cls]:
            raise MergeError(
                f"Forbidden class {cls} digest mismatch vs base SWF: "
                f"{after_forbidden[cls]} != {base_forbidden[cls]}"
            )
        forbidden_checks[cls] = {
            "method_count": after_forbidden[cls]["method_count"],
            "records_sha256": after_forbidden[cls]["records_sha256"],
            "byte_identical_to_base_1008092": True,
        }

    return {
        "changed_methods": sorted(changed_original),
        "changed_method_count": len(changed_original),
        "new_methods": sorted(added_methods),
        "new_method_count": len(added_methods),
        "all_touched_methods": sorted(set(changed_original) | set(added_methods)),
        "forbidden_classes_check": forbidden_checks,
    }


def check_disjointness_so_far(completed_steps: list[dict], snapshots_by_key: dict[str, dict]) -> dict:
    """Verify pairwise disjointness of modified method sets across all executed SWF steps."""
    pairwise_matrix = []
    cross_thread_groups: dict[str, set[str]] = {}
    riven_keys = {"r2", "c23", "c24", "c25", "c26"}

    for i, step_a in enumerate(completed_steps):
        set_a = set(step_a["all_touched_methods"])
        key_a = step_a["key"]
        group_a = "riven-round2" if key_a in riven_keys else f"step{step_a['step']}-{key_a}"
        cross_thread_groups.setdefault(group_a, set()).update(set_a)

        for step_b in completed_steps[i + 1 :]:
            set_b = set(step_b["all_touched_methods"])
            key_b = step_b["key"]
            overlap = sorted(set_a & set_b)
            pair_key = f"step{step_a['step']}({key_a}) vs step{step_b['step']}({key_b})"

            if key_a == "r2" and key_b == "c23":
                # Documented intra-round2 sequential steps (r2 -> c23)
                unexpected = sorted(set(overlap) - DOCUMENTED_R2_C23_SHARED_METHODS)
                if unexpected:
                    raise MergeError(
                        f"Unexpected method overlap between r2 and c23: {unexpected}"
                    )
                c23_report_path = MERGE_ROOT / "audit" / "c23.json"
                r2_report_path = MERGE_ROOT / "audit" / "r2.json"
                c23_rep = json.loads(c23_report_path.read_text("utf-8"))
                r2_rep = json.loads(r2_report_path.read_text("utf-8"))
                snap0 = snapshots_by_key["base"]
                snap_r2 = snapshots_by_key["r2"]
                snap_c23 = snapshots_by_key["c23"]
                unsplice_proofs = {}
                for lbl in overlap:
                    b_idx = c23_rep["insertion_recovery"][lbl]["body"]
                    c23_ins = c23_rep["insertion_recovery"][lbl]["insertions"]
                    code_after_c23 = snap_c23["abc"].bodies[b_idx][5]
                    code_after_r2 = snap_r2["abc"].bodies[b_idx][5]
                    code_base = snap0["abc"].bodies[b_idx][5]
                    unspliced_to_r2 = asm.unsplice_many(code_after_c23, c23_ins)
                    if unspliced_to_r2 != code_after_r2:
                        raise MergeError(f"c23 unsplice failed to recover r2 body for {lbl}")
                    r2_ins = [
                        (row["at"], row["instructions"], row["incoming"])
                        for row in r2_rep["inserts"]
                        if row["method"] == lbl
                    ]
                    unsplice_proofs[lbl] = {
                        "body_index": b_idx,
                        "step0_code_sha256": sha256_bytes(code_base),
                        "r2_code_sha256": sha256_bytes(code_after_r2),
                        "c23_code_sha256": sha256_bytes(code_after_c23),
                        "c23_insertions": c23_ins,
                        "r2_insert_sites": r2_ins,
                        "unsplicing_c23_recovers_r2_byte_exact": True,
                    }
                pairwise_matrix.append(
                    {
                        "pair": pair_key,
                        "same_feature_chain": True,
                        "shared_methods": overlap,
                        "unexpected_overlap": [],
                        "instruction_anchors_disjoint": True,
                        "unsplice_chain_verified": unsplice_proofs,
                    }
                )
            elif key_a == "c23" and key_b == "c25":
                # Documented intra-round2 sequential steps (c23 -> c25, see C25-NOTES.md)
                unexpected = sorted(set(overlap) - DOCUMENTED_C23_C25_SHARED_METHODS)
                if unexpected:
                    raise MergeError(
                        f"Unexpected method overlap between c23 and c25: {unexpected}"
                    )
                c25_report_path = MERGE_ROOT / "audit" / "c25.json"
                c23_report_path = MERGE_ROOT / "audit" / "c23.json"
                c25_rep = json.loads(c25_report_path.read_text("utf-8"))
                c23_rep = json.loads(c23_report_path.read_text("utf-8"))
                snap0 = snapshots_by_key["base"]
                snap_c23 = snapshots_by_key["c23"]
                snap_c25 = snapshots_by_key["c25"]
                unsplice_proofs = {}
                for lbl in overlap:
                    b_idx = c25_rep["insertion_recovery"][lbl]["body"]
                    c25_ins = c25_rep["insertion_recovery"][lbl]["insertions"]
                    c23_ins = c23_rep["insertion_recovery"][lbl]["insertions"]
                    code_after_c25 = snap_c25["abc"].bodies[b_idx][5]
                    code_after_c23 = snap_c23["abc"].bodies[b_idx][5]
                    code_base = snap0["abc"].bodies[b_idx][5]
                    unspliced_to_c23 = asm.unsplice_many(code_after_c25, c25_ins)
                    if unspliced_to_c23 != code_after_c23:
                        raise MergeError(f"c25 unsplice failed to recover c23 body for {lbl}")
                    unspliced_to_base = asm.unsplice_many(unspliced_to_c23, c23_ins)
                    if unspliced_to_base != code_base:
                        raise MergeError(f"c23 unsplice after c25 failed to recover base body for {lbl}")
                    unsplice_proofs[lbl] = {
                        "body_index": b_idx,
                        "step0_code_sha256": sha256_bytes(code_base),
                        "c23_code_sha256": sha256_bytes(code_after_c23),
                        "c25_code_sha256": sha256_bytes(code_after_c25),
                        "c25_insertions": c25_ins,
                        "c23_insertions": c23_ins,
                        "unsplicing_c25_recovers_c23_byte_exact": True,
                        "unsplicing_c23_recovers_base_byte_exact": True,
                    }
                pairwise_matrix.append(
                    {
                        "pair": pair_key,
                        "same_feature_chain": True,
                        "shared_methods": overlap,
                        "unexpected_overlap": [],
                        "instruction_anchors_disjoint": True,
                        "unsplice_chain_verified": unsplice_proofs,
                    }
                )
            elif key_a == "c23" and key_b == "c26":
                # Documented intra-round2 sequential steps (c23 -> [c25] -> c26, see C26-NOTES.md)
                unexpected = sorted(set(overlap) - DOCUMENTED_C23_C26_SHARED_METHODS)
                if unexpected:
                    raise MergeError(
                        f"Unexpected method overlap between c23 and c26: {unexpected}"
                    )
                c26_report_path = MERGE_ROOT / "audit" / "c26.json"
                c23_report_path = MERGE_ROOT / "audit" / "c23.json"
                c26_rep = json.loads(c26_report_path.read_text("utf-8"))
                c23_rep = json.loads(c23_report_path.read_text("utf-8"))
                c25_rep = (
                    json.loads((MERGE_ROOT / "audit" / "c25.json").read_text("utf-8"))
                    if "c25" in snapshots_by_key
                    else {}
                )
                snap0 = snapshots_by_key["base"]
                snap_c23 = snapshots_by_key["c23"]
                snap_c25 = snapshots_by_key.get("c25")
                snap_c26 = snapshots_by_key["c26"]
                unsplice_proofs = {}
                for lbl in overlap:
                    b_idx = c26_rep["insertion_recovery"][lbl]["body"]
                    c26_ins = c26_rep["insertion_recovery"][lbl]["insertions"]
                    c23_ins = c23_rep["insertion_recovery"][lbl]["insertions"]
                    code_after_c26 = snap_c26["abc"].bodies[b_idx][5]
                    code_after_c23 = snap_c23["abc"].bodies[b_idx][5]
                    code_base = snap0["abc"].bodies[b_idx][5]
                    unspliced_from_c26 = asm.unsplice_many(code_after_c26, c26_ins)
                    if snap_c25 is not None and lbl in c25_rep.get("insertion_recovery", {}):
                        code_after_c25 = snap_c25["abc"].bodies[b_idx][5]
                        if unspliced_from_c26 != code_after_c25:
                            raise MergeError(f"c26 unsplice failed to recover c25 body for {lbl}")
                        c25_ins = c25_rep["insertion_recovery"][lbl]["insertions"]
                        unspliced_to_c23 = asm.unsplice_many(unspliced_from_c26, c25_ins)
                    else:
                        c25_ins = []
                        unspliced_to_c23 = unspliced_from_c26
                    if unspliced_to_c23 != code_after_c23:
                        raise MergeError(f"c26/c25 unsplice failed to recover c23 body for {lbl}")
                    unspliced_to_base = asm.unsplice_many(unspliced_to_c23, c23_ins)
                    if unspliced_to_base != code_base:
                        raise MergeError(f"c23 unsplice after c26 failed to recover base body for {lbl}")
                    unsplice_proofs[lbl] = {
                        "body_index": b_idx,
                        "step0_code_sha256": sha256_bytes(code_base),
                        "c23_code_sha256": sha256_bytes(code_after_c23),
                        "c26_code_sha256": sha256_bytes(code_after_c26),
                        "c26_insertions": c26_ins,
                        "c25_insertions": c25_ins,
                        "c23_insertions": c23_ins,
                        "unsplicing_to_c23_byte_exact": True,
                        "unsplicing_c23_recovers_base_byte_exact": True,
                    }
                pairwise_matrix.append(
                    {
                        "pair": pair_key,
                        "same_feature_chain": True,
                        "shared_methods": overlap,
                        "unexpected_overlap": [],
                        "instruction_anchors_disjoint": True,
                        "unsplice_chain_verified": unsplice_proofs,
                    }
                )
            elif key_a == "c25" and key_b == "c26":
                # Documented intra-round2 sequential steps (c25 -> c26, see C26-NOTES.md)
                unexpected = sorted(set(overlap) - DOCUMENTED_C25_C26_SHARED_METHODS)
                if unexpected:
                    raise MergeError(
                        f"Unexpected method overlap between c25 and c26: {unexpected}"
                    )
                c26_report_path = MERGE_ROOT / "audit" / "c26.json"
                c25_report_path = MERGE_ROOT / "audit" / "c25.json"
                c23_report_path = MERGE_ROOT / "audit" / "c23.json"
                c26_rep = json.loads(c26_report_path.read_text("utf-8"))
                c25_rep = json.loads(c25_report_path.read_text("utf-8"))
                c23_rep = json.loads(c23_report_path.read_text("utf-8"))
                snap0 = snapshots_by_key["base"]
                snap_c23 = snapshots_by_key["c23"]
                snap_c25 = snapshots_by_key["c25"]
                snap_c26 = snapshots_by_key["c26"]
                unsplice_proofs = {}
                for lbl in overlap:
                    b_idx = c26_rep["insertion_recovery"][lbl]["body"]
                    c26_ins = c26_rep["insertion_recovery"][lbl]["insertions"]
                    c25_ins = c25_rep["insertion_recovery"][lbl]["insertions"]
                    c23_ins = c23_rep["insertion_recovery"][lbl]["insertions"]
                    code_after_c26 = snap_c26["abc"].bodies[b_idx][5]
                    code_after_c25 = snap_c25["abc"].bodies[b_idx][5]
                    code_after_c23 = snap_c23["abc"].bodies[b_idx][5]
                    code_base = snap0["abc"].bodies[b_idx][5]
                    unspliced_to_c25 = asm.unsplice_many(code_after_c26, c26_ins)
                    if unspliced_to_c25 != code_after_c25:
                        raise MergeError(f"c26 unsplice failed to recover c25 body for {lbl}")
                    unspliced_to_c23 = asm.unsplice_many(unspliced_to_c25, c25_ins)
                    if unspliced_to_c23 != code_after_c23:
                        raise MergeError(f"c25 unsplice after c26 failed to recover c23 body for {lbl}")
                    unspliced_to_base = asm.unsplice_many(unspliced_to_c23, c23_ins)
                    if unspliced_to_base != code_base:
                        raise MergeError(f"c23 unsplice after c26/c25 failed to recover base body for {lbl}")
                    unsplice_proofs[lbl] = {
                        "body_index": b_idx,
                        "step0_code_sha256": sha256_bytes(code_base),
                        "c23_code_sha256": sha256_bytes(code_after_c23),
                        "c25_code_sha256": sha256_bytes(code_after_c25),
                        "c26_code_sha256": sha256_bytes(code_after_c26),
                        "c26_insertions": c26_ins,
                        "c25_insertions": c25_ins,
                        "c23_insertions": c23_ins,
                        "unsplicing_c26_recovers_c25_byte_exact": True,
                        "unsplicing_c25_recovers_c23_byte_exact": True,
                        "unsplicing_c23_recovers_base_byte_exact": True,
                    }
                pairwise_matrix.append(
                    {
                        "pair": pair_key,
                        "same_feature_chain": True,
                        "shared_methods": overlap,
                        "unexpected_overlap": [],
                        "instruction_anchors_disjoint": True,
                        "unsplice_chain_verified": unsplice_proofs,
                    }
                )
            elif key_a in riven_keys and key_b in riven_keys:
                # Intra-round2 chain (e.g. r2 vs c25/c26 or r2/c23 vs c24)
                if key_a == "r2" and key_b in ("c25", "c26") and overlap:
                    raise MergeError(f"Unexpected method overlap between r2 and {key_b}: {overlap}")
                pairwise_matrix.append(
                    {
                        "pair": pair_key,
                        "same_feature_chain": True,
                        "shared_methods": overlap,
                        "unexpected_overlap": [],
                        "disjoint": len(overlap) == 0,
                    }
                )
            else:
                if overlap:
                    raise MergeError(f"Disjointness check FAILED for {pair_key}: overlapping methods {overlap}")
                pairwise_matrix.append(
                    {
                        "pair": pair_key,
                        "same_feature_chain": False,
                        "overlap": [],
                        "disjoint": True,
                    }
                )

    # Verify cross-thread groups are 100% pairwise disjoint
    group_names = list(cross_thread_groups.keys())
    cross_thread_checks = []
    for i, ga in enumerate(group_names):
        for gb in group_names[i + 1 :]:
            inter = sorted(cross_thread_groups[ga] & cross_thread_groups[gb])
            if inter:
                raise MergeError(f"Cross-thread method overlap between {ga} and {gb}: {inter}")
            cross_thread_checks.append({"group_a": ga, "group_b": gb, "overlap": [], "disjoint": True})

    return {
        "pass": True,
        "cross_thread_pairwise_disjoint": True,
        "cross_thread_checks": cross_thread_checks,
        "step_pairwise_checks": pairwise_matrix,
    }


def format_custom_command(template: str, in_swf: Path, out_swf: Path, report_path: Path) -> list[str]:
    """Expand a user-supplied command template for --dash, --contcost, --c24, --c25, or --c26."""
    expanded = template
    used_placeholder = False
    for k, v in (
        ("{input}", str(in_swf)),
        ("{output}", str(out_swf)),
        ("{in}", str(in_swf)),
        ("{out}", str(out_swf)),
        ("{report}", str(report_path)),
        ("<in>", str(in_swf)),
        ("<out>", str(out_swf)),
        ("<X>", str(in_swf)),
        ("<Y>", str(out_swf)),
    ):
        if k in expanded:
            expanded = expanded.replace(k, v)
            used_placeholder = True

    tokens = shlex.split(expanded, posix=False)
    cleaned = [t[1:-1] if len(t) >= 2 and t[0] == t[-1] and t[0] in ('"', "'") else t for t in tokens]

    if not used_placeholder:
        replaced_xy = False
        for idx, tok in enumerate(cleaned):
            if tok == "X":
                cleaned[idx] = str(in_swf)
                replaced_xy = True
            elif tok == "Y":
                cleaned[idx] = str(out_swf)
                replaced_xy = True
        if not replaced_xy:
            # Inspect script if possible to choose --in/--out vs --input/--output
            in_flag, out_flag = "--input", "--output"
            has_report_flag = False
            for tok in cleaned:
                if tok.lower().endswith(".py") and Path(tok).exists():
                    src_txt = Path(tok).read_text(encoding="utf-8", errors="ignore")
                    if "'--in'" in src_txt or '"--in"' in src_txt:
                        in_flag, out_flag = "--in", "--out"
                    if "'--report'" in src_txt or '"--report"' in src_txt:
                        has_report_flag = True
                    break
            cleaned.extend([in_flag, str(in_swf), out_flag, str(out_swf)])
            if has_report_flag and "--report" not in cleaned:
                cleaned.extend(["--report", str(report_path)])

    # Ensure any relative --report target stays strictly inside MERGE_ROOT
    for idx, tok in enumerate(cleaned[:-1]):
        if tok == "--report":
            rp = Path(cleaned[idx + 1])
            if not rp.is_absolute():
                cleaned[idx + 1] = str(ensure_inside_merge(MERGE_ROOT / rp))

    if cleaned and cleaned[0].lower() in ("python", "python.exe"):
        if "-B" not in cleaned:
            cleaned[1:1] = ["-B", "-X", "utf8"]
    elif cleaned and cleaned[0].lower().endswith(".py"):
        cleaned = [sys.executable, "-B", "-X", "utf8"] + cleaned

    return cleaned


def run_step_command(
    cmd: list[str],
    cwd: Path,
    extra_env: dict[str, str] | None = None,
) -> tuple[int, str, str]:
    env = os.environ.copy()
    shims_dir = str(MERGE_ROOT / "_shims")
    existing_pp = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{shims_dir}{os.pathsep}{existing_pp}" if existing_pp else shims_dir
    env["MERGE_WORKSPACE_ROOT"] = str(MERGE_ROOT)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    if extra_env:
        env.update(extra_env)

    proc = subprocess.run(
        [str(c) for c in cmd],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def verify_catalog_in_swf(swf_path: Path, expected_catalog: str) -> dict:
    """Verify that the expected catalog ID string is present in both unpacked SWF bytes and ABC strings."""
    raw = swf_path.read_bytes()
    unpacked = unpack_swf(raw)
    target_bytes = expected_catalog.encode("utf-8")
    in_unpacked = target_bytes in unpacked

    swf = SwfAbc(swf_path)
    abc = swf.abc
    string_indices = [i for i, s in enumerate(abc.strings) if s == target_bytes]
    if not in_unpacked or len(string_indices) != 1:
        raise MergeError(
            f"Catalog ID {expected_catalog!r} verification failed in {swf_path}: "
            f"in_unpacked={in_unpacked}, string_indices={string_indices}"
        )
    sid = string_indices[0]

    labels = bodies.label_map(abc)
    refs = []
    for b_idx, body in enumerate(abc.bodies):
        for ins_idx, ins in enumerate(asm.decode(body[5])):
            if ins.name == "pushstring" and ins.args == [sid]:
                refs.append({"method": labels.get(b_idx, f"anonymous#{b_idx}"), "pc": ins_idx})

    if len(refs) != 8:
        raise MergeError(f"Expected 8 pushstring references to {expected_catalog!r}, found {len(refs)}: {refs}")

    return {
        "expected_catalog_id": expected_catalog,
        "present_in_unpacked_swf": True,
        "abc_string_index": sid,
        "pushstring_reference_count": len(refs),
        "pushstring_methods": sorted({r["method"] for r in refs}),
        "pushstring_references": refs,
    }


def is_sigfile(name: str) -> bool:
    u = name.upper()
    return u.startswith("META-INF/") and (
        u.endswith((".RSA", ".DSA", ".EC", ".SF")) or u == "META-INF/MANIFEST.MF"
    )


def prepare_m_glyph_base_apk(base_apk: Path, tmp_dir: Path, tag: str) -> tuple[Path, dict]:
    """Run bundle_m_glyph.py on base_apk and build an unsigned temp APK with replaced bundle.zip + bundle.zip.sha1."""
    bundle_out_dir = ensure_inside_merge(tmp_dir / f"bundle-{tag}" / ".keep").parent
    cmd = [
        sys.executable,
        "-B",
        "-X",
        "utf8",
        str(BUNDLE_M_GLYPH_SCRIPT),
        "--apk-in",
        str(base_apk),
        "--out-dir",
        str(bundle_out_dir),
    ]
    rc, out_txt, err_txt = run_step_command(cmd, cwd=MERGE_ROOT)
    if rc != 0:
        raise MergeError(f"bundle_m_glyph.py failed on {base_apk.name} (rc={rc}): {err_txt or out_txt}")

    bundle_zip_path = bundle_out_dir / "bundle.zip"
    bundle_sha1_path = bundle_out_dir / "bundle.zip.sha1"
    if not bundle_zip_path.exists() or not bundle_sha1_path.exists():
        raise MergeError(f"bundle_m_glyph.py did not produce bundle.zip + bundle.zip.sha1 in {bundle_out_dir}")

    new_bundle = bundle_zip_path.read_bytes()
    new_bundle_sha1 = bundle_sha1_path.read_bytes()

    tmp_base_apk = ensure_inside_merge(tmp_dir / f"tmp-base-m-{tag}.apk")
    with zipfile.ZipFile(base_apk, "r") as zi, zipfile.ZipFile(tmp_base_apk, "w") as zo:
        for info in zi.infolist():
            if is_sigfile(info.filename):
                continue
            if info.filename == "assets/bundle.zip":
                data = new_bundle
            elif info.filename == "assets/bundle.zip.sha1":
                data = new_bundle_sha1
            else:
                data = zi.read(info.filename)
            zo.writestr(info, data)

    # Verify all non-signature entries other than assets/bundle.zip(.sha1) preserve bytes & compress_type
    with zipfile.ZipFile(base_apk, "r") as za, zipfile.ZipFile(tmp_base_apk, "r") as zb:
        for info_a in za.infolist():
            if is_sigfile(info_a.filename):
                continue
            info_b = zb.getinfo(info_a.filename)
            if info_b.compress_type != info_a.compress_type:
                raise MergeError(
                    f"compress_type changed for {info_a.filename}: {info_a.compress_type} -> {info_b.compress_type}"
                )
            if info_a.filename not in ("assets/bundle.zip", "assets/bundle.zip.sha1"):
                if za.read(info_a.filename) != zb.read(info_a.filename):
                    raise MergeError(f"Unexpected byte change in {info_a.filename} while patching bundle.zip")

    return tmp_base_apk, {
        "command": " ".join(shlex.quote(str(x)) for x in cmd),
        "stdout": out_txt,
        "bundle_zip_sha256": sha256_bytes(new_bundle),
        "bundle_zip_sha1": new_bundle_sha1.decode("utf-8").strip(),
        "bundle_zip_bytes": len(new_bundle),
    }


def check_m_glyph_in_apk(apk_path: Path) -> tuple[bool, str]:
    """Run `bundle_m_glyph.py --apk-in <out> --check` and verify it outputs True."""
    cmd = [
        sys.executable,
        "-B",
        "-X",
        "utf8",
        str(BUNDLE_M_GLYPH_SCRIPT),
        "--apk-in",
        str(apk_path),
        "--check",
    ]
    rc, out_txt, err_txt = run_step_command(cmd, cwd=MERGE_ROOT)
    ok = (rc == 0) and ("bundle has M glyph: True" in out_txt)
    if not ok:
        raise MergeError(
            f"bundle_m_glyph.py --check failed for {apk_path.name} (rc={rc}): stdout={out_txt!r}, stderr={err_txt!r}"
        )
    return True, out_txt


def package_apks(
    wt_swf: Path,
    out_dir: Path,
    rehearsal: bool,
    local_wf_swf: Path | None = None,
    version_code: int = DEFAULT_VERSION_CODE,
) -> dict:
    """Step 10: Apply M-glyph bundle patch + apk_nocache.refresh + --check verification for all target APKs."""
    if str(APK_NOCACHE_DIR) not in sys.path:
        sys.path.insert(0, str(APK_NOCACHE_DIR))
    import apk_nocache  # noqa: E402

    tmp_root = ensure_inside_merge(MERGE_ROOT / "tmp" / ".keep").parent
    apk_nocache.HERE = tmp_root
    ensure_inside_merge(out_dir / ".keep")

    wt_swf_bytes = wt_swf.read_bytes()
    wt_swf_sha = sha256_bytes(wt_swf_bytes)

    sums_lines = [f"{wt_swf_sha}  {wt_swf.name}"]
    if local_wf_swf is not None:
        local_swf_bytes = local_wf_swf.read_bytes()
        local_swf_sha = sha256_bytes(local_swf_bytes)
        sums_lines.append(f"{local_swf_sha}  {local_wf_swf.name}")
    else:
        local_swf_bytes = None
        local_swf_sha = None

    # Target APKs: (tag, arch, variant, expected_pkg, base_apk, expected_base_sha, swf_bytes, swf_sha, out_apk)
    targets = [
        (
            "wt-x86",
            "x86",
            "wt",
            PACKAGE_WT,
            BASE_APK_WT_X86,
            BASE_APK_WT_X86_SHA256,
            wt_swf_bytes,
            wt_swf_sha,
            out_dir / f"merge-wt-{version_code}-x86.signed.apk",
        ),
    ]
    if not rehearsal:
        targets.append(
            (
                "wt-arm64",
                "arm64",
                "wt",
                PACKAGE_WT,
                BASE_APK_WT_ARM64,
                BASE_APK_WT_ARM64_SHA256,
                wt_swf_bytes,
                wt_swf_sha,
                out_dir / f"merge-wt-{version_code}-arm64.signed.apk",
            )
        )
    if local_wf_swf is not None and local_swf_bytes is not None and local_swf_sha is not None:
        targets.append(
            (
                "local-wf-x86",
                "x86",
                "local-wf",
                PACKAGE_WF,
                BASE_APK_LOCAL_WF_X86,
                BASE_APK_LOCAL_WF_X86_SHA256,
                local_swf_bytes,
                local_swf_sha,
                out_dir / f"merge-local-wf-{version_code}-x86.signed.apk",
            )
        )

    apk_results = []
    try:
        for (
            tag,
            arch,
            variant,
            expected_pkg,
            base_apk,
            expected_base_sha,
            swf_bytes,
            swf_sha,
            out_apk,
        ) in targets:
            if not base_apk.exists():
                raise MergeError(f"Base APK missing: {base_apk}")
            actual_base_sha = sha256_file(base_apk)
            if actual_base_sha != expected_base_sha:
                raise MergeError(
                    f"Base APK {base_apk.name} SHA256 mismatch: {actual_base_sha} != {expected_base_sha}"
                )

            # 1. M-glyph bundle patch into unsigned temporary zip
            tmp_base_apk, bundle_info = prepare_m_glyph_base_apk(base_apk, tmp_root, tag)

            # 2. apk_nocache.refresh using tmp_base_apk as base
            info = apk_nocache.refresh(
                tmp_base_apk,
                out_apk,
                version_code=version_code,
                swf_bytes=swf_bytes,
            )

            # 3. Verify badging, changed entries, embedded SWF, and bundle_m_glyph.py --check
            badging = info["badging"]
            if f"name='{expected_pkg}'" not in badging:
                raise MergeError(f"Unexpected package name in badging for {out_apk.name}: {badging}")
            if f"versionCode='{version_code}'" not in badging:
                raise MergeError(f"Unexpected versionCode in badging for {out_apk.name}: {badging}")

            expected_changed_vs_tmp = [
                "AndroidManifest.xml",
                "assets/worldflipper_android_release.swf",
                "classes.dex",
            ]
            if sorted(info["changed"]) != expected_changed_vs_tmp:
                raise MergeError(f"Unexpected changed files vs temp base in {out_apk.name}: {info['changed']}")

            with zipfile.ZipFile(base_apk, "r") as za, zipfile.ZipFile(out_apk, "r") as zb:
                names_a = {i.filename for i in za.infolist() if not is_sigfile(i.filename)}
                names_b = {i.filename for i in zb.infolist() if not is_sigfile(i.filename)}
                if names_a != names_b:
                    raise MergeError(f"APK member list changed in {out_apk.name}")
                changed_vs_orig = sorted(n for n in names_a if za.read(n) != zb.read(n))
                embedded_swf_sha = sha256_bytes(zb.read("assets/worldflipper_android_release.swf"))

            expected_changed_vs_orig = [
                "AndroidManifest.xml",
                "assets/bundle.zip",
                "assets/bundle.zip.sha1",
                "assets/worldflipper_android_release.swf",
                "classes.dex",
            ]
            if changed_vs_orig != expected_changed_vs_orig:
                raise MergeError(
                    f"Unexpected changed files vs original base APK in {out_apk.name}: {changed_vs_orig}"
                )
            if embedded_swf_sha != swf_sha:
                raise MergeError(
                    f"Embedded SWF SHA256 mismatch in {out_apk.name}: {embedded_swf_sha} != {swf_sha}"
                )

            check_ok, check_stdout = check_m_glyph_in_apk(out_apk)

            info["tag"] = tag
            info["variant"] = variant
            info["arch"] = arch
            info["original_base"] = str(base_apk)
            info["base_sha256"] = actual_base_sha
            info["output_path"] = str(out_apk)
            info["embedded_swf_sha256"] = embedded_swf_sha
            info["package_name_verified"] = expected_pkg
            info["version_code_verified"] = version_code
            info["changed_vs_m_glyph_temp_base"] = info["changed"]
            info["changed_vs_original_base_apk"] = changed_vs_orig
            info["bundle_m_glyph"] = {
                **bundle_info,
                "check_passed": check_ok,
                "check_stdout": check_stdout,
            }
            apk_results.append(info)
            sums_lines.append(f"{info['sha256']}  {out_apk.name}")
    finally:
        if tmp_root.exists():
            shutil.rmtree(tmp_root, ignore_errors=True)

    sums_path = ensure_inside_merge(out_dir / "SHA256SUMS.txt")
    sums_path.write_text("\n".join(sums_lines) + "\n", encoding="utf-8")

    return {
        "status": "passed",
        "rehearsal": rehearsal,
        "version_code": version_code,
        "out_dir": str(out_dir),
        "sha256sums_file": str(sums_path),
        "apks": apk_results,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rehearsal",
        action="store_true",
        help="Run rehearsal mode (defaults out-dir to out/rehearsal/ and skips arm64 unless overridden)",
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Output directory inside merge workspace (default: out/rehearsal if --rehearsal else out)",
    )
    parser.add_argument(
        "--version-code",
        type=int,
        default=DEFAULT_VERSION_CODE,
        help=f"Target APK versionCode and filename version tag (default: {DEFAULT_VERSION_CODE})",
    )
    parser.add_argument(
        "--build-id",
        default=DEFAULT_BUILD_ID,
        help=f"Admission build ID, must match byte length of {OLD_BUILD!r} (39 bytes; default: {DEFAULT_BUILD_ID})",
    )
    parser.add_argument(
        "--local-wf",
        action="store_true",
        help="Also build local wf SWF (merge-local-wf-<version-code>.swf) and x86 APK (merge-local-wf-<version-code>-x86.signed.apk)",
    )
    parser.add_argument(
        "--catalog-json",
        default=DEFAULT_CATALOG_JSON,
        help=f"Path to p2-catalog.json (default: {DEFAULT_CATALOG_JSON} relative to round2/client)",
    )
    parser.add_argument(
        "--catalog-resources",
        default=DEFAULT_CATALOG_RESOURCES,
        help=f"Path to p2-assets directory (default: {DEFAULT_CATALOG_RESOURCES})",
    )
    parser.add_argument(
        "--catalog-id",
        default=DEFAULT_CATALOG_ID,
        help=f"Expected catalog_id to verify against p2-catalog.json and output SWFs (default: {DEFAULT_CATALOG_ID})",
    )
    parser.add_argument("--digits", help="Optional command template for digits suffix step after matefx (supports {in}/{out})")
    parser.add_argument("--digits-cwd", help="Working directory for --digits command")
    parser.add_argument("--dash", help="Optional command template for Step 3 (dash landing clamp)")
    parser.add_argument("--dash-cwd", help="Working directory for Step 3 command")
    parser.add_argument("--contcost", help="Optional command template for Step 4 (continue cost fix)")
    parser.add_argument("--contcost-cwd", help="Working directory for Step 4 command")
    parser.add_argument("--c24", help="Optional command template for Step 7 (Riven C24)")
    parser.add_argument("--c24-cwd", help="Working directory for Step 7 (Riven C24) command")
    parser.add_argument(
        "--c25",
        nargs="?",
        const=True,
        default=False,
        help="Run Riven C25 step after C23 (round2/c25/source/c25_apply.py); optionally accepts a custom command template",
    )
    parser.add_argument("--c25-cwd", help="Working directory for Step 7b (Riven C25) command (default: round2/c25)")
    parser.add_argument(
        "--c26",
        nargs="?",
        const=True,
        default=False,
        help="Run Riven C26 step after C25 (round2/c26/source/c26_apply.py); optionally accepts a custom command template",
    )
    parser.add_argument("--c26-cwd", help="Working directory for Step 7c (Riven C26) command (default: round2/c26)")
    parser.add_argument("--config", help="Optional JSON config file specifying digits/dash/contcost/c24/c25/c26 commands")
    parser.add_argument(
        "--skip-apk",
        action="store_true",
        help="Skip APK packaging step",
    )
    args = parser.parse_args(argv)

    cfg = {}
    if args.config:
        cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))

    def resolve_cmd_and_cwd(cli_cmd, cli_cwd, cfg_key, default_cwd: Path) -> tuple[str | bool | None, Path]:
        entry = cfg.get(cfg_key)
        if isinstance(entry, dict):
            cmd_tpl = cli_cmd if cli_cmd not in (None, False) else entry.get("cmd")
            cwd_val = cli_cwd or entry.get("cwd") or default_cwd
        else:
            cmd_tpl = cli_cmd if cli_cmd not in (None, False) else entry
            cwd_val = cli_cwd or default_cwd
        return cmd_tpl, Path(cwd_val).resolve()

    digits_cmd_tpl, digits_cwd = resolve_cmd_and_cwd(args.digits, args.digits_cwd, "digits", MERGE_ROOT)
    dash_cmd_tpl, dash_cwd = resolve_cmd_and_cwd(args.dash, args.dash_cwd, "dash", MERGE_ROOT)
    contcost_cmd_tpl, contcost_cwd = resolve_cmd_and_cwd(args.contcost, args.contcost_cwd, "contcost", MERGE_ROOT)
    default_c24_cwd = C24_ROOT if C24_ROOT.exists() else MERGE_ROOT
    c24_cmd_tpl, c24_cwd = resolve_cmd_and_cwd(args.c24, args.c24_cwd, "c24", default_c24_cwd)
    default_c25_cwd = C25_ROOT if C25_ROOT.exists() else MERGE_ROOT
    c25_cmd_tpl, c25_cwd = resolve_cmd_and_cwd(args.c25, args.c25_cwd, "c25", default_c25_cwd)
    default_c26_cwd = C26_ROOT if C26_ROOT.exists() else MERGE_ROOT
    c26_cmd_tpl, c26_cwd = resolve_cmd_and_cwd(args.c26, args.c26_cwd, "c26", default_c26_cwd)

    version_code = int(args.version_code)
    build_id = str(args.build_id)

    catalog_json_path = resolve_catalog_json_path(args.catalog_json)
    catalog_resources_path = resolve_catalog_resources_path(args.catalog_resources)
    expected_catalog_id = args.catalog_id

    stages_dir = MERGE_ROOT / "stages"
    audit_dir = MERGE_ROOT / "audit"
    if args.out_dir:
        raw_out = Path(args.out_dir)
        out_dir = raw_out.resolve() if raw_out.is_absolute() else (MERGE_ROOT / raw_out).resolve()
    else:
        out_dir = MERGE_ROOT / "out" / "rehearsal" if args.rehearsal else MERGE_ROOT / "out"

    for d in (stages_dir, audit_dir, out_dir):
        ensure_inside_merge(d / ".keep")

    report_path = ensure_inside_merge(audit_dir / "merge-report.json")
    merge_report: dict = {
        "merge_target": str(version_code),
        "version_code": version_code,
        "build_id": build_id,
        "version": 4,
        "mode": "rehearsal" if args.rehearsal else "final",
        "local_wf_enabled": bool(args.local_wf),
        "c25_enabled": bool(c25_cmd_tpl),
        "c26_enabled": bool(c26_cmd_tpl),
        "digits_enabled": bool(digits_cmd_tpl),
        "out_dir": str(out_dir),
        "catalog_parameters": {
            "catalog_json_arg": args.catalog_json,
            "catalog_json_resolved": str(catalog_json_path),
            "catalog_resources_arg": args.catalog_resources,
            "catalog_resources_resolved": str(catalog_resources_path),
            "expected_catalog_id": expected_catalog_id,
        },
        "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "workspace": str(MERGE_ROOT),
        "status": "running",
        "steps": [],
    }

    def save_report():
        report_path.write_text(json.dumps(merge_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    try:
        if len(build_id.encode("utf-8")) != len(OLD_BUILD.encode("utf-8")) or len(build_id) != len(OLD_BUILD):
            raise MergeError(
                f"--build-id length mismatch: {build_id!r} ({len(build_id.encode('utf-8'))} bytes) "
                f"must equal {OLD_BUILD!r} ({len(OLD_BUILD.encode('utf-8'))} bytes)"
            )

        # ------------------------------------------------------------------
        # Step 0: Base SWF verification
        # ------------------------------------------------------------------
        if not BASE_SWF.exists():
            raise MergeError(f"Base SWF does not exist: {BASE_SWF}")
        base_sha = sha256_file(BASE_SWF)
        if base_sha != BASE_SWF_SHA256:
            raise MergeError(f"Base SWF SHA256 mismatch: {base_sha} != {BASE_SWF_SHA256}")

        snap0 = snapshot_abc_methods(BASE_SWF)
        snapshots_by_key: dict[str, dict] = {"base": snap0}
        completed_swf_steps: list[dict] = []

        merge_report["steps"].append(
            {
                "step": 0,
                "key": "base",
                "name": "底包 riven-wt-1008092.swf",
                "status": "verified",
                "output": str(BASE_SWF),
                "output_sha256": base_sha,
                "method_body_count": len(snap0["raw_bodies"]),
                "forbidden_classes_baseline": snap0["forbidden_summary"],
            }
        )
        save_report()
        current_swf = BASE_SWF
        current_snap = snap0

        # ------------------------------------------------------------------
        # Step 1: 格挡码43 (gerald-guard-20261027)
        # ------------------------------------------------------------------
        step1_out = ensure_inside_merge(stages_dir / "step1-guard.swf")
        step1_cmd = [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(GUARD_SCRIPT),
            "--input",
            str(current_swf),
            "--output",
            str(step1_out),
        ]
        rc, out_txt, err_txt = run_step_command(step1_cmd, cwd=GUARD_ROOT)
        step1_record = {
            "step": 1,
            "key": "guard",
            "name": "格挡码43 (gerald-guard-20261027)",
            "command": " ".join(shlex.quote(str(x)) for x in step1_cmd),
            "cwd": str(GUARD_ROOT),
            "exit_code": rc,
            "input": str(current_swf),
            "input_sha256": sha256_file(current_swf),
            "stdout": out_txt,
            "stderr": err_txt,
        }
        if rc != 0 or not step1_out.exists():
            step1_record["status"] = "failed"
            merge_report["steps"].append(step1_record)
            raise MergeError(f"Step 1 (guard) failed with exit_code={rc}: {err_txt or out_txt}")

        step1_record["output"] = str(step1_out)
        step1_record["output_sha256"] = sha256_file(step1_out)
        snap1 = snapshot_abc_methods(step1_out)
        diff1 = diff_step_methods(current_snap, snap1, snap0)
        step1_record.update(diff1)
        step1_record["status"] = "passed"
        snapshots_by_key["guard"] = snap1
        completed_swf_steps.append(step1_record)
        merge_report["steps"].append(step1_record)
        merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
        save_report()
        current_swf = step1_out
        current_snap = snap1

        # ------------------------------------------------------------------
        # Step 1b: 水杰拉德玛纳板2需120级 (gerald-guard-20261027/board2, 作者 10-27 18:33)
        # ------------------------------------------------------------------
        board2_root = GUARD_ROOT / "board2"
        step1b_out = ensure_inside_merge(stages_dir / "step1b-board2.swf")
        step1b_cmd = [sys.executable, "-B", "-X", "utf8", str(board2_root / "build_swf.py"),
                      "--input", str(current_swf), "--output", str(step1b_out)]
        rc, out_txt, err_txt = run_step_command(step1b_cmd, cwd=board2_root)
        step1b_record = {
            "step": "1b",
            "key": "board2",
            "name": "水杰拉德玛纳板2需120级 (board2)",
            "command": " ".join(shlex.quote(str(x)) for x in step1b_cmd),
            "cwd": str(board2_root),
            "exit_code": rc,
            "input": str(current_swf),
            "input_sha256": sha256_file(current_swf),
            "stdout": out_txt,
            "stderr": err_txt,
        }
        if rc != 0 or not step1b_out.exists():
            step1b_record["status"] = "failed"
            merge_report["steps"].append(step1b_record)
            raise MergeError(f"Step 1b (board2) failed with exit_code={rc}: {err_txt or out_txt}")
        step1b_record["output"] = str(step1b_out)
        step1b_record["output_sha256"] = sha256_file(step1b_out)
        snap1b = snapshot_abc_methods(step1b_out)
        step1b_record.update(diff_step_methods(current_snap, snap1b, snap0))
        step1b_record["status"] = "passed"
        snapshots_by_key["board2"] = snap1b
        completed_swf_steps.append(step1b_record)
        merge_report["steps"].append(step1b_record)
        merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
        save_report()
        current_swf = step1b_out
        current_snap = snap1b

        # ------------------------------------------------------------------
        # Step 2: 队友特效 matefx (coop-hide-mate-fx-20261027, 含 P8 冲刺)
        # ------------------------------------------------------------------
        step2_out = ensure_inside_merge(stages_dir / "step2-matefx.swf")
        matefx_redir_dir = ensure_inside_merge(audit_dir / "matefx-build" / ".keep").parent
        step2_cmd = [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(MATEFX_SCRIPT),
            "--input",
            str(current_swf),
            "--output",
            str(step2_out),
        ]
        rc, out_txt, err_txt = run_step_command(
            step2_cmd,
            cwd=MATEFX_ROOT,
            extra_env={"MERGE_MATEFX_BUILD_DIR": str(matefx_redir_dir)},
        )
        step2_record = {
            "step": 2,
            "key": "matefx",
            "name": "队友特效 matefx (含 P8 冲刺锁场内敌人)",
            "command": " ".join(shlex.quote(str(x)) for x in step2_cmd),
            "cwd": str(MATEFX_ROOT),
            "exit_code": rc,
            "input": str(current_swf),
            "input_sha256": sha256_file(current_swf),
            "report_file": str(matefx_redir_dir / "audit-wt-1008092.json"),
            "stdout": out_txt,
            "stderr": err_txt,
        }
        if rc != 0 or not step2_out.exists():
            step2_record["status"] = "failed"
            merge_report["steps"].append(step2_record)
            raise MergeError(f"Step 2 (matefx) failed with exit_code={rc}: {err_txt or out_txt}")

        step2_record["output"] = str(step2_out)
        step2_record["output_sha256"] = sha256_file(step2_out)
        snap2 = snapshot_abc_methods(step2_out)
        diff2 = diff_step_methods(current_snap, snap2, snap0)
        step2_record.update(diff2)
        if set(diff2["changed_methods"]) >= {"BallImpl/wfxFindDashEnemy", "BallImpl/wfxDashV2Landing"}:
            step2_record["note"] = (
                "coop-hide-mate-fx-20261027/matefx/patch.py (v4) already includes P8 "
                "(BallImpl/wfxFindDashEnemy & BallImpl/wfxDashV2Landing drill-dash in-bounds target lock + in-place fallback) "
                "alongside P1-P7 (12 methods total)."
            )
        step2_record["status"] = "passed"
        snapshots_by_key["matefx"] = snap2
        completed_swf_steps.append(step2_record)
        merge_report["steps"].append(step2_record)
        merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
        save_report()
        current_swf = step2_out
        current_snap = snap2

        # ------------------------------------------------------------------
        # Step 2b: 数字后缀步 digits (留位, --digits "<cmd>" + --digits-cwd)
        # ------------------------------------------------------------------
        if digits_cmd_tpl:
            step2b_out = ensure_inside_merge(stages_dir / "step2b-digits.swf")
            step2b_rep = ensure_inside_merge(audit_dir / "digits.json")
            step2b_cmd = format_custom_command(str(digits_cmd_tpl), current_swf, step2b_out, step2b_rep)
            rc, out_txt, err_txt = run_step_command(step2b_cmd, cwd=digits_cwd)
            step2b_record = {
                "step": "2b",
                "key": "digits",
                "name": "数字后缀步 digits",
                "command": " ".join(shlex.quote(str(x)) for x in step2b_cmd),
                "cwd": str(digits_cwd),
                "exit_code": rc,
                "input": str(current_swf),
                "input_sha256": sha256_file(current_swf),
                "report_file": str(step2b_rep) if step2b_rep.exists() else None,
                "stdout": out_txt,
                "stderr": err_txt,
            }
            if rc != 0 or not step2b_out.exists():
                step2b_record["status"] = "failed"
                merge_report["steps"].append(step2b_record)
                raise MergeError(f"Step 2b (digits) failed with exit_code={rc}: {err_txt or out_txt}")
            step2b_record["output"] = str(step2b_out)
            step2b_record["output_sha256"] = sha256_file(step2b_out)
            snap2b = snapshot_abc_methods(step2b_out)
            diff2b = diff_step_methods(current_snap, snap2b, snap0)
            step2b_record.update(diff2b)
            step2b_record["status"] = "passed"
            snapshots_by_key["digits"] = snap2b
            completed_swf_steps.append(step2b_record)
            merge_report["steps"].append(step2b_record)
            merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
            save_report()
            current_swf = step2b_out
            current_snap = snap2b
        else:
            merge_report["steps"].append(
                {
                    "step": "2b",
                    "key": "digits",
                    "name": "数字后缀步 digits (留位 --digits, 未传标 pending)",
                    "status": "pending",
                    "pending": True,
                    "skipped": True,
                    "command": None,
                    "exit_code": None,
                    "input": str(current_swf),
                    "input_sha256": sha256_file(current_swf),
                    "output": str(current_swf),
                    "output_sha256": sha256_file(current_swf),
                    "changed_methods": [],
                    "new_methods": [],
                    "note": "No --digits command supplied; marked pending until pumpkin thread delivers.",
                }
            )
            save_report()

        # ------------------------------------------------------------------
        # Step 3: 冲刺落点钳制 dash (默认跳过, P8 已含在 matefx)
        # ------------------------------------------------------------------
        if dash_cmd_tpl:
            step3_out = ensure_inside_merge(stages_dir / "step3-dash.swf")
            step3_rep = ensure_inside_merge(audit_dir / "dash.json")
            step3_cmd = format_custom_command(dash_cmd_tpl, current_swf, step3_out, step3_rep)
            rc, out_txt, err_txt = run_step_command(step3_cmd, cwd=dash_cwd)
            step3_record = {
                "step": 3,
                "key": "dash",
                "name": "冲刺落点钳制 dash",
                "command": " ".join(shlex.quote(str(x)) for x in step3_cmd),
                "cwd": str(dash_cwd),
                "exit_code": rc,
                "input": str(current_swf),
                "input_sha256": sha256_file(current_swf),
                "stdout": out_txt,
                "stderr": err_txt,
            }
            if rc != 0 or not step3_out.exists():
                step3_record["status"] = "failed"
                merge_report["steps"].append(step3_record)
                raise MergeError(f"Step 3 (dash) failed with exit_code={rc}: {err_txt or out_txt}")
            step3_record["output"] = str(step3_out)
            step3_record["output_sha256"] = sha256_file(step3_out)
            snap3 = snapshot_abc_methods(step3_out)
            diff3 = diff_step_methods(current_snap, snap3, snap0)
            step3_record.update(diff3)
            step3_record["status"] = "passed"
            snapshots_by_key["dash"] = snap3
            completed_swf_steps.append(step3_record)
            merge_report["steps"].append(step3_record)
            merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
            save_report()
            current_swf = step3_out
            current_snap = snap3
        else:
            merge_report["steps"].append(
                {
                    "step": 3,
                    "key": "dash",
                    "name": "冲刺落点钳制 dash (默认跳过, P8 已在 matefx)",
                    "status": "skipped",
                    "skipped": True,
                    "command": None,
                    "exit_code": None,
                    "input": str(current_swf),
                    "input_sha256": sha256_file(current_swf),
                    "output": str(current_swf),
                    "output_sha256": sha256_file(current_swf),
                    "changed_methods": [],
                    "new_methods": [],
                    "note": "Skipped by default (P8 dash in-bounds target lock is already in Step 2 matefx).",
                }
            )
            save_report()

        # ------------------------------------------------------------------
        # Step 4: 续战费用修复 contcost (可选, 默认跳过)
        # ------------------------------------------------------------------
        if contcost_cmd_tpl:
            step4_out = ensure_inside_merge(stages_dir / "step4-contcost.swf")
            step4_rep = ensure_inside_merge(audit_dir / "contcost.json")
            step4_cmd = format_custom_command(contcost_cmd_tpl, current_swf, step4_out, step4_rep)
            rc, out_txt, err_txt = run_step_command(step4_cmd, cwd=contcost_cwd)
            step4_record = {
                "step": 4,
                "key": "contcost",
                "name": "续战费用修复 contcost",
                "command": " ".join(shlex.quote(str(x)) for x in step4_cmd),
                "cwd": str(contcost_cwd),
                "exit_code": rc,
                "input": str(current_swf),
                "input_sha256": sha256_file(current_swf),
                "stdout": out_txt,
                "stderr": err_txt,
            }
            if rc != 0 or not step4_out.exists():
                step4_record["status"] = "failed"
                merge_report["steps"].append(step4_record)
                raise MergeError(f"Step 4 (contcost) failed with exit_code={rc}: {err_txt or out_txt}")
            step4_record["output"] = str(step4_out)
            step4_record["output_sha256"] = sha256_file(step4_out)
            snap4 = snapshot_abc_methods(step4_out)
            diff4 = diff_step_methods(current_snap, snap4, snap0)
            step4_record.update(diff4)
            step4_record["status"] = "passed"
            snapshots_by_key["contcost"] = snap4
            completed_swf_steps.append(step4_record)
            merge_report["steps"].append(step4_record)
            merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
            save_report()
            current_swf = step4_out
            current_snap = snap4
        else:
            merge_report["steps"].append(
                {
                    "step": 4,
                    "key": "contcost",
                    "name": "续战费用修复 contcost (可选, 默认跳过)",
                    "status": "skipped",
                    "skipped": True,
                    "command": None,
                    "exit_code": None,
                    "input": str(current_swf),
                    "input_sha256": sha256_file(current_swf),
                    "output": str(current_swf),
                    "output_sha256": sha256_file(current_swf),
                    "changed_methods": [],
                    "new_methods": [],
                    "note": "No --contcost command supplied; skipped by default.",
                }
            )
            save_report()

        # ------------------------------------------------------------------
        # Step 5: 裂罅 r2 (pre-check p2-catalog.json catalog_id == --catalog-id)
        # ------------------------------------------------------------------
        if not catalog_json_path.exists():
            raise MergeError(f"Catalog JSON file not found: {catalog_json_path}")
        catalog_json_data = json.loads(catalog_json_path.read_text(encoding="utf-8"))
        actual_catalog_id = catalog_json_data.get("catalog_id")
        catalog_precheck = {
            "catalog_json": str(catalog_json_path),
            "catalog_json_sha256": sha256_file(catalog_json_path),
            "catalog_resources": str(catalog_resources_path),
            "expected_catalog_id": expected_catalog_id,
            "actual_catalog_id_in_json": actual_catalog_id,
            "match": actual_catalog_id == expected_catalog_id,
        }
        merge_report["catalog_precheck"] = catalog_precheck
        if actual_catalog_id != expected_catalog_id:
            merge_report["steps"].append(
                {
                    "step": 5,
                    "key": "r2",
                    "name": "裂罅 round2 (r2_apply.py)",
                    "status": "stopped_before_r2_catalog_mismatch",
                    "input": str(current_swf),
                    "input_sha256": sha256_file(current_swf),
                    "catalog_precheck": catalog_precheck,
                    "note": (
                        f"Stopped before r2: p2-catalog.json has catalog_id={actual_catalog_id!r}, "
                        f"which does not match --catalog-id={expected_catalog_id!r}."
                    ),
                }
            )
            merge_report["status"] = "stopped_before_r2_catalog_mismatch"
            save_report()
            raise MergeError(
                f"Catalog ID mismatch in {catalog_json_path}: file has {actual_catalog_id!r}, "
                f"expected --catalog-id {expected_catalog_id!r}. Stopped before r2."
            )

        step5_out = ensure_inside_merge(stages_dir / "step5-r2.swf")
        step5_rep_path = ensure_inside_merge(audit_dir / "r2.json")
        step5_cmd = [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(R2_SCRIPT),
            "--in",
            str(current_swf),
            "--out",
            str(step5_out),
            "--catalog",
            str(args.catalog_json),
            "--resources",
            str(catalog_resources_path),
            "--report",
            str(step5_rep_path),
        ]
        rc, out_txt, err_txt = run_step_command(step5_cmd, cwd=R2_CLIENT_ROOT)
        step5_record = {
            "step": 5,
            "key": "r2",
            "name": "裂罅 round2 (r2_apply.py)",
            "command": " ".join(shlex.quote(str(x)) for x in step5_cmd),
            "cwd": str(R2_CLIENT_ROOT),
            "exit_code": rc,
            "input": str(current_swf),
            "input_sha256": sha256_file(current_swf),
            "catalog_precheck": catalog_precheck,
            "report_file": str(step5_rep_path),
            "stdout": out_txt,
            "stderr": err_txt,
        }
        if rc != 0 or not step5_out.exists():
            step5_record["status"] = "failed"
            merge_report["steps"].append(step5_record)
            raise MergeError(f"Step 5 (r2) failed with exit_code={rc}: {err_txt or out_txt}")

        step5_record["output"] = str(step5_out)
        step5_record["output_sha256"] = sha256_file(step5_out)
        snap5 = snapshot_abc_methods(step5_out)
        diff5 = diff_step_methods(current_snap, snap5, snap0)
        step5_record.update(diff5)
        catalog_check_step5 = verify_catalog_in_swf(step5_out, expected_catalog_id)
        step5_record["catalog_verification"] = catalog_check_step5
        step5_record["status"] = "passed"
        snapshots_by_key["r2"] = snap5
        completed_swf_steps.append(step5_record)
        merge_report["steps"].append(step5_record)
        merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
        save_report()
        current_swf = step5_out
        current_snap = snap5

        # ------------------------------------------------------------------
        # Step 6: 裂罅 C23 (weapon-riven-20261025/round2/c23/source/c23_apply.py)
        # ------------------------------------------------------------------
        step6_out = ensure_inside_merge(stages_dir / "step6-c23.swf")
        step6_rep_path = ensure_inside_merge(audit_dir / "c23.json")
        step6_cmd = [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(C23_SCRIPT),
            "--in",
            str(current_swf),
            "--out",
            str(step6_out),
            "--report",
            str(step6_rep_path),
        ]
        rc, out_txt, err_txt = run_step_command(step6_cmd, cwd=C23_ROOT)
        step6_record = {
            "step": 6,
            "key": "c23",
            "name": "裂罅 C23 分解 (c23_apply.py)",
            "command": " ".join(shlex.quote(str(x)) for x in step6_cmd),
            "cwd": str(C23_ROOT),
            "exit_code": rc,
            "input": str(current_swf),
            "input_sha256": sha256_file(current_swf),
            "report_file": str(step6_rep_path),
            "stdout": out_txt,
            "stderr": err_txt,
        }
        if rc != 0 or not step6_out.exists():
            step6_record["status"] = "failed"
            merge_report["steps"].append(step6_record)
            raise MergeError(f"Step 6 (c23) failed with exit_code={rc}: {err_txt or out_txt}")

        step6_record["output"] = str(step6_out)
        step6_record["output_sha256"] = sha256_file(step6_out)
        snap6 = snapshot_abc_methods(step6_out)
        diff6 = diff_step_methods(current_snap, snap6, snap0)
        step6_record.update(diff6)
        step6_record["status"] = "passed"
        snapshots_by_key["c23"] = snap6
        completed_swf_steps.append(step6_record)
        merge_report["steps"].append(step6_record)
        merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
        save_report()
        current_swf = step6_out
        current_snap = snap6

        # ------------------------------------------------------------------
        # Step 7: 裂罅 C24 (可选 --c24 "<cmd>", 给了才跑, 未给跳过)
        # ------------------------------------------------------------------
        if c24_cmd_tpl:
            step7_out = ensure_inside_merge(stages_dir / "step7-c24.swf")
            step7_rep = ensure_inside_merge(audit_dir / "c24.json")
            step7_cmd = format_custom_command(c24_cmd_tpl, current_swf, step7_out, step7_rep)
            rc, out_txt, err_txt = run_step_command(step7_cmd, cwd=c24_cwd)
            step7_record = {
                "step": 7,
                "key": "c24",
                "name": "裂罅 C24",
                "command": " ".join(shlex.quote(str(x)) for x in step7_cmd),
                "cwd": str(c24_cwd),
                "exit_code": rc,
                "input": str(current_swf),
                "input_sha256": sha256_file(current_swf),
                "report_file": str(step7_rep) if step7_rep.exists() else None,
                "stdout": out_txt,
                "stderr": err_txt,
            }
            if rc != 0 or not step7_out.exists():
                step7_record["status"] = "failed"
                merge_report["steps"].append(step7_record)
                raise MergeError(f"Step 7 (c24) failed with exit_code={rc}: {err_txt or out_txt}")
            step7_record["output"] = str(step7_out)
            step7_record["output_sha256"] = sha256_file(step7_out)
            snap7 = snapshot_abc_methods(step7_out)
            diff7 = diff_step_methods(current_snap, snap7, snap0)
            step7_record.update(diff7)
            step7_record["status"] = "passed"
            snapshots_by_key["c24"] = snap7
            completed_swf_steps.append(step7_record)
            merge_report["steps"].append(step7_record)
            merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
            save_report()
            current_swf = step7_out
            current_snap = snap7
        else:
            merge_report["steps"].append(
                {
                    "step": 7,
                    "key": "c24",
                    "name": "裂罅 C24 (可选 --c24, 默认跳过)",
                    "status": "skipped",
                    "skipped": True,
                    "command": None,
                    "exit_code": None,
                    "input": str(current_swf),
                    "input_sha256": sha256_file(current_swf),
                    "output": str(current_swf),
                    "output_sha256": sha256_file(current_swf),
                    "changed_methods": [],
                    "new_methods": [],
                    "note": "No --c24 command supplied; skipped.",
                }
            )
            save_report()

        # ------------------------------------------------------------------
        # Step 7b: 裂罅 C25 工坊批量分解修复 (可选 --c25, 在 C23 之后、准入之前)
        # ------------------------------------------------------------------
        if c25_cmd_tpl:
            step7b_out = ensure_inside_merge(stages_dir / "step7b-c25.swf")
            step7b_rep = ensure_inside_merge(audit_dir / "c25.json")
            if isinstance(c25_cmd_tpl, str):
                step7b_cmd = format_custom_command(c25_cmd_tpl, current_swf, step7b_out, step7b_rep)
            else:
                step7b_cmd = [
                    sys.executable,
                    "-B",
                    "-X",
                    "utf8",
                    str(C25_SCRIPT),
                    "--in",
                    str(current_swf),
                    "--out",
                    str(step7b_out),
                    "--report",
                    str(step7b_rep),
                ]
            rc, out_txt, err_txt = run_step_command(step7b_cmd, cwd=c25_cwd)
            step7b_record = {
                "step": "7b",
                "key": "c25",
                "name": "裂罅 C25 工坊批量分解修复 (c25_apply.py)",
                "command": " ".join(shlex.quote(str(x)) for x in step7b_cmd),
                "cwd": str(c25_cwd),
                "exit_code": rc,
                "input": str(current_swf),
                "input_sha256": sha256_file(current_swf),
                "report_file": str(step7b_rep) if step7b_rep.exists() else None,
                "stdout": out_txt,
                "stderr": err_txt,
            }
            if rc != 0 or not step7b_out.exists():
                step7b_record["status"] = "failed"
                merge_report["steps"].append(step7b_record)
                raise MergeError(f"Step 7b (c25) failed with exit_code={rc}: {err_txt or out_txt}")
            step7b_record["output"] = str(step7b_out)
            step7b_record["output_sha256"] = sha256_file(step7b_out)
            snap7b = snapshot_abc_methods(step7b_out)
            diff7b = diff_step_methods(current_snap, snap7b, snap0)
            step7b_record.update(diff7b)
            step7b_record["status"] = "passed"
            snapshots_by_key["c25"] = snap7b
            completed_swf_steps.append(step7b_record)
            merge_report["steps"].append(step7b_record)
            merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
            save_report()
            current_swf = step7b_out
            current_snap = snap7b
        else:
            merge_report["steps"].append(
                {
                    "step": "7b",
                    "key": "c25",
                    "name": "裂罅 C25 工坊批量分解修复 (可选 --c25, 默认跳过)",
                    "status": "skipped",
                    "skipped": True,
                    "command": None,
                    "exit_code": None,
                    "input": str(current_swf),
                    "input_sha256": sha256_file(current_swf),
                    "output": str(current_swf),
                    "output_sha256": sha256_file(current_swf),
                    "changed_methods": [],
                    "new_methods": [],
                    "note": "No --c25 flag/command supplied; skipped.",
                }
            )
            save_report()

        # ------------------------------------------------------------------
        # Step 7c: 裂罅 C26 「持有裂罅」筛选 + 裂罅道具置顶 (可选 --c26, 在 C25 之后、准入之前)
        # ------------------------------------------------------------------
        if c26_cmd_tpl:
            step7c_out = ensure_inside_merge(stages_dir / "step7c-c26.swf")
            step7c_tag_rep = ensure_inside_merge(audit_dir / f"apply-c26-{version_code}.json")
            step7c_rep = ensure_inside_merge(audit_dir / "c26.json")
            if isinstance(c26_cmd_tpl, str):
                step7c_cmd = format_custom_command(c26_cmd_tpl, current_swf, step7c_out, step7c_tag_rep)
            else:
                step7c_cmd = [
                    sys.executable,
                    "-B",
                    "-X",
                    "utf8",
                    str(C26_SCRIPT),
                    "--in",
                    str(current_swf),
                    "--out",
                    str(step7c_out),
                    "--report",
                    str(step7c_tag_rep),
                ]
            rc, out_txt, err_txt = run_step_command(step7c_cmd, cwd=c26_cwd)
            # Determine actual report file written by the command and ensure merge/audit/c26.json is populated
            actual_c26_rep: Path | None = None
            for idx, tok in enumerate(step7c_cmd[:-1]):
                if tok == "--report":
                    cand = Path(step7c_cmd[idx + 1])
                    if cand.exists():
                        actual_c26_rep = cand
                    break
            if actual_c26_rep is None and step7c_tag_rep.exists():
                actual_c26_rep = step7c_tag_rep
            if actual_c26_rep is not None and actual_c26_rep.exists():
                if actual_c26_rep.resolve() != step7c_rep.resolve():
                    shutil.copyfile(actual_c26_rep, step7c_rep)
                if actual_c26_rep.resolve() != step7c_tag_rep.resolve():
                    shutil.copyfile(actual_c26_rep, step7c_tag_rep)
                if out_dir.name != str(version_code):
                    step7c_outdir_rep = ensure_inside_merge(audit_dir / f"apply-c26-{out_dir.name}.json")
                    if actual_c26_rep.resolve() != step7c_outdir_rep.resolve():
                        shutil.copyfile(actual_c26_rep, step7c_outdir_rep)
            step7c_record = {
                "step": "7c",
                "key": "c26",
                "name": "裂罅 C26 持有裂罅筛选 + 道具置顶 (c26_apply.py)",
                "command": " ".join(shlex.quote(str(x)) for x in step7c_cmd),
                "cwd": str(c26_cwd),
                "exit_code": rc,
                "input": str(current_swf),
                "input_sha256": sha256_file(current_swf),
                "report_file": str(step7c_rep) if step7c_rep.exists() else None,
                "tagged_report_file": str(step7c_tag_rep) if step7c_tag_rep.exists() else None,
                "stdout": out_txt,
                "stderr": err_txt,
            }
            if rc != 0 or not step7c_out.exists():
                step7c_record["status"] = "failed"
                merge_report["steps"].append(step7c_record)
                raise MergeError(f"Step 7c (c26) failed with exit_code={rc}: {err_txt or out_txt}")
            step7c_record["output"] = str(step7c_out)
            step7c_record["output_sha256"] = sha256_file(step7c_out)
            snap7c = snapshot_abc_methods(step7c_out)
            diff7c = diff_step_methods(current_snap, snap7c, snap0)
            step7c_record.update(diff7c)
            step7c_record["status"] = "passed"
            snapshots_by_key["c26"] = snap7c
            completed_swf_steps.append(step7c_record)
            merge_report["steps"].append(step7c_record)
            merge_report["safety_checks"] = check_disjointness_so_far(completed_swf_steps, snapshots_by_key)
            save_report()
            current_swf = step7c_out
            current_snap = snap7c
        else:
            merge_report["steps"].append(
                {
                    "step": "7c",
                    "key": "c26",
                    "name": "裂罅 C26 持有裂罅筛选 + 道具置顶 (可选 --c26, 默认跳过)",
                    "status": "skipped",
                    "skipped": True,
                    "command": None,
                    "exit_code": None,
                    "input": str(current_swf),
                    "input_sha256": sha256_file(current_swf),
                    "output": str(current_swf),
                    "output_sha256": sha256_file(current_swf),
                    "changed_methods": [],
                    "new_methods": [],
                    "note": "No --c26 flag/command supplied; skipped.",
                }
            )
            save_report()

        # ------------------------------------------------------------------
        # Step 8: 准入 ID (admission_patch.py) -> merge-wt-<version_code>.swf
        # ------------------------------------------------------------------
        wt_swf_out = ensure_inside_merge(out_dir / f"merge-wt-{version_code}.swf")
        admission_rep_path = ensure_inside_merge(audit_dir / "admission.json")
        step8_cmd = [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(ADMISSION_SCRIPT),
            "--in",
            str(current_swf),
            "--out",
            str(wt_swf_out),
            "--build-id",
            build_id,
            "--report",
            str(admission_rep_path),
        ]
        rc, out_txt, err_txt = run_step_command(step8_cmd, cwd=MERGE_ROOT)
        step8_record = {
            "step": 8,
            "key": "admission",
            "name": f"准入 build ID ({OLD_BUILD} -> {build_id})",
            "command": " ".join(shlex.quote(str(x)) for x in step8_cmd),
            "cwd": str(MERGE_ROOT),
            "exit_code": rc,
            "input": str(current_swf),
            "input_sha256": sha256_file(current_swf),
            "report_file": str(admission_rep_path),
            "stdout": out_txt,
            "stderr": err_txt,
        }
        if rc != 0 or not wt_swf_out.exists():
            step8_record["status"] = "failed"
            merge_report["steps"].append(step8_record)
            raise MergeError(f"Step 8 (admission) failed with exit_code={rc}: {err_txt or out_txt}")

        step8_record["output"] = str(wt_swf_out)
        step8_record["output_sha256"] = sha256_file(wt_swf_out)
        snap8 = snapshot_abc_methods(wt_swf_out)
        diff8 = diff_step_methods(current_snap, snap8, snap0)
        if diff8["all_touched_methods"]:
            raise MergeError(f"Step 8 (admission) unexpectedly modified main ABC methods: {diff8['all_touched_methods']}")
        unpacked_wt = unpack_swf(wt_swf_out.read_bytes())
        new_id_count = unpacked_wt.count(build_id.encode("utf-8"))
        old_id_count = unpacked_wt.count(OLD_BUILD.encode("utf-8"))
        if new_id_count != 3 or old_id_count != 0:
            raise MergeError(
                f"Admission build ID occurrence check failed in {wt_swf_out.name}: "
                f"new_id({build_id!r})={new_id_count} (expected 3), old_id({OLD_BUILD!r})={old_id_count} (expected 0)"
            )
        admission_detail = json.loads(admission_rep_path.read_text("utf-8"))
        step8_record["changed_methods"] = []
        step8_record["new_methods"] = []
        step8_record["admission_verification"] = {
            "previous_build": admission_detail["previous_build"],
            "build": admission_detail["build"],
            "unpacked_new_build_id_occurrences": new_id_count,
            "unpacked_old_build_id_occurrences": old_id_count,
            "changed_tags": admission_detail["changed_tags"],
            "literal_occurrences": admission_detail["literal_occurrences"],
            "byte_reverse_substitution_recovers_input_admission_tags": admission_detail[
                "byte_reverse_substitution_recovers_input_admission_tags"
            ],
            "tag_lengths_unchanged": admission_detail["tag_lengths_unchanged"],
            "admission_key_bytes_unchanged": admission_detail["admission_key_bytes_unchanged"],
            "all_other_swf_tags_byte_identical": admission_detail["all_other_swf_tags_byte_identical"],
            "key_material_printed": admission_detail["key_material_printed"],
        }
        final_catalog_check = verify_catalog_in_swf(wt_swf_out, expected_catalog_id)
        step8_record["catalog_verification"] = final_catalog_check
        step8_record["status"] = "passed"
        merge_report["steps"].append(step8_record)
        save_report()
        current_swf = wt_swf_out
        current_snap = snap8

        # ------------------------------------------------------------------
        # Step 9: 本地 wf 版 SWF (--local-wf, local/make_local_swf.py)
        # ------------------------------------------------------------------
        local_wf_swf_out: Path | None = None
        local_wf_swf_sha: str | None = None
        if args.local_wf:
            local_wf_swf_out = ensure_inside_merge(out_dir / f"merge-local-wf-{version_code}.swf")
            local_swf_rep_path = ensure_inside_merge(audit_dir / "local_swf.json")
            step9_cmd = [
                sys.executable,
                "-B",
                "-X",
                "utf8",
                str(MAKE_LOCAL_SWF_SCRIPT),
                "--in",
                str(wt_swf_out),
                "--out",
                str(local_wf_swf_out),
                "--report",
                str(local_swf_rep_path),
            ]
            rc, out_txt, err_txt = run_step_command(step9_cmd, cwd=MERGE_ROOT / "local")
            step9_record = {
                "step": 9,
                "key": "local_swf",
                "name": "本地 wf 版 SWF (local/make_local_swf.py)",
                "command": " ".join(shlex.quote(str(x)) for x in step9_cmd),
                "cwd": str(MERGE_ROOT / "local"),
                "exit_code": rc,
                "input": str(wt_swf_out),
                "input_sha256": step8_record["output_sha256"],
                "report_file": str(local_swf_rep_path),
                "stdout": out_txt,
                "stderr": err_txt,
            }
            if rc != 0 or not local_wf_swf_out.exists():
                step9_record["status"] = "failed"
                merge_report["steps"].append(step9_record)
                raise MergeError(f"Step 9 (local_swf) failed with exit_code={rc}: {err_txt or out_txt}")

            local_wf_swf_sha = sha256_file(local_wf_swf_out)
            step9_record["output"] = str(local_wf_swf_out)
            step9_record["output_sha256"] = local_wf_swf_sha
            snap9 = snapshot_abc_methods(local_wf_swf_out)
            diff9 = diff_step_methods(snap8, snap9, snap0)
            if diff9["all_touched_methods"]:
                raise MergeError(
                    f"Step 9 (local_swf) unexpectedly modified main ABC method bodies: {diff9['all_touched_methods']}"
                )
            unpacked_local = unpack_swf(local_wf_swf_out.read_bytes())
            if b"<SERVER_HOST>:8001" not in unpacked_local or b"<SERVER_HOST>:8001" in unpacked_local:
                raise MergeError(f"Step 9 (local_swf) host check failed in {local_wf_swf_out.name}")
            local_swf_detail = json.loads(local_swf_rep_path.read_text("utf-8"))
            step9_record["changed_methods"] = []
            step9_record["new_methods"] = []
            step9_record["local_swf_verification"] = {
                "id_before": local_swf_detail["id_before"],
                "id_after": local_swf_detail["id_after"],
                "origin_before": local_swf_detail["origin_before"],
                "origin_after": local_swf_detail["origin_after"],
                "changed_string_count": local_swf_detail["changed_string_count"],
                "reverse_patch_recovers_input_abc_byte_exact": local_swf_detail[
                    "reverse_patch_recovers_input_abc_byte_exact"
                ],
                "non_abc_tags_byte_identical": local_swf_detail["non_abc_tags_byte_identical"],
                "local_constants_match_base": local_swf_detail["local_constants_match_base"],
                "key_material_printed": local_swf_detail["key_material_printed"],
            }
            step9_record["catalog_verification"] = verify_catalog_in_swf(local_wf_swf_out, expected_catalog_id)
            step9_record["status"] = "passed"
            merge_report["steps"].append(step9_record)
            save_report()
        else:
            merge_report["steps"].append(
                {
                    "step": 9,
                    "key": "local_swf",
                    "name": "本地 wf 版 SWF (--local-wf 未启用, 跳过)",
                    "status": "skipped",
                    "skipped": True,
                    "input": str(wt_swf_out),
                    "input_sha256": step8_record["output_sha256"],
                }
            )
            save_report()

        # Total cumulative diff from Step 0 to Step 8
        total_diff = diff_step_methods(snap0, snap8, snap0)
        merge_report["cumulative_swf_summary"] = {
            "base_swf": str(BASE_SWF),
            "base_swf_sha256": base_sha,
            "final_wt_swf": str(wt_swf_out),
            "final_wt_swf_sha256": step8_record["output_sha256"],
            "final_local_wf_swf": str(local_wf_swf_out) if local_wf_swf_out else None,
            "final_local_wf_swf_sha256": local_wf_swf_sha,
            "catalog_id": expected_catalog_id,
            "catalog_verified_in_final_swf": True,
            "admission_build_id": build_id,
            "version_code": version_code,
            "total_changed_original_methods": total_diff["changed_method_count"],
            "total_added_methods": total_diff["new_method_count"],
            "changed_original_methods": total_diff["changed_methods"],
            "added_methods": total_diff["new_methods"],
            "forbidden_classes_check": total_diff["forbidden_classes_check"],
        }
        save_report()

        # ------------------------------------------------------------------
        # Step 10: M 字内置包 + APK 打包与校验 (bundle_m_glyph.py + apk_nocache.py)
        # ------------------------------------------------------------------
        if args.skip_apk:
            sums_lines = [f"{step8_record['output_sha256']}  {wt_swf_out.name}"]
            if local_wf_swf_out and local_wf_swf_sha:
                sums_lines.append(f"{local_wf_swf_sha}  {local_wf_swf_out.name}")
            sums_path = ensure_inside_merge(out_dir / "SHA256SUMS.txt")
            sums_path.write_text("\n".join(sums_lines) + "\n", encoding="utf-8")
            merge_report["steps"].append(
                {
                    "step": 10,
                    "key": "apk",
                    "name": "M 字内置包 + APK 打包 (bundle_m_glyph + apk_nocache.refresh)",
                    "status": "skipped",
                    "skipped": True,
                    "input": str(wt_swf_out),
                    "input_sha256": step8_record["output_sha256"],
                    "sha256sums_file": str(sums_path),
                }
            )
        else:
            apk_res = package_apks(
                wt_swf=wt_swf_out,
                out_dir=out_dir,
                rehearsal=args.rehearsal,
                local_wf_swf=local_wf_swf_out,
                version_code=version_code,
            )
            merge_report["steps"].append(
                {
                    "step": 10,
                    "key": "apk",
                    "name": "M 字内置包 + APK 打包 (bundle_m_glyph + apk_nocache.refresh)",
                    "status": "passed",
                    "command": (
                        f"bundle_m_glyph.py -> apk_nocache.refresh(..., version_code={version_code}) "
                        f"-> bundle_m_glyph.py --check"
                    ),
                    "cwd": str(MERGE_ROOT),
                    "exit_code": 0,
                    "input": str(wt_swf_out),
                    "input_sha256": step8_record["output_sha256"],
                    "local_wf_input": str(local_wf_swf_out) if local_wf_swf_out else None,
                    "local_wf_input_sha256": local_wf_swf_sha,
                    "out_dir": apk_res["out_dir"],
                    "sha256sums_file": apk_res["sha256sums_file"],
                    "apks": apk_res["apks"],
                }
            )

        merge_report["status"] = "passed"
        merge_report["completed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        save_report()

        print(
            json.dumps(
                {
                    "status": merge_report["status"],
                    "merge_target": merge_report["merge_target"],
                    "version_code": version_code,
                    "mode": merge_report["mode"],
                    "out_dir": str(out_dir),
                    "final_wt_swf": str(wt_swf_out),
                    "final_wt_swf_sha256": step8_record["output_sha256"],
                    "final_local_wf_swf": str(local_wf_swf_out) if local_wf_swf_out else None,
                    "final_local_wf_swf_sha256": local_wf_swf_sha,
                    "catalog_id": expected_catalog_id,
                    "admission_build_id": build_id,
                    "total_changed_original_methods": total_diff["changed_method_count"],
                    "total_added_methods": total_diff["new_method_count"],
                    "report": str(report_path),
                },
                ensure_ascii=False,
                indent=2,
            ),
            flush=True,
        )
        return 0

    except Exception as exc:
        if merge_report.get("status") == "running":
            merge_report["status"] = "failed"
        merge_report["error"] = f"{type(exc).__name__}: {exc}"
        merge_report["failed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        save_report()
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
