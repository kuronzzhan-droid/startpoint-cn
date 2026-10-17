"""Prepare/verify a fixed-green preloader for the five-boss evil summons.

Writes only an explicit output checkout and scratch directory. Pristine CDN
and the baseline checkout are read-only. No client, server or HTTP execution.
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import re
import sys
import zipfile
import zlib
from functools import lru_cache
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / "fantasy-gauntlet-mod-tools"
sys.path.insert(0, str(TOOLS))
import wf_dsl
import wf_dsl_sig
import wf_mod_tool as core
import wf_quest_lib as q

BASE = "1.4.135"
TARGET = "1.4.136"
PATCH_ID = "five-boss-evil-cannon-preload-1.4.136"
ARCHIVE = "pinball-1.4.135-1.4.136-1-five-boss-evil-cannon-preload.zip"
GB = "master/battle/boss/general_boss.orderedmap"
NATIVE = "battle/action/enemy/action/zako/zako_evil$difficulity10_shot1"
SHIM = "battle/action/enemy/action/mod/five_boss_v2/fb2_preload$evil_fixed_green"
CANNON = "battle/effect/enemy_general/enemy_shot_cannon"
GREEN = CANNON + "/enemy_shot_cannon_green/enemy_shot_cannon_green"
KEYS = ("mod_fb2_035_evil_w02", "mod_fb2_037_evil_w01", "mod_fb2_039_evil_w02")
SCENE39 = ("mod_fb2_039_abyss_lich_w00", "mod_fb2_039_blood_crab_w01", KEYS[2])
PIN_GB = "5ab7a6e9febc174a172aca23e0f03c91a9e9504dcf969ad85a218762500ad07d"
PIN_NATIVE = "c1f9074db33548cf9cb8a571fa790ca027b86a7269da86be62a88dcfe9b86d7c"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_sha(value):
    return sha(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def row(text):
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) != 1:
        raise ValueError("expected one declared CSV row")
    return rows[0]


def csv_text(cells):
    stream = io.StringIO(newline="")
    csv.writer(stream, lineterminator="\n").writerow(cells)
    return stream.getvalue().rstrip("\n")


def raw_rows(data):
    table = core.read_orderedmap_raw_rows_from_bytes(data)
    return dict(zip(table.keys, table.rows))


def pack_rows(rows):
    return core.build_orderedmap_raw_rows(core.OrderedMap(
        "[memory]", list(rows), list(rows.values()), Path("[memory]")))


def walk(node):
    yield node
    if isinstance(node, list):
        for child in node:
            yield from walk(child)
    elif isinstance(node, dict):
        for child in node.values():
            yield from walk(child)


def decode(data):
    return wf_dsl.parse_dsl(zlib.decompress(data, -15))["tree"]


def encode(tree):
    compressor = zlib.compressobj(level=9, wbits=-15)
    plain = wf_dsl.encode_amf3(tree)
    return compressor.compress(plain) + compressor.flush()


def diff_paths(before, after, path=()):
    if type(before) is not type(after):
        return [path]
    if isinstance(before, list):
        if len(before) != len(after):
            return [path]
        return [p for i, (a, b) in enumerate(zip(before, after))
                for p in diff_paths(a, b, path + (i,))]
    if isinstance(before, dict):
        if before.keys() != after.keys():
            return [path]
        return [p for k in before for p in diff_paths(before[k], after[k], path + (k,))]
    return [] if before == after else [path]


def make_shim(native):
    wf_dsl_sig.validate_action_dsl(native)
    shim = copy.deepcopy(native)
    edits = []

    def visit(node, path=()):
        if isinstance(node, list):
            if node[:2] == ["ResolveByElement", CANNON]:
                if node[2] != 255:
                    raise ValueError("native cannon no longer uses current element")
                node[2] = 4
                edits.append(path + (2,))
            elif node and node[0] == "CreateNormalAttack":
                if node[2] != 255:
                    raise ValueError("native normal attack element drift")
                node[2] = 4
                edits.append(path + (2,))
            for i, child in enumerate(node):
                visit(child, path + (i,))
        elif isinstance(node, dict):
            for k, child in node.items():
                visit(child, path + (k,))
    visit(shim)
    if len(edits) != 2 or set(diff_paths(native, shim)) != set(edits):
        raise ValueError("expected exactly two controlled element edits")
    wf_dsl_sig.assert_command_parameter_edits(
        native, shim, {"ShowEffect": {2}, "CreateNormalAttack": {2}})
    payload = encode(shim)
    if decode(payload) != shim:
        raise ValueError("AMF3 round-trip mismatch")
    wf_dsl_sig.validate_action_dsl(decode(payload))
    return payload, [list(p) for p in edits]


def validate_shim(native, payload):
    expected, edits = make_shim(native)
    wf_dsl_sig.validate_action_dsl(decode(payload))
    if payload != expected:
        raise ValueError("shim differs from the two permitted native operand edits")
    return expected, edits


def baseline_manifest_prefix(manifest, allow_target_edge=False):
    prefix = copy.deepcopy(manifest)
    if allow_target_edge and prefix["cdn_version"] == TARGET:
        entry = prefix["patches"][-1]
        if (entry.get("id") != PATCH_ID or entry.get("version") != TARGET
                or entry.get("depends_on") != BASE or entry.get("enabled") is not True):
            raise ValueError("target edge is not the final enabled manifest entry")
        prefix["patches"].pop()
        prefix["cdn_version"] = BASE
    if prefix["cdn_version"] != BASE:
        raise ValueError("baseline manifest tail changed")
    return prefix


class Inputs:
    """Index archive names once, read only requested common payloads."""
    def __init__(self, baseline, *, allow_target_edge=False):
        self.repo = baseline.resolve()
        self.manifest_bytes = (self.repo / "assets/asset-patch/manifest.json").read_bytes()
        current_manifest = json.loads(self.manifest_bytes)
        # Read-only verification after integration can replay the explicit
        # 135 prefix from the same checkout's 136 manifest. Prepare never does.
        self.manifest = baseline_manifest_prefix(current_manifest, allow_target_edge)
        self.index, self.receipts = {}, {}
        cdn = self.repo / ".cdn/cn"
        full = list((cdn / "archive-common-full").glob("*.zip"))
        if not full:
            raise ValueError("baseline common full archives unavailable")
        archives = sorted(full, key=lambda p: int(re.search(r"1\.4\.0-(\d+)", p.name)[1]))
        diffs = []
        for p in (cdn / "archive-common-diff").glob("*.zip"):
            match = re.match(r"pinball-1\.4\.(\d+)-1\.4\.(\d+)-(\d+)-", p.name)
            if match and int(match[2]) <= 54:
                diffs.append((tuple(map(int, match.groups())), p))
        archives.extend(p for _, p in sorted(diffs))
        tail = "1.4.54"
        for patch in sorted((p for p in self.manifest["patches"]
                             if p.get("enabled") and p.get("type") == "patch"),
                            key=lambda p: tuple(map(int, p["version"].split(".")))):
            if patch["depends_on"] != tail:
                raise ValueError("non-contiguous baseline chain")
            tail = patch["version"]
            archives.extend(self.repo / "assets/asset-patch/active" / n
                            for n in patch.get("chain") or [patch["archive"]])
        if tail != BASE:
            raise ValueError("baseline terminal mismatch")
        for p in archives:
            with zipfile.ZipFile(p) as archive:
                for info in archive.infolist():
                    if re.fullmatch(r"production/upload/[0-9a-f]{2}/[0-9a-f]{38}", info.filename):
                        self.index[info.filename] = p

    @lru_cache(None)
    def read(self, logical):
        member = "production/upload/" + q.hashed_rel(logical)
        archive = self.index.get(member)
        if archive is None:
            raise FileNotFoundError(logical)
        with zipfile.ZipFile(archive) as z:
            payload = z.read(member)
        self.receipts[logical] = {"archive": archive.relative_to(self.repo).as_posix(),
                                  "member": member, "bytes": len(payload), "sha256": sha(payload)}
        return payload

    def tree(self, program):
        return decode(self.read(program + ".action.dsl.amf3.deflate"))


def check_free_slot(inputs, table):
    markers = []
    for key in KEYS:
        cells = row(table[key]["100"])
        if cells[0] != "6" or cells[149] != "":
            raise ValueError(f"occupied slot or element drift: {key}")
        timeline = decode(inputs.read(cells[25] + ".timeline.amf3.deflate"))
        if any(p["path"] == "enemy_action39" for p in timeline.get("points", [])):
            raise ValueError("action39 is executable from a marker")
        states = q.parse_node(inputs.read("master/battle/boss/general_boss_state.orderedmap"))[cells[42]]
        if "enemy_action39" in repr(states):
            raise ValueError("action39 referenced by state routine")
        for p in programs(cells):
            if "enemy_action39" in repr(inputs.tree(p)):
                raise ValueError("action39 referenced by a declared action")
        markers.append({"boss": key, "tier": "100", "element": "6", "slot": 39,
                        "column": 149, "marker": cells[25], "routine": cells[42],
                        "marker_action39_present": False})
    return markers


def programs(cells):
    return sorted({p for value in cells for p in value.split(",") if p.startswith("battle/action/")})


def patch_table(before):
    chunks = raw_rows(before)
    for key in KEYS:
        tiers = raw_rows(chunks[key])
        cells = row(zlib.decompress(tiers["100"]).decode("utf-8"))
        if cells[149] != "":
            raise ValueError("action39 must be empty")
        cells[149] = SHIM
        tiers["100"] = zlib.compress(csv_text(cells).encode("utf-8"), 9)
        chunks[key] = pack_rows(tiers)
    return pack_rows(chunks)


def validate_table(before, after):
    old, new = raw_rows(before), raw_rows(after)
    if list(old) != list(new):
        raise ValueError("general_boss outer key drift")
    for key in old:
        if key not in KEYS:
            if old[key] != new[key]:
                raise ValueError(f"unrelated compressed row changed: {key}")
            continue
        a, b = raw_rows(old[key]), raw_rows(new[key])
        if list(a) != list(b):
            raise ValueError("tier key drift")
        for tier in a:
            if tier != "100":
                if a[tier] != b[tier]:
                    raise ValueError("unrelated tier changed")
                continue
            x = row(zlib.decompress(a[tier]).decode("utf-8"))
            y = row(zlib.decompress(b[tier]).decode("utf-8"))
            if x[149] != "" or y[149] != SHIM:
                raise ValueError("preloader slot mismatch")
            y[149] = x[149]
            if x != y:
                raise ValueError("unauthorized CSV operand changed")
    return {"outer_keys_preserved": len(old), "target_rows": len(KEYS),
            "unrelated_compressed_chunks_preserved": len(old) - len(KEYS),
            "only_changed_column": 149, "deep_king_rows_byte_preserved": 7}


def collector_elements(inputs, table, root, shim=None):
    """Native collector semantics: child actions keep the parent element.

    This models only the Boss/summon DSL collection; it is not AIR execution.
    """
    queue = [("actor", "Boss", root, int(row(table[root]["100"])[0]))]
    seen, elements = set(), set()
    watch = q.parse_node(inputs.read("master/battle/boss/general_enemy_watch.orderedmap"))
    tables = {"Boss": table}
    logicals = {"Funnel": "master/battle/boss/funnel/general_funnel.orderedmap",
                "Zako": "master/battle/zako/general_zako.orderedmap"}
    while queue:
        typ, kind, value, element = queue.pop()
        if (typ, kind, value, element) in seen:
            continue
        seen.add((typ, kind, value, element))
        if len(seen) > 5000:
            raise ValueError("collector closure limit exceeded")
        if typ == "actor":
            if kind not in tables:
                tables[kind] = q.parse_node(inputs.read(logicals[kind]))
            node = tables[kind][value]
            tier = next(k for k in node if int(k) >= 80)
            cells = row(node[tier])
            paths = programs(cells)
            if kind in ("Boss", "Funnel"):
                routine = cells[42 if kind == "Boss" else 37]
                watches = watch.get("1" if kind == "Boss" else "2", {}).get(value, {}).get(routine, {})
                for item in walk(watches):
                    if isinstance(item, str):
                        values = row(item)
                        if len(values) > 18 and values[14] == "5":
                            paths.extend(values[18].split(","))
            queue.extend(("dsl", kind, p, element) for p in paths)
            continue
        tree = decode(shim) if value == SHIM and shim is not None else inputs.tree(value)
        for n in walk(tree):
            if isinstance(n, str) and n.startswith("battle/action/"):
                queue.append(("dsl", kind, n, element))
            if not isinstance(n, list) or not n:
                continue
            if n[:2] == ["ResolveByElement", CANNON]:
                elements.add(element if n[2] == 255 else n[2])
            if n[0] == "SpecifyEffectDirectly" and n[1] == GREEN:
                elements.add(4)
            if n[0] == "SpawnFunnel":
                child, code = n[1]
                if child not in ("Funnel", "Zako"):
                    raise ValueError("unsupported spawned actor: " + child)
                queue.append(("actor", child, code, element))
    return sorted(elements)


def verify_payloads(inputs, payloads):
    before = inputs.read(GB)
    native_bytes = inputs.read(NATIVE + ".action.dsl.amf3.deflate")
    if sha(before) != PIN_GB or sha(native_bytes) != PIN_NATIVE:
        raise ValueError("effective baseline payload drift")
    if set(payloads) != {GB, SHIM + ".action.dsl.amf3.deflate"}:
        raise ValueError("unexpected archive payloads")
    expected_shim, edits = validate_shim(decode(native_bytes), payloads[SHIM + ".action.dsl.amf3.deflate"])
    preservation = validate_table(before, payloads[GB])
    table_before, table_after = q.parse_node(before), q.parse_node(payloads[GB])
    rows = check_free_slot(inputs, table_before)
    before39 = sorted({e for key in SCENE39 for e in collector_elements(inputs, table_before, key)})
    if 4 in before39:
        raise ValueError("former scene39 missing-green counterexample no longer holds")
    after39 = sorted({e for key in SCENE39 for e in collector_elements(inputs, table_after, key, expected_shim)})
    if 4 not in after39:
        raise ValueError("scene39 still does not collect green")
    per_boss = {}
    for key in KEYS:
        elements = collector_elements(inputs, table_after, key, expected_shim)
        if 4 not in elements:
            raise ValueError("target evil Boss still relies on another Boss for green")
        per_boss[key] = elements
    return {"scope": "offline Boss/summon collector dependency validation",
            "former_scene39_elements": before39, "patched_scene39_elements": after39,
            "target_boss_elements": per_boss, "controlled_element_edit_paths": edits,
            "dead_slot_checks": rows, "preservation": preservation,
            "native_action_sha256_preserved": sha(native_bytes),
            "dsl_signature_valid": True, "amf3_round_trip_valid": True,
            "device_or_loading_state_tested": False}


def zip_bytes(payloads):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for logical, data in sorted(payloads.items()):
            info = zipfile.ZipInfo("production/upload/" + q.hashed_rel(logical), (2026, 10, 13, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return output.getvalue()


def read_archive(path):
    expected = {"production/upload/" + q.hashed_rel(p): p
                for p in (GB, SHIM + ".action.dsl.amf3.deflate")}
    with zipfile.ZipFile(path) as z:
        if set(z.namelist()) != set(expected) or len(z.namelist()) != 2:
            raise ValueError("ZIP member whitelist mismatch")
        if z.testzip() is not None:
            raise ValueError("ZIP CRC failure")
        return {logical: z.read(member) for member, logical in expected.items()}


def validate_manifest(before, after, integrity):
    if after["cdn_version"] != TARGET or after["patches"][:-1] != before["patches"]:
        raise ValueError("manifest history or tail drift")
    extra = set(after) ^ set(before)
    if extra or any(after[k] != before[k] for k in before if k not in ("cdn_version", "patches")):
        raise ValueError("unrelated manifest metadata changed")
    entry = after["patches"][-1]
    if entry["id"] != PATCH_ID or entry["depends_on"] != BASE or entry["version"] != TARGET or entry["enabled"] is not True:
        raise ValueError("new manifest edge mismatch")
    if entry["chain"] != [ARCHIVE] or entry["archive_integrity"] != [integrity] or entry["files"] != integrity["files"]:
        raise ValueError("manifest archive inventory mismatch")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "verify"))
    parser.add_argument("--baseline-repo", type=Path, required=True)
    parser.add_argument("--output-repo", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    args = parser.parse_args()
    baseline, output, work = (p.resolve() for p in (args.baseline_repo, args.output_repo, args.work))
    if work.is_relative_to(baseline) or work.is_relative_to(output):
        raise ValueError("scratch directory must be outside the input/output checkout")
    if args.mode == "prepare" and (baseline == output or output.is_relative_to(baseline)):
        raise ValueError("prepare requires a separate read-only baseline and output checkout")
    inputs = Inputs(baseline, allow_target_edge=args.mode == "verify")
    manifest_path = output / "assets/asset-patch/manifest.json"
    archive_path = output / "assets/asset-patch/active" / ARCHIVE
    audit = output / "assets/asset-patch/audit" / PATCH_ID
    if any(not p.resolve().is_relative_to(output) for p in (manifest_path, archive_path, audit)):
        raise ValueError("output asset path resolves outside the output checkout")
    if args.mode == "prepare":
        output_manifest_before = manifest_path.read_bytes()
        if json.loads(output_manifest_before) != inputs.manifest:
            raise ValueError("output manifest diverged from baseline before preparation")
        if archive_path.exists() or audit.exists():
            raise ValueError("new edge output already exists")
        native = decode(inputs.read(NATIVE + ".action.dsl.amf3.deflate"))
        shim, _ = make_shim(native)
        payloads = {GB: patch_table(inputs.read(GB)), SHIM + ".action.dsl.amf3.deflate": shim}
        verification = verify_payloads(inputs, payloads)
        packed = zip_bytes(payloads)
        work.mkdir(parents=True, exist_ok=True)
        candidate = work / ARCHIVE
        candidate.write_bytes(packed)
        if read_archive(candidate) != payloads:
            raise ValueError("candidate ZIP readback mismatch")
        members = sorted("production/upload/" + q.hashed_rel(p) for p in payloads)
        integrity = {"name": ARCHIVE, "size": len(packed), "sha256": sha(packed), "members": 2, "files": members}
        manifest = copy.deepcopy(inputs.manifest)
        manifest["cdn_version"] = TARGET
        manifest["patches"].append({"id": PATCH_ID, "type": "patch",
            "name": "五重决战邪恶小怪绿色炮弹预载修复",
            "description": "为三条邪恶Boss补入固定风属性的小怪炮击预载声明，避免按父Boss暗属性仅采集黑色炮弹。",
            "version": TARGET, "depends_on": BASE, "enabled": True,
            "archive": ARCHIVE, "archive_size": len(packed), "chain": [ARCHIVE],
            "archive_integrity": [integrity], "files": members, "created_at": "2026-10-13",
            "audit": {"directory": "assets/asset-patch/audit/" + PATCH_ID, "report": "report.json"}})
        validate_manifest(inputs.manifest, manifest, integrity)
        if manifest_path.read_bytes() != output_manifest_before:
            raise ValueError("output manifest changed during preparation")
        archive_path.write_bytes(packed)
        manifest_after = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        manifest_path.write_bytes(manifest_after)
        audit.mkdir(parents=True)
        report = {"status": "prepared_offline", "base_version": BASE, "target_version": TARGET,
                  "baseline_manifest_sha256": sha(inputs.manifest_bytes), "archive": integrity,
                  "baseline_manifest_json_sha256": json_sha(inputs.manifest),
                  "output_manifest_before_sha256": sha(output_manifest_before),
                  "output_manifest_after_sha256": sha(manifest_after),
                  "baseline_manifest_json_equal": True,
                  "shim": SHIM, "native_donor": NATIVE, "changed_boss_rows": list(KEYS),
                  "scope": "three tier100 action39 declarations; shared native action and all other chunks preserved",
                  "resources": {p: {"sha256": sha(data), "bytes": len(data)} for p, data in payloads.items()}}
        (audit / "report.json").write_bytes((json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        (audit / "verification.json").write_bytes((json.dumps(verification, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    else:
        packed = archive_path.read_bytes()
        integrity = {"name": ARCHIVE, "size": len(packed), "sha256": sha(packed), "members": 2,
                     "files": sorted("production/upload/" + q.hashed_rel(p) for p in (GB, SHIM + ".action.dsl.amf3.deflate"))}
        validate_manifest(inputs.manifest, json.loads(manifest_path.read_bytes()), integrity)
        report = json.loads((audit / "report.json").read_bytes())
        if report["baseline_manifest_json_sha256"] != json_sha(inputs.manifest):
            raise ValueError("baseline manifest JSON drift")
        if report["archive"] != integrity or report["output_manifest_after_sha256"] != sha(manifest_path.read_bytes()):
            raise ValueError("recorded archive or manifest identity differs")
        verification = verify_payloads(inputs, read_archive(archive_path))
        recorded = json.loads((audit / "verification.json").read_bytes())
        if recorded != verification:
            raise ValueError("recorded verification differs from actual archive")
    work.mkdir(parents=True, exist_ok=True)
    (work / "effective-inputs.json").write_text(json.dumps(inputs.receipts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (work / "verification-result.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"mode": args.mode, "archive": integrity, "verification": verification}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
