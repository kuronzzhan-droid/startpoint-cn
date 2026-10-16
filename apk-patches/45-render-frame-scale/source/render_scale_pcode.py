#!/usr/bin/env python3
"""Apply and verify the three offline render-scale P-code sites.

The transforms start from the accepted base method bodies and replace only
one named method at a time.  Each replacement is reopened through FFDec and
all previously applied sites are reverified against raw ABC and canonical
P-code locks before the next site can run.
"""

from __future__ import annotations

import hashlib
import hmac
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Mapping, Sequence


HERE = Path(__file__).resolve().parent
CLIENT_PATCH = HERE.parent
DUAL_FORM = CLIENT_PATCH / "dual-form-v1"
ABYSS_BUILD_PATH = CLIENT_PATCH / "abyss-mode-equipment" / "build_apk.py"
LOWER_SHA256 = re.compile(r"^[0-9a-f]{64}$")
OFFSET_LABEL = re.compile(r"\bofs[0-9A-Fa-f]+\b")
LOCK_FIELDS = frozenset(
    {
        "class_name",
        "method_name",
        "before_pcode_sha256",
        "after_pcode_sha256",
        "before_abc_sha256",
        "after_abc_sha256",
    }
)


class RenderScaleError(RuntimeError):
    pass


def _load_module(name: str, path: Path):
    existing = sys.modules.get(name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RenderScaleError(f"cannot load tracked helper: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ABC_METHODS = _load_module(
    "offline_render_abc_methods", DUAL_FORM / "abc_methods.py"
)
PCODE_TOOLS = _load_module(
    "offline_render_pcode_tools", DUAL_FORM / "pcode_tools.py"
)
PUBLISH_TOOLS = _load_module(
    "offline_render_publish_tools", ABYSS_BUILD_PATH
)


@dataclass(frozen=True, slots=True)
class RenderSite:
    site_id: str
    class_name: str
    method_name: str
    patch: Callable[[str], str]
    verify: Callable[[str], None]


@dataclass(frozen=True, slots=True)
class RenderPatchReport:
    output_path: Path
    input_sha256: str
    output_sha256: str
    site_ids: tuple[str, ...]
    before_hashes: Mapping[str, str]
    after_hashes: Mapping[str, str]
    verified: bool


PIXEL_BEFORE = (
    "getlocal 12",
    "pushbyte 1",
    'initproperty QName(PackageNamespace(""),"scale")',
)
PIXEL_AFTER = (
    "getlocal 12",
    "getlocal 12",
    'getproperty QName(PackageNamespace(""),"scale")',
    "pushbyte 6",
    "divide",
    'initproperty QName(PackageNamespace(""),"scale")',
)
MEMBER_SHADOW = (
    'findproperty QName(PackageNamespace(""),"shadow")',
    'getproperty QName(PackageNamespace(""),"shadow")',
    'getlex QName(PackageNamespace("pinball.scene.battle.battle"),"BattleConstants")',
    'getproperty QName(PackageNamespace(""),"SCALE_RENDERER")',
    'initproperty QName(PackageNamespace(""),"scaleX")',
    'findproperty QName(PackageNamespace(""),"shadow")',
    'getproperty QName(PackageNamespace(""),"shadow")',
    'getlex QName(PackageNamespace("pinball.scene.battle.battle"),"BattleConstants")',
    'getproperty QName(PackageNamespace(""),"SCALE_RENDERER")',
    'initproperty QName(PackageNamespace(""),"scaleY")',
)
MEMBER_CHARACTER = (
    'findproperty QName(PackageNamespace(""),"character")',
    'getproperty QName(PackageNamespace(""),"character")',
    'getlex QName(PackageNamespace("pinball.scene.battle.battle"),"BattleConstants")',
    'getproperty QName(PackageNamespace(""),"SCALE_RENDERER")',
    'initproperty QName(PackageNamespace(""),"scaleX")',
    'findproperty QName(PackageNamespace(""),"character")',
    'getproperty QName(PackageNamespace(""),"character")',
    'getlex QName(PackageNamespace("pinball.scene.battle.battle"),"BattleConstants")',
    'getproperty QName(PackageNamespace(""),"SCALE_RENDERER")',
    'initproperty QName(PackageNamespace(""),"scaleY")',
)
CELL_MATRIX = (
    'findproperty QName(PackageNamespace(""),"character")',
    'getproperty QName(PackageNamespace(""),"character")',
    'coerce QName(PackageNamespace("starling.display"),"DisplayObject")',
    "setlocal 43",
    'findproperty QName(PackageNamespace(""),"tempTransformation")',
    'getproperty QName(PackageNamespace(""),"tempTransformation")',
    "coerce_a",
    "setlocal 39",
    "getlocal 43",
    "getlocal 39",
    'getproperty QName(PackageNamespace(""),"matrix")',
    'coerce QName(PackageNamespace("flash.geom"),"Matrix")',
    'initproperty QName(PackageNamespace(""),"transformationMatrix")',
)
CELL_SCALE_X = (
    "getlocal 43",
    "dup",
    'getproperty QName(PackageNamespace(""),"scaleX")',
    "getlocal 43",
    'getproperty QName(PackageNamespace(""),"defaultScale")',
    "pushbyte 6",
    "divide",
    "multiply",
    'initproperty QName(PackageNamespace(""),"scaleX")',
)
CELL_SCALE_Y = (
    "getlocal 43",
    "dup",
    'getproperty QName(PackageNamespace(""),"scaleY")',
    "getlocal 43",
    'getproperty QName(PackageNamespace(""),"defaultScale")',
    "pushbyte 6",
    "divide",
    "multiply",
    'initproperty QName(PackageNamespace(""),"scaleY")',
)


BASE_BEFORE_ABC_SHA256 = MappingProxyType(
    {
        "pixel-art": "9475368c4dd326f0d8230ba724d96a60af5d30dba37ac5d43d5bdd04a85b038b",
        "member-view": "0ca2af059a85e432c9c6dc991126d0eeba57acaa5ecc152aee83e36ed19a9d77",
        "character-cell": "cc64eafcb0bbaeb4f1ae705944da569cc1d59bf9dc7636b1bbfe64342175e3a7",
    }
)

# This constructor was listed in the original plan, but its reviewed body only
# initializes cell state and playheads.  It has no character identity, render
# matrix, or scale operation, so it is deliberately excluded from RENDER_SITES.
NON_RENDER_CHARACTER_CELL_CTOR = MappingProxyType(
    {
        "method_name": "pinball.scene.character.cell:CharacterCell/CharacterCell",
        "before_abc_sha256": "f1d643128a517f7ae5f6c0628c3d96761254a67f34520a257ab302519329a0b8",
        "reason": "constructor has no character identity or render-scale semantics",
    }
)


def _compact(block: str) -> list[str]:
    return [line.strip() for line in block.splitlines() if line.strip()]


def _sequence_hits(lines: Sequence[str], sequence: Sequence[str]) -> list[int]:
    return [
        index
        for index in range(len(lines) - len(sequence) + 1)
        if list(lines[index : index + len(sequence)]) == list(sequence)
    ]


def _instruction_count(block: str, instruction: str) -> int:
    return sum(line.strip() == instruction for line in block.splitlines())


def _splice_sequence(
    block: str,
    before: Sequence[str],
    after: Sequence[str],
    context: str,
) -> str:
    lines = block.splitlines()
    stripped = [line.strip() for line in lines]
    hits = _sequence_hits(stripped, before)
    if len(hits) != 1:
        raise RenderScaleError(
            f"{context} anchor count {len(hits)}; expected exactly one"
        )
    index = hits[0]
    indent = lines[index][: len(lines[index]) - len(lines[index].lstrip())]
    replacement = [indent + instruction for instruction in after]
    return "\n".join(lines[:index] + replacement + lines[index + len(before) :]) + "\n"


def patch_pixel_art(block: str) -> str:
    lines = _compact(block)
    if _sequence_hits(lines, PIXEL_AFTER):
        raise RenderScaleError("pixel-art patch is already present")
    output = _splice_sequence(block, PIXEL_BEFORE, PIXEL_AFTER, "pixel-art")
    verify_pixel_art(output)
    return output


def verify_pixel_art(block: str) -> None:
    lines = _compact(block)
    before = _sequence_hits(lines, PIXEL_BEFORE)
    after = _sequence_hits(lines, PIXEL_AFTER)
    if before or len(after) != 1:
        raise RenderScaleError(
            "pixel-art scale gate mismatch: "
            f"before={len(before)} after={len(after)}"
        )


def patch_member_view_ctor(block: str) -> str:
    lines = _compact(block)
    character = _sequence_hits(lines, MEMBER_CHARACTER)
    shadow = _sequence_hits(lines, MEMBER_SHADOW)
    if not character and len(shadow) == 1:
        raise RenderScaleError("member-view patch is already present")
    if len(shadow) != 1:
        raise RenderScaleError(
            f"member-view shadow anchor count {len(shadow)}; expected exactly one"
        )
    output = _splice_sequence(block, MEMBER_CHARACTER, (), "member-view character")
    verify_member_view_ctor(output)
    return output


def verify_member_view_ctor(block: str) -> None:
    lines = _compact(block)
    character = _sequence_hits(lines, MEMBER_CHARACTER)
    shadow = _sequence_hits(lines, MEMBER_SHADOW)
    renderer_count = _instruction_count(
        block, 'getproperty QName(PackageNamespace(""),"SCALE_RENDERER")'
    )
    if character or len(shadow) != 1 or renderer_count != 2:
        raise RenderScaleError(
            "member-view scale semantics mismatch: "
            f"character={len(character)} shadow={len(shadow)} "
            f"renderer={renderer_count}"
        )


def _header_value(block: str, name: str) -> int:
    matches = re.findall(
        rf"(?m)^[ \t]*{re.escape(name)}[ \t]+([0-9]+)[ \t]*$", block
    )
    if len(matches) != 1:
        raise RenderScaleError(f"expected one {name} declaration, found {len(matches)}")
    return int(matches[0])


def patch_character_cell(block: str) -> str:
    lines = _compact(block)
    full = CELL_MATRIX + CELL_SCALE_X + CELL_SCALE_Y
    if _sequence_hits(lines, full):
        raise RenderScaleError("character-cell patch is already present")
    matrix = _sequence_hits(lines, CELL_MATRIX)
    if len(matrix) != 1:
        raise RenderScaleError(
            f"character-cell matrix anchor count {len(matrix)}; expected exactly one"
        )
    output = _splice_sequence(
        block,
        CELL_MATRIX,
        full,
        "character-cell matrix",
    )
    verify_character_cell(output)
    return output


def verify_character_cell(block: str) -> None:
    lines = _compact(block)
    full = CELL_MATRIX + CELL_SCALE_X + CELL_SCALE_Y
    matrix = _sequence_hits(lines, CELL_MATRIX)
    patched = _sequence_hits(lines, full)
    default_scale = _instruction_count(
        block, 'getproperty QName(PackageNamespace(""),"defaultScale")'
    )
    if len(matrix) != 1 or len(patched) != 1 or default_scale != 2:
        raise RenderScaleError(
            "character-cell scale gate mismatch: "
            f"matrix={len(matrix)} patched={len(patched)} "
            f"defaultScale={default_scale}"
        )
    if any(
        line.startswith("getlex ") and re.search(r'"_temp_[0-9]+"', line)
        for line in lines
    ):
        raise RenderScaleError("character-cell contains an invalid pseudo-local getlex")
    expected_header = {
        "maxstack": 4,
        "localcount": 49,
        "initscopedepth": 1,
        "maxscopedepth": 2,
    }
    actual_header = {
        name: _header_value(block, name) for name in expected_header
    }
    if actual_header != expected_header:
        raise RenderScaleError(
            f"character-cell method header drift: {actual_header!r}"
        )


RENDER_SITES = (
    RenderSite(
        "pixel-art",
        "pinball.ui.component.pixelArtCharacter.PixelArtCharacterView",
        "pinball.ui.component.pixelArtCharacter:PixelArtCharacterView/spriteSheetLoadCompleted",
        patch_pixel_art,
        verify_pixel_art,
    ),
    RenderSite(
        "member-view",
        "pinball.scene.battle.battle.squad.member.MemberView",
        "pinball.scene.battle.battle.squad.member:MemberView/MemberView",
        patch_member_view_ctor,
        verify_member_view_ctor,
    ),
    RenderSite(
        "character-cell",
        "pinball.scene.character.cell.CharacterCellView",
        "pinball.scene.character.cell:CharacterCellView/drawWithAdvanceFlag",
        patch_character_cell,
        verify_character_cell,
    ),
)

RENDER_SITE_IDS = tuple(site.site_id for site in RENDER_SITES)


def canonical_pcode(text: str) -> str:
    """Normalize only FFDec offset-label renumbering, preserving topology."""
    definitions = re.findall(r"(?m)^[ \t]*(ofs[0-9A-Fa-f]+):[ \t]*$", text)
    normalized = [label.lower() for label in definitions]
    if len(normalized) != len(set(normalized)):
        raise RenderScaleError("P-code contains duplicate offset label definitions")
    labels = {label: f"L{index}" for index, label in enumerate(normalized)}
    referenced = {match.group(0).lower() for match in OFFSET_LABEL.finditer(text)}
    undefined = sorted(referenced - set(labels))
    if undefined:
        raise RenderScaleError(
            f"P-code contains undefined offset label references: {undefined}"
        )
    return OFFSET_LABEL.sub(lambda match: labels[match.group(0).lower()], text)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_pcode(text: str) -> str:
    return hashlib.sha256(canonical_pcode(text).encode("utf-8")).hexdigest()


def _sha256_abc(code: bytes) -> str:
    return hashlib.sha256(bytes(code)).hexdigest()


def _site_locks(lock: Mapping[str, Any]) -> Mapping[str, Mapping[str, str]]:
    if not isinstance(lock, Mapping):
        raise RenderScaleError("render lock must be a mapping")
    if lock.get("schema_version") != 4 or lock.get("status") != "accepted":
        raise RenderScaleError("render lock must be accepted schema 4")
    if lock.get("stage") != "post-abyss":
        raise RenderScaleError("render lock base stage must be post-abyss")
    expected = tuple(site.site_id for site in RENDER_SITES)
    if tuple(lock.get("render_site_ids", ())) != expected:
        raise RenderScaleError("render site order mismatch")
    sites = lock.get("render_sites")
    if (
        not isinstance(sites, Mapping)
        or len(sites) != len(expected)
        or set(sites) != set(expected)
    ):
        raise RenderScaleError("render site mapping mismatch")
    for site in RENDER_SITES:
        entry = sites.get(site.site_id)
        if not isinstance(entry, Mapping) or set(entry) != LOCK_FIELDS:
            raise RenderScaleError(f"invalid render lock entry for {site.site_id}")
        if (
            entry.get("class_name") != site.class_name
            or entry.get("method_name") != site.method_name
        ):
            raise RenderScaleError(f"render lock identity mismatch for {site.site_id}")
        for field in (
            "before_pcode_sha256",
            "after_pcode_sha256",
            "before_abc_sha256",
            "after_abc_sha256",
        ):
            if LOWER_SHA256.fullmatch(str(entry.get(field, ""))) is None:
                raise RenderScaleError(f"invalid {field} for {site.site_id}")
        if entry["before_pcode_sha256"] == entry["after_pcode_sha256"]:
            raise RenderScaleError(f"unchanged P-code lock for {site.site_id}")
        if entry["before_abc_sha256"] == entry["after_abc_sha256"]:
            raise RenderScaleError(f"unchanged ABC lock for {site.site_id}")
        if entry["before_abc_sha256"] != BASE_BEFORE_ABC_SHA256[site.site_id]:
            raise RenderScaleError(f"unrecognized base ABC lock for {site.site_id}")
    return sites


def _subprocess_runner(command, *, cwd: Path, env: Mapping[str, str], timeout: int):
    completed = subprocess.run(
        [str(part) for part in command],
        cwd=cwd,
        env=dict(env),
        capture_output=True,
        text=True,
        errors="replace",
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        raise RenderScaleError(
            f"FFDec command failed ({completed.returncode}): "
            f"{completed.stderr[-1000:]}"
        )
    return {
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def _run(command, *, cwd: Path, profile_dir: Path, runner, timeout: int) -> None:
    environment = os.environ.copy()
    environment["APPDATA"] = str(profile_dir.resolve())
    result = runner(command, cwd=cwd, env=environment, timeout=timeout)
    if isinstance(result, Mapping) and int(result.get("returncode", 0)) != 0:
        raise RenderScaleError(f"FFDec command failed: {result.get('returncode')}")


def _export_classes(
    swf: Path,
    export_root: Path,
    classes: Sequence[str],
    *,
    ffdec: Path,
    java: Path,
    profile_dir: Path,
    cwd: Path,
    runner,
    timeout: int,
) -> None:
    _run(
        [
            str(java),
            "-Xmx4g",
            "-jar",
            str(ffdec),
            "-air",
            "-format",
            "script:pcode",
            "-selectclass",
            ",".join(dict.fromkeys(classes)),
            "-export",
            "script",
            str(export_root),
            str(swf),
        ],
        cwd=cwd,
        profile_dir=profile_dir,
        runner=runner,
        timeout=timeout,
    )


def _extract_constructor_method(text: str, constructor: str) -> str:
    lines = text.splitlines()
    headers = [
        index
        for index, line in enumerate(lines)
        if line.strip().startswith(f"public function {constructor}(")
    ]
    if len(headers) != 1:
        raise RenderScaleError(
            f"expected one {constructor} constructor, found {len(headers)}"
        )
    header_indent = len(lines[headers[0]]) - len(lines[headers[0]].lstrip())
    method_line = None
    for index in range(headers[0] + 1, len(lines)):
        stripped = lines[index].strip()
        indent_width = len(lines[index]) - len(lines[index].lstrip())
        if index > headers[0] + 1 and indent_width <= header_indent and (
            stripped == "}" or stripped.startswith("public function ")
        ):
            break
        if stripped == "method":
            method_line = index
            break
    if method_line is None:
        raise RenderScaleError(f"constructor method block is missing for {constructor}")
    indent = lines[method_line][
        : len(lines[method_line]) - len(lines[method_line].lstrip())
    ]
    end_line = next(
        (
            index
            for index in range(method_line + 1, len(lines))
            if lines[index] == f"{indent}end ; method"
        ),
        None,
    )
    if end_line is None:
        raise RenderScaleError(f"constructor method block is unterminated for {constructor}")
    return textwrap.dedent("\n".join(lines[method_line : end_line + 1]) + "\n")


def _read_exported_method(export_root: Path, site: RenderSite) -> str:
    source = (
        export_root
        / "scripts"
        / Path(*site.class_name.split(".")).with_suffix(".pcode")
    )
    if not source.is_file():
        raise RenderScaleError(f"missing exported P-code for {site.class_name}")
    short_name = site.method_name.rsplit("/", 1)[-1]
    try:
        text = source.read_text(encoding="utf-8")
        if short_name == site.class_name.rsplit(".", 1)[-1]:
            return _extract_constructor_method(text, short_name)
        return textwrap.dedent(
            PCODE_TOOLS.extract_method_block(
                text,
                trait_kind="method",
                trait_name=short_name,
            )
        )
    except OSError as exc:
        raise RenderScaleError(str(exc)) from exc
    except PCODE_TOOLS.PcodePatchError as exc:
        raise RenderScaleError(str(exc)) from exc


def _replace_one(
    source: Path,
    destination: Path,
    site: RenderSite,
    replacement: Path,
    body_index: int,
    *,
    ffdec: Path,
    java: Path,
    profile_dir: Path,
    cwd: Path,
    runner,
    timeout: int,
) -> None:
    _run(
        [
            str(java),
            "-Xmx4g",
            "-jar",
            str(ffdec),
            "-air",
            "-onerror",
            "abort",
            "-replace",
            str(source),
            str(destination),
            site.class_name,
            str(replacement),
            str(body_index),
        ],
        cwd=cwd,
        profile_dir=profile_dir,
        runner=runner,
        timeout=timeout,
    )
    if not destination.is_file():
        raise RenderScaleError(f"FFDec did not create stage for {site.site_id}")


def _verify_methods(
    swf: Path,
    sites_to_verify: Sequence[RenderSite],
    locks: Mapping[str, Mapping[str, str]],
    *,
    export_root: Path,
    ffdec: Path,
    java: Path,
    profile_dir: Path,
    cwd: Path,
    runner,
    timeout: int,
) -> dict[str, str]:
    index = ABC_METHODS.index_swf_methods(swf)
    refs = {
        site.site_id: index.require_ref(site.method_name)
        for site in sites_to_verify
    }
    _export_classes(
        swf,
        export_root,
        [site.class_name for site in sites_to_verify],
        ffdec=ffdec,
        java=java,
        profile_dir=profile_dir,
        cwd=cwd,
        runner=runner,
        timeout=timeout,
    )
    hashes: dict[str, str] = {}
    for site in sites_to_verify:
        raw_hash = _sha256_abc(refs[site.site_id].code)
        if raw_hash != locks[site.site_id]["after_abc_sha256"]:
            raise RenderScaleError(f"reopen ABC hash mismatch for {site.site_id}")
        block = _read_exported_method(export_root, site)
        site.verify(block)
        actual = _sha256_pcode(block)
        expected = locks[site.site_id]["after_pcode_sha256"]
        if actual != expected:
            raise RenderScaleError(f"reopen P-code hash mismatch for {site.site_id}")
        hashes[site.site_id] = actual
    return hashes


def _validate_stage_paths(
    source_swf: Path,
    output_swf: Path,
    ffdec: Path,
    java: Path,
    work_dir: Path,
    profile_dir: Path,
) -> tuple[Path, Path, Path, Path, Path, Path]:
    source = Path(source_swf).resolve()
    output = Path(output_swf).resolve()
    ffdec_path = Path(ffdec).resolve()
    java_path = Path(java).resolve()
    work = Path(work_dir).resolve()
    profile = Path(profile_dir).resolve()
    if os.path.normcase(str(source)) == os.path.normcase(str(output)):
        raise RenderScaleError("source and output SWF must differ")
    if not source.is_file():
        raise RenderScaleError(f"source SWF is missing: {source}")
    if os.path.lexists(output):
        try:
            if os.path.samefile(source, output):
                raise RenderScaleError("source and output SWF are filesystem aliases")
        except OSError:
            pass
        raise RenderScaleError(f"output SWF already exists: {output}")
    for label, directory in (("work", work), ("profile", profile)):
        try:
            directory.relative_to(output)
        except ValueError:
            continue
        raise RenderScaleError(
            f"output SWF cannot equal or contain the {label} directory"
        )
    for label, path in (("FFDec", ffdec_path), ("Java", java_path)):
        if not path.is_file():
            raise RenderScaleError(f"{label} tool is missing: {path}")
    for label, directory in (("work", work), ("profile", profile)):
        if directory.exists() and not directory.is_dir():
            raise RenderScaleError(f"{label} path is not a directory: {directory}")
    output.parent.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    profile.mkdir(parents=True, exist_ok=True)
    return source, output, ffdec_path, java_path, work, profile


def _copy_snapshot(source: Path, destination: Path) -> None:
    with source.open("rb") as input_handle, destination.open("xb") as output_handle:
        shutil.copyfileobj(input_handle, output_handle, 1024 * 1024)
        output_handle.flush()
        os.fsync(output_handle.fileno())


def _assert_source_hash(source: Path, expected: str) -> None:
    try:
        actual = _sha256_file(source)
    except OSError as exc:
        raise RenderScaleError(
            "source SWF became unreadable during render-scale stage"
        ) from exc
    if not hmac.compare_digest(actual, expected):
        raise RenderScaleError("source SWF changed during render-scale stage")


def _require_handle_bound_publish_support() -> None:
    try:
        PUBLISH_TOOLS._require_handle_bound_publish_support()
    except PUBLISH_TOOLS.BuildError as exc:
        raise RenderScaleError(str(exc)) from exc


def _stage_output_sibling(source: Path, destination: Path, expected_hash: str):
    try:
        return PUBLISH_TOOLS._stage_output_sibling(source, destination, expected_hash)
    except PUBLISH_TOOLS.BuildError as exc:
        raise RenderScaleError(str(exc)) from exc


def _publish_staged_exclusive(staging, destination: Path, expected_hash: str) -> None:
    try:
        PUBLISH_TOOLS._publish_staged_exclusive(staging, destination, expected_hash)
    except PUBLISH_TOOLS.BuildError as exc:
        raise RenderScaleError(str(exc)) from exc


def _cleanup_owned_staging(staging) -> None:
    try:
        PUBLISH_TOOLS._cleanup_owned_staging(staging)
    except PUBLISH_TOOLS.BuildError as exc:
        raise RenderScaleError(str(exc)) from exc


def _clean_transaction_before_publish(transaction: Path) -> None:
    try:
        PUBLISH_TOOLS._clean_transaction_before_publish(transaction)
    except PUBLISH_TOOLS.BuildError as exc:
        raise RenderScaleError(str(exc)) from exc


def apply_render_scale(
    source_swf: Path,
    output_swf: Path,
    lock: Mapping[str, Any],
    *,
    ffdec: Path,
    java: Path,
    profile_dir: Path,
    work_dir: Path,
    runner=_subprocess_runner,
    timeout: int = 240,
) -> RenderPatchReport:
    _require_handle_bound_publish_support()
    locks = _site_locks(lock)
    source, output, ffdec_path, java_path, work, profile = _validate_stage_paths(
        source_swf, output_swf, ffdec, java, work_dir, profile_dir
    )
    source_sha = _sha256_file(source)
    before_hashes: dict[str, str] = {}
    after_hashes: dict[str, str] = {}
    transaction: Path | None = None
    staged_output = None
    original_error: BaseException | None = None
    try:
        transaction = Path(
            tempfile.mkdtemp(prefix=".render-scale-", dir=work)
        ).resolve()
        snapshot = transaction / "source.swf"
        _copy_snapshot(source, snapshot)
        if not hmac.compare_digest(_sha256_file(snapshot), source_sha):
            raise RenderScaleError("source SWF changed while creating stage snapshot")
        _assert_source_hash(source, source_sha)
        current = snapshot
        for sequence, site in enumerate(RENDER_SITES, start=1):
            index = ABC_METHODS.index_swf_methods(current)
            ref = index.require_ref(site.method_name)
            before_abc = _sha256_abc(ref.code)
            if before_abc != locks[site.site_id]["before_abc_sha256"]:
                raise RenderScaleError(f"before ABC hash mismatch for {site.site_id}")
            export_root = transaction / f"{sequence:02d}-before-export"
            _export_classes(
                current,
                export_root,
                [site.class_name],
                ffdec=ffdec_path,
                java=java_path,
                profile_dir=profile,
                cwd=transaction,
                runner=runner,
                timeout=timeout,
            )
            _assert_source_hash(source, source_sha)
            before = _read_exported_method(export_root, site)
            before_sha = _sha256_pcode(before)
            if before_sha != locks[site.site_id]["before_pcode_sha256"]:
                raise RenderScaleError(f"before P-code hash mismatch for {site.site_id}")
            before_hashes[site.site_id] = before_sha
            after = site.patch(before)
            after_sha = _sha256_pcode(after)
            if after_sha != locks[site.site_id]["after_pcode_sha256"]:
                raise RenderScaleError(f"after P-code hash mismatch for {site.site_id}")
            replacement = transaction / f"{sequence:02d}-{site.site_id}.pcode"
            replacement.write_text(after, encoding="utf-8", newline="\n")
            staged = transaction / f"{sequence:02d}-{site.site_id}.swf"
            _replace_one(
                current,
                staged,
                site,
                replacement,
                ref.body_index,
                ffdec=ffdec_path,
                java=java_path,
                profile_dir=profile,
                cwd=transaction,
                runner=runner,
                timeout=timeout,
            )
            _assert_source_hash(source, source_sha)
            reopened = _verify_methods(
                staged,
                RENDER_SITES[:sequence],
                locks,
                export_root=transaction / f"{sequence:02d}-reopen-export",
                ffdec=ffdec_path,
                java=java_path,
                profile_dir=profile,
                cwd=transaction,
                runner=runner,
                timeout=timeout,
            )
            _assert_source_hash(source, source_sha)
            after_hashes.update(reopened)
            current = staged

        output_sha = _sha256_file(current)
        _assert_source_hash(source, source_sha)
        staged_output = _stage_output_sibling(current, output, output_sha)
        report = RenderPatchReport(
            output_path=output,
            input_sha256=source_sha,
            output_sha256=output_sha,
            site_ids=tuple(site.site_id for site in RENDER_SITES),
            before_hashes=MappingProxyType(dict(before_hashes)),
            after_hashes=MappingProxyType(dict(after_hashes)),
            verified=True,
        )
        cleanup_target = transaction
        _clean_transaction_before_publish(cleanup_target)
        transaction = None
        _assert_source_hash(source, source_sha)
        _publish_staged_exclusive(staged_output, output, output_sha)
        staged_output = None
        return report
    except BaseException as error:
        original_error = error
        raise
    finally:
        if transaction is not None:
            try:
                shutil.rmtree(transaction)
            except BaseException as cleanup_error:
                if original_error is None:
                    raise RenderScaleError(
                        "failed to clean render-scale transaction"
                    ) from cleanup_error
                original_error.add_note(
                    "failed to clean render-scale transaction: "
                    f"{type(cleanup_error).__name__}: {cleanup_error}"
                )
        if staged_output is not None:
            try:
                _cleanup_owned_staging(staged_output)
            except BaseException as cleanup_error:
                if original_error is None:
                    if isinstance(cleanup_error, RenderScaleError):
                        raise
                    raise RenderScaleError(
                        "failed to clean staged render-scale output"
                    ) from cleanup_error
                original_error.add_note(
                    "failed to clean staged render-scale output: "
                    f"{type(cleanup_error).__name__}: {cleanup_error}"
                )


def verify_render_scale(
    output_swf: Path,
    lock: Mapping[str, Any],
    *,
    ffdec: Path,
    java: Path,
    profile_dir: Path,
    work_dir: Path,
    runner=_subprocess_runner,
    timeout: int = 240,
) -> RenderPatchReport:
    locks = _site_locks(lock)
    output = Path(output_swf).resolve()
    ffdec_path = Path(ffdec).resolve()
    java_path = Path(java).resolve()
    work = Path(work_dir).resolve()
    profile = Path(profile_dir).resolve()
    if not output.is_file() or not ffdec_path.is_file() or not java_path.is_file():
        raise RenderScaleError("render verification input or tool is missing")
    if work.exists() and not work.is_dir():
        raise RenderScaleError("render verification work path is not a directory")
    if profile.exists() and not profile.is_dir():
        raise RenderScaleError("render verification profile path is not a directory")
    work.mkdir(parents=True, exist_ok=True)
    profile.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".render-verify-", dir=work) as raw:
        after = _verify_methods(
            output,
            RENDER_SITES,
            locks,
            export_root=Path(raw) / "reopen-export",
            ffdec=ffdec_path,
            java=java_path,
            profile_dir=profile,
            cwd=Path(raw),
            runner=runner,
            timeout=timeout,
        )
    digest = _sha256_file(output)
    return RenderPatchReport(
        output_path=output,
        input_sha256=digest,
        output_sha256=digest,
        site_ids=tuple(site.site_id for site in RENDER_SITES),
        before_hashes=MappingProxyType(
            {
                site.site_id: locks[site.site_id]["before_pcode_sha256"]
                for site in RENDER_SITES
            }
        ),
        after_hashes=MappingProxyType(after),
        verified=True,
    )


def site_fingerprints(
    swf: Path,
    *,
    ffdec: Path,
    java: Path,
    profile_dir: Path,
    work_dir: Path,
    sites: Sequence[RenderSite] = RENDER_SITES,
    runner=_subprocess_runner,
    timeout: int = 240,
) -> dict[str, dict[str, str]]:
    """Verify every render site in ``swf`` and fingerprint each method body.

    Returns ``{site_id: {"pcode_sha256": ..., "abc_sha256": ...}}``.  Unlike
    ``verify_render_scale`` this needs no build-time lock, so a downstream
    repackager that starts from an already-patched base APK can fingerprint it
    before and after its own rewrite and prove nothing moved.  The P-code digest
    is canonical and therefore blind to FFDec's offset-label renumbering; the
    raw ABC digest is not, so the pair distinguishes a harmless reserialization
    from an actual code change.  ``site.verify`` still runs on every site, so a
    base that never carried a fix is rejected instead of silently fingerprinted.
    """
    ordered = tuple(sites)
    if not ordered:
        raise RenderScaleError("render fingerprint requires at least one site")
    target = Path(swf).resolve()
    ffdec_path = Path(ffdec).resolve()
    java_path = Path(java).resolve()
    work = Path(work_dir).resolve()
    profile = Path(profile_dir).resolve()
    if not target.is_file() or not ffdec_path.is_file() or not java_path.is_file():
        raise RenderScaleError("render fingerprint input or tool is missing")
    if work.exists() and not work.is_dir():
        raise RenderScaleError("render fingerprint work path is not a directory")
    if profile.exists() and not profile.is_dir():
        raise RenderScaleError("render fingerprint profile path is not a directory")
    work.mkdir(parents=True, exist_ok=True)
    profile.mkdir(parents=True, exist_ok=True)
    index = ABC_METHODS.index_swf_methods(target)
    refs = {site.site_id: index.require_ref(site.method_name) for site in ordered}
    fingerprints: dict[str, dict[str, str]] = {}
    with tempfile.TemporaryDirectory(prefix=".render-fingerprint-", dir=work) as raw:
        export_root = Path(raw) / "fingerprint-export"
        _export_classes(
            target,
            export_root,
            [site.class_name for site in ordered],
            ffdec=ffdec_path,
            java=java_path,
            profile_dir=profile,
            cwd=Path(raw),
            runner=runner,
            timeout=timeout,
        )
        for site in ordered:
            block = _read_exported_method(export_root, site)
            site.verify(block)
            fingerprints[site.site_id] = {
                "pcode_sha256": _sha256_pcode(block),
                "abc_sha256": _sha256_abc(refs[site.site_id].code),
            }
    return fingerprints


def assert_fingerprints_unchanged(
    before: Mapping[str, Mapping[str, str]],
    after: Mapping[str, Mapping[str, str]],
    *,
    site_ids: Sequence[str] = RENDER_SITE_IDS,
) -> None:
    """Fail unless both fingerprints cover ``site_ids`` with identical digests."""
    expected = set(site_ids)
    for label, value in (("before", before), ("after", after)):
        missing = sorted(expected - set(value))
        if missing:
            raise RenderScaleError(
                f"{label} render fingerprint is missing sites: {missing}"
            )
        extra = sorted(set(value) - expected)
        if extra:
            raise RenderScaleError(
                f"{label} render fingerprint has unexpected sites: {extra}"
            )
    for site_id in site_ids:
        for field in ("pcode_sha256", "abc_sha256"):
            original = before[site_id].get(field)
            current = after[site_id].get(field)
            if original != current:
                raise RenderScaleError(
                    f"render site {site_id} changed: {field} "
                    f"{original} -> {current}"
                )
