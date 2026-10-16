#!/usr/bin/env python3
"""Build and verify a signed APK containing the abyss equipment gate."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import importlib.util
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence


def _load_gate_patch() -> Any:
    module_name = "abyss_mode_equipment_gate_patch_for_builder"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    path = Path(__file__).with_name("patch.py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load gate patch module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


abyss_patch = _load_gate_patch()


TARGET_SWF_MEMBER = "assets/worldflipper_android_release.swf"
TARGET_CLASS = "pinball.common.data.character.BattleCharacterLogic"
TARGET_CLASS_EXPORT = Path(
    "scripts/pinball/common/data/character/BattleCharacterLogic.as"
)
REPORT_ARTIFACTS = (
    "patched_as",
    "injected_swf",
    "signed_apk",
    "reexported_as",
)
_SIGNATURE_EXTENSIONS = (".SF", ".RSA", ".DSA", ".EC")
_SHA256_RE = re.compile(r"[0-9a-f]{64}")


class BuildError(RuntimeError):
    """The APK cannot be built or verified safely."""


Runner = Callable[..., Any]
FileIdentity = tuple[int, int]


@dataclass(frozen=True)
class BuildConfig:
    """Explicit inputs and destinations for one verified APK build."""

    base: Path
    battle_logic_as: Path
    output_apk: Path
    report: Path
    work: Path
    ffdec: Path
    java: Path
    zipalign: Path
    apksigner: Path
    keystore: Path
    keystore_password_env: str


@dataclass(frozen=True, slots=True)
class PatchStageReport:
    """Verified result of applying only the abyss gate to one SWF."""

    stage: str
    output_path: Path
    input_sha256: str
    output_sha256: str
    target_class: str
    before_method_sha256: str
    after_method_sha256: str
    match_count: int


@dataclass(frozen=True, slots=True)
class _OwnedStagedFile:
    path: Path
    identity: FileIdentity
    handle: Any


def is_signature_member(member: str) -> bool:
    """Return whether *member* is a top-level APK v1 signature file."""
    parts = member.split("/")
    if len(parts) != 2 or parts[0].upper() != "META-INF":
        return False
    filename = parts[1].upper()
    return filename == "MANIFEST.MF" or filename.endswith(_SIGNATURE_EXTENSIONS)


def rewrite_apk(
    base_apk: Path | str,
    output_apk: Path | str,
    injected_swf: Path | str,
) -> None:
    """Replace the main SWF and strip only top-level APK signatures."""
    base_path = Path(base_apk)
    output_path = Path(output_apk)
    swf_bytes = Path(injected_swf).read_bytes()
    if os.path.normcase(os.path.abspath(base_path)) == os.path.normcase(
        os.path.abspath(output_path)
    ):
        raise BuildError("base and rewritten APK must be different paths")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with zipfile.ZipFile(base_path, "r") as source:
            members = source.infolist()
            target_count = sum(
                member.filename == TARGET_SWF_MEMBER for member in members
            )
            if target_count != 1:
                raise BuildError(
                    f"expected exactly one {TARGET_SWF_MEMBER}, found {target_count}"
                )
            with tempfile.NamedTemporaryFile(
                dir=output_path.parent,
                prefix=f".{output_path.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temporary = Path(handle.name)
            with zipfile.ZipFile(temporary, "w", allowZip64=True) as target:
                target.comment = source.comment
                for member in members:
                    if is_signature_member(member.filename):
                        continue
                    data = (
                        swf_bytes
                        if member.filename == TARGET_SWF_MEMBER
                        else source.read(member)
                    )
                    target.writestr(member, data)
        os.replace(temporary, output_path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def sha256_file(path: Path | str) -> str:
    """Return a lowercase SHA-256 digest for *path*."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_report(report: Mapping[str, Any] | Path | str) -> Mapping[str, Any]:
    if isinstance(report, Mapping):
        return report
    try:
        loaded = json.loads(Path(report).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read verification report: {exc}") from exc
    if not isinstance(loaded, Mapping):
        raise BuildError("verification report root must be an object")
    return loaded


def validate_verification_report(
    report: Mapping[str, Any] | Path | str,
) -> bool:
    """Validate the report schema and re-hash every recorded artifact."""
    data = _load_report(report)
    if data.get("schema_version") != 1 or data.get("status") != "verified":
        raise BuildError("verification report status/schema is invalid")
    if data.get("class_name") != TARGET_CLASS:
        raise BuildError("verification report class name is invalid")
    artifacts = data.get("artifacts")
    if not isinstance(artifacts, Mapping):
        raise BuildError("verification report artifacts must be an object")
    if set(artifacts) != set(REPORT_ARTIFACTS):
        raise BuildError("verification report artifact set is invalid")

    canonical_paths: set[str] = set()
    for name in REPORT_ARTIFACTS:
        record = artifacts[name]
        if not isinstance(record, Mapping):
            raise BuildError(f"artifact {name} must be an object")
        path_text = record.get("path")
        expected_hash = record.get("sha256")
        if not isinstance(path_text, str) or not isinstance(expected_hash, str):
            raise BuildError(f"artifact {name} path/hash must be strings")
        path = Path(path_text)
        if not path.is_absolute() or path_text != str(path.resolve()):
            raise BuildError(f"artifact {name} path is not canonical absolute")
        if path_text in canonical_paths:
            raise BuildError(f"artifact {name} path is duplicated")
        canonical_paths.add(path_text)
        if _SHA256_RE.fullmatch(expected_hash) is None:
            raise BuildError(f"artifact {name} SHA-256 is malformed")
        try:
            actual_hash = sha256_file(path)
        except OSError as exc:
            raise BuildError(f"cannot hash artifact {name}: {exc}") from exc
        if not hmac.compare_digest(actual_hash, expected_hash):
            raise BuildError(f"artifact {name} SHA-256 mismatch")
    return True


def _resolved_config(config: BuildConfig) -> BuildConfig:
    return BuildConfig(
        base=config.base.resolve(),
        battle_logic_as=config.battle_logic_as.resolve(),
        output_apk=config.output_apk.resolve(),
        report=config.report.resolve(),
        work=config.work.resolve(),
        ffdec=config.ffdec.resolve(),
        java=config.java.resolve(),
        zipalign=config.zipalign.resolve(),
        apksigner=config.apksigner.resolve(),
        keystore=config.keystore.resolve(),
        keystore_password_env=config.keystore_password_env,
    )


def _required_files(config: BuildConfig) -> dict[str, Path]:
    return {
        "base APK": config.base,
        "patched BattleCharacterLogic AS": config.battle_logic_as,
        "FFDec jar": config.ffdec,
        "Java executable": config.java,
        "zipalign executable": config.zipalign,
        "apksigner executable": config.apksigner,
        "signing keystore": config.keystore,
    }


def _validate_destination_paths(config: BuildConfig) -> None:
    required_files = _required_files(config)
    output_key = os.path.normcase(str(config.output_apk))
    report_key = os.path.normcase(str(config.report))
    if output_key == report_key:
        raise BuildError("APK output and verification report must be different paths")
    protected = {
        os.path.normcase(str(path)): label for label, path in required_files.items()
    }
    for label, path, key in (
        ("APK output", config.output_apk, output_key),
        ("verification report", config.report, report_key),
    ):
        if key in protected:
            raise BuildError(f"{label} would overwrite {protected[key]}: {path}")


def _preflight(config: BuildConfig) -> None:
    required_files = _required_files(config)
    for label, path in required_files.items():
        if not path.is_file():
            raise BuildError(f"{label} is not a file: {path}")

    env_name = config.keystore_password_env
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", env_name) is None:
        raise BuildError("keystore password environment variable name is invalid")
    if env_name not in os.environ:
        raise BuildError(f"required environment variable is not set: {env_name}")

    try:
        source_text = config.battle_logic_as.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise BuildError(f"cannot read patched ActionScript: {exc}") from exc
    abyss_patch.verify_text(source_text, require_markers=True)


def _remove_final_pair(
    output_apk: Path,
    report: Path,
    original_error: BaseException | None = None,
) -> None:
    failures: list[str] = []
    for path in (output_apk, report):
        try:
            path.unlink(missing_ok=True)
        except BaseException as exc:
            failures.append(f"{path}: {type(exc).__name__}: {exc}")
    if not failures:
        return
    message = "failed to remove final output pair: " + "; ".join(failures)
    if original_error is not None:
        original_error.add_note(message)
        return
    raise BuildError(message)


def _extract_original_swf(base_apk: Path, destination: Path) -> None:
    with zipfile.ZipFile(base_apk, "r") as archive:
        matches = [
            member
            for member in archive.infolist()
            if member.filename == TARGET_SWF_MEMBER
        ]
        if len(matches) != 1:
            raise BuildError(
                f"expected exactly one {TARGET_SWF_MEMBER}, found {len(matches)}"
            )
        destination.write_bytes(archive.read(matches[0]))


def _run_external(command: Sequence[Path | str]) -> None:
    subprocess.run([str(value) for value in command], check=True)


def subprocess_runner(
    command: Sequence[Path | str],
    *,
    check: bool,
    cwd: Path | str,
    env: Mapping[str, str],
) -> subprocess.CompletedProcess[Any]:
    """Run one stage command with an explicit working directory/environment."""
    return subprocess.run(
        [str(value) for value in command],
        check=check,
        cwd=str(cwd),
        env=dict(env),
    )


def _run_stage_external(
    command: Sequence[Path | str],
    *,
    runner: Runner,
    cwd: Path,
    environment: Mapping[str, str],
) -> None:
    runner(
        [str(value) for value in command],
        check=True,
        cwd=cwd,
        env=dict(environment),
    )


def _require_created(path: Path, label: str) -> None:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise BuildError(f"{label} was not created: {path}") from exc
    if not path.is_file() or size <= 0:
        raise BuildError(f"{label} is empty or not a file: {path}")


def _export_target_class(
    swf: Path | str,
    export_dir: Path | str,
    ffdec: Path | str,
    java: Path | str,
    *,
    verify_gate: bool,
    runner: Runner | None = None,
    cwd: Path | None = None,
    environment: Mapping[str, str] | None = None,
) -> Path:
    """Export exactly the target class, optionally verifying the abyss gate."""
    swf_path = Path(swf)
    export_root = Path(export_dir)
    ffdec_path = Path(ffdec)
    java_path = Path(java)
    for label, path in (
        ("SWF", swf_path),
        ("FFDec jar", ffdec_path),
        ("Java executable", java_path),
    ):
        if not path.is_file():
            raise BuildError(f"{label} is not a file: {path}")
    if export_root.exists() and any(export_root.iterdir()):
        raise BuildError(f"class export directory is not empty: {export_root}")
    export_root.mkdir(parents=True, exist_ok=True)
    command = (
        java_path,
        "-jar",
        ffdec_path,
        "-onerror",
        "abort",
        "-selectclass",
        TARGET_CLASS,
        "-export",
        "script",
        export_root,
        swf_path,
    )
    if runner is None:
        _run_external(command)
    else:
        if cwd is None or environment is None:
            raise BuildError("stage class export requires cwd and environment")
        _run_stage_external(
            command,
            runner=runner,
            cwd=cwd,
            environment=environment,
        )

    reexports = sorted(
        path for path in export_root.rglob("BattleCharacterLogic.as")
        if path.is_file()
    )
    expected = export_root / TARGET_CLASS_EXPORT
    if len(reexports) != 1 or reexports[0] != expected:
        raise BuildError(
            "expected exactly one BattleCharacterLogic.as at "
            f"{TARGET_CLASS_EXPORT.as_posix()}, found "
            f"{[path.relative_to(export_root).as_posix() for path in reexports]}"
        )
    _require_created(expected, "FFDec exported BattleCharacterLogic.as")
    exported_as = expected.resolve()
    if verify_gate:
        try:
            exported_text = exported_as.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError) as exc:
            raise BuildError(f"cannot read re-exported ActionScript: {exc}") from exc
        abyss_patch.verify_text(exported_text, require_markers=False)
    return exported_as


def export_verified_class(
    swf: Path | str,
    export_dir: Path | str,
    ffdec: Path | str,
    java: Path | str,
) -> Path:
    """Export and markerless-verify the exact gated class from one SWF."""
    return _export_target_class(
        swf,
        export_dir,
        ffdec,
        java,
        verify_gate=True,
    )


def _path_key(path: Path) -> str:
    return os.path.normcase(str(path.resolve()))


def _require_safe_stage_topology(
    output: Path, work: Path, profile: Path
) -> None:
    for label, directory in (("work", work), ("profile", profile)):
        try:
            directory.relative_to(output)
        except ValueError:
            continue
        raise BuildError(
            f"output SWF cannot equal or contain the {label} directory"
        )


def _require_handle_bound_publish_support() -> None:
    if os.name != "nt":
        raise BuildError(
            "abyss SWF stage requires Windows handle-bound no-replace rename"
        )


def _require_distinct_new_output(source: Path, output: Path) -> None:
    if _path_key(source) == _path_key(output):
        raise BuildError("source and output SWF must be different paths")
    if os.path.lexists(output):
        try:
            if os.path.samefile(source, output):
                raise BuildError("source and output SWF are filesystem aliases")
        except OSError:
            pass
        raise BuildError(f"output SWF already exists: {output}")


def _assert_source_hash(source: Path, expected: str) -> None:
    try:
        actual = sha256_file(source)
    except OSError as exc:
        raise BuildError("source SWF became unreadable during stage") from exc
    if not hmac.compare_digest(actual, expected):
        raise BuildError("source SWF changed during stage")


def _copy_snapshot(source: Path, destination: Path) -> None:
    with source.open("rb") as source_handle, destination.open("xb") as target:
        shutil.copyfileobj(source_handle, target, 1024 * 1024)
        target.flush()
        os.fsync(target.fileno())


def _identity_from_stat(result: os.stat_result, label: str) -> FileIdentity:
    if not stat.S_ISREG(result.st_mode):
        raise BuildError(f"{label} is not a regular file")
    identity = (int(result.st_dev), int(result.st_ino))
    if identity[0] == 0 or identity[1] == 0:
        raise BuildError(f"{label} has no stable nonzero file identity")
    return identity


def _file_identity(
    path: Path, label: str, *, missing_ok: bool = False
) -> FileIdentity | None:
    try:
        result = path.stat(follow_symlinks=False)
    except FileNotFoundError:
        if missing_ok:
            return None
        raise BuildError(f"{label} disappeared") from None
    except OSError as exc:
        raise BuildError(f"cannot inspect {label} identity") from exc
    return _identity_from_stat(result, label)


def _require_file_identity(
    path: Path, expected: FileIdentity, label: str
) -> None:
    if _file_identity(path, label) != expected:
        raise BuildError(f"{label} identity changed")


def _sha256_staged_handle(staging: _OwnedStagedFile) -> str:
    try:
        if (
            _identity_from_stat(
                os.fstat(staging.handle.fileno()), "staged output SWF handle"
            )
            != staging.identity
        ):
            raise BuildError("staged output SWF handle identity changed")
        position = staging.handle.tell()
        staging.handle.seek(0)
        digest = hashlib.sha256()
        while chunk := staging.handle.read(1024 * 1024):
            digest.update(chunk)
        staging.handle.seek(position)
        return digest.hexdigest()
    except OSError as exc:
        raise BuildError("cannot hash staged output SWF handle") from exc


def _windows_file_api():
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateFileW.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.SetFileInformationByHandle.argtypes = (
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    )
    kernel32.SetFileInformationByHandle.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    return ctypes, wintypes, kernel32


def _create_staging_handle(path: Path):
    import msvcrt

    ctypes, _wintypes, kernel32 = _windows_file_api()
    generic_read = 0x80000000
    generic_write = 0x40000000
    delete_access = 0x00010000
    share_read_delete = 0x00000001 | 0x00000004
    create_new = 1
    temporary_attribute = 0x00000100
    raw_handle = kernel32.CreateFileW(
        str(path),
        generic_read | generic_write | delete_access,
        share_read_delete,
        None,
        create_new,
        temporary_attribute,
        None,
    )
    if raw_handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        descriptor = msvcrt.open_osfhandle(
            raw_handle, os.O_RDWR | os.O_BINARY
        )
    except BaseException:
        kernel32.CloseHandle(raw_handle)
        raise
    return os.fdopen(descriptor, "w+b")


def _mark_staging_handle_for_delete(staging: _OwnedStagedFile) -> None:
    import ctypes
    import msvcrt
    from ctypes import wintypes

    class FileDispositionInfo(ctypes.Structure):
        _fields_ = (("DeleteFile", wintypes.BOOLEAN),)

    _ctypes, _wintypes, kernel32 = _windows_file_api()
    disposition = FileDispositionInfo(True)
    raw_handle = msvcrt.get_osfhandle(staging.handle.fileno())
    if not kernel32.SetFileInformationByHandle(
        raw_handle,
        4,
        ctypes.byref(disposition),
        ctypes.sizeof(disposition),
    ):
        raise ctypes.WinError(ctypes.get_last_error())


def _rename_staging_handle_no_replace(
    staging: _OwnedStagedFile, destination: Path
) -> None:
    import ctypes
    import msvcrt
    from ctypes import wintypes

    class FileRenameInfo(ctypes.Structure):
        _fields_ = (
            ("ReplaceIfExists", wintypes.BOOLEAN),
            ("RootDirectory", wintypes.HANDLE),
            ("FileNameLength", wintypes.DWORD),
            ("FileName", wintypes.WCHAR * 1),
        )

    _ctypes, _wintypes, kernel32 = _windows_file_api()
    file_name = str(destination).encode("utf-16-le")
    buffer_size = FileRenameInfo.FileName.offset + len(file_name)
    buffer = ctypes.create_string_buffer(buffer_size + 2)
    rename = FileRenameInfo.from_buffer(buffer)
    rename.ReplaceIfExists = False
    rename.RootDirectory = None
    rename.FileNameLength = len(file_name)
    ctypes.memmove(
        ctypes.addressof(buffer) + FileRenameInfo.FileName.offset,
        file_name,
        len(file_name),
    )
    raw_handle = msvcrt.get_osfhandle(staging.handle.fileno())
    if not kernel32.SetFileInformationByHandle(
        raw_handle, 3, buffer, buffer_size + 2
    ):
        raise ctypes.WinError(ctypes.get_last_error())


def _cleanup_owned_staging(staging: _OwnedStagedFile) -> None:
    current = _file_identity(
        staging.path, "staged output SWF", missing_ok=True
    )
    identity_changed = current is not None and current != staging.identity
    disposition_error: OSError | None = None
    try:
        _mark_staging_handle_for_delete(staging)
    except OSError as exc:
        disposition_error = exc
    try:
        staging.handle.close()
    except OSError as exc:
        raise BuildError("failed to close staged output SWF") from exc
    remaining = _file_identity(
        staging.path, "staged output SWF", missing_ok=True
    )
    if identity_changed:
        raise BuildError("staged output SWF identity changed before cleanup")
    if remaining is not None:
        if remaining != staging.identity:
            raise BuildError("staged output SWF was replaced during cleanup")
        raise BuildError("staged output SWF remains after cleanup")
    if disposition_error is not None and current is not None:
        raise BuildError("failed to delete staged output SWF by handle") from (
            disposition_error
        )


def _stage_output_sibling(
    source: Path, destination: Path, expected_hash: str
) -> _OwnedStagedFile:
    """Copy a verified candidate to a private sibling of the final output."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    handle: Any | None = None
    owned: _OwnedStagedFile | None = None
    try:
        for _attempt in range(128):
            temporary = destination.parent / (
                f".{destination.name}.{secrets.token_hex(16)}.tmp"
            )
            try:
                handle = _create_staging_handle(temporary)
            except FileExistsError:
                continue
            break
        if handle is None or temporary is None:
            raise BuildError("cannot allocate a unique staged output SWF")
        owned = _OwnedStagedFile(
            temporary,
            _identity_from_stat(
                os.fstat(handle.fileno()), "staged output SWF"
            ),
            handle,
        )
        with source.open("rb") as source_handle:
            shutil.copyfileobj(source_handle, handle, 1024 * 1024)
        handle.flush()
        os.fsync(handle.fileno())
        _require_file_identity(
            owned.path, owned.identity, "staged output SWF"
        )
        staged_hash = _sha256_staged_handle(owned)
        _require_file_identity(
            owned.path, owned.identity, "staged output SWF"
        )
        if not hmac.compare_digest(staged_hash, expected_hash):
            raise BuildError("staged output SWF hash mismatch")
        return owned
    except BaseException as original_error:
        if owned is not None:
            try:
                _cleanup_owned_staging(owned)
            except BaseException as cleanup_error:
                original_error.add_note(
                    "failed to clean owned staged output after staging error: "
                    f"{type(cleanup_error).__name__}: {cleanup_error}"
                )
        elif temporary is not None:
            original_error.add_note(
                "staged output identity was unavailable; path was preserved"
            )
            if handle is not None:
                try:
                    handle.close()
                except BaseException as cleanup_error:
                    original_error.add_note(
                        "failed to close unidentified staged output: "
                        f"{type(cleanup_error).__name__}: {cleanup_error}"
                    )
        raise


def _publish_staged_exclusive(
    staging: _OwnedStagedFile, destination: Path, expected_hash: str
) -> None:
    """Commit the verified handle as the final no-replace operation."""
    _require_file_identity(
        staging.path, staging.identity, "staged output SWF"
    )
    staged_hash = _sha256_staged_handle(staging)
    _require_file_identity(
        staging.path, staging.identity, "staged output SWF"
    )
    if not hmac.compare_digest(staged_hash, expected_hash):
        raise BuildError("staged output SWF hash mismatch before publication")
    try:
        _rename_staging_handle_no_replace(staging, destination)
    except FileExistsError as exc:
        raise BuildError(f"output SWF already exists: {destination}") from exc
    except OSError as exc:
        raise BuildError("failed to publish output SWF atomically") from exc

    # The handle-bound no-replace rename above is the single commit point.
    # Closing the already-committed handle must never trigger path rollback.
    try:
        staging.handle.close()
    except OSError:
        pass


def _clean_transaction_before_publish(transaction: Path) -> None:
    try:
        shutil.rmtree(transaction)
    except Exception as exc:
        raise BuildError(
            "failed to clean abyss SWF stage transaction before publication"
        ) from exc


def apply_gate_to_swf(
    source_swf: Path,
    output_swf: Path,
    *,
    ffdec: Path,
    java: Path,
    profile_dir: Path,
    work_dir: Path,
    runner: Runner = subprocess_runner,
) -> PatchStageReport:
    """Apply and reopen-verify the abyss gate without constructing an APK."""
    _require_handle_bound_publish_support()
    source = Path(source_swf).resolve()
    output = Path(output_swf).resolve()
    ffdec_path = Path(ffdec).resolve()
    java_path = Path(java).resolve()
    profile = Path(profile_dir).resolve()
    work = Path(work_dir).resolve()

    _require_safe_stage_topology(output, work, profile)
    _require_distinct_new_output(source, output)
    for label, path in (
        ("source SWF", source),
        ("FFDec jar", ffdec_path),
        ("Java executable", java_path),
    ):
        if not path.is_file():
            raise BuildError(f"{label} is not a file: {path}")
    for label, path in (("profile directory", profile), ("work directory", work)):
        if path.exists() and not path.is_dir():
            raise BuildError(f"{label} is not a directory: {path}")

    input_sha256 = sha256_file(source)
    work.mkdir(parents=True, exist_ok=True)
    profile.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment["APPDATA"] = str(profile)
    transaction: Path | None = None
    staged_output: _OwnedStagedFile | None = None
    original_error: BaseException | None = None
    try:
        transaction = Path(
            tempfile.mkdtemp(prefix=".abyss-swf-stage-", dir=work)
        ).resolve()
        snapshot = transaction / "source.swf"
        base_export_dir = transaction / "base-export"
        patched_as = transaction / "BattleCharacterLogic.patched.as"
        injected_swf = transaction / "abyss-gate.swf"
        reopen_export_dir = transaction / "reopen-export"

        _copy_snapshot(source, snapshot)
        if not hmac.compare_digest(sha256_file(snapshot), input_sha256):
            raise BuildError("source SWF changed while creating the stage snapshot")
        _assert_source_hash(source, input_sha256)

        base_as = _export_target_class(
            snapshot,
            base_export_dir,
            ffdec_path,
            java_path,
            verify_gate=False,
            runner=runner,
            cwd=transaction,
            environment=environment,
        )
        _assert_source_hash(source, input_sha256)
        before_method_sha256 = sha256_file(base_as)

        match_count = abyss_patch.patch_file(base_as, patched_as)
        if match_count != 1:
            raise BuildError(
                f"expected exactly one abyss gate insertion, found {match_count}"
            )
        abyss_patch.verify_file(patched_as, require_markers=True)
        _assert_source_hash(source, input_sha256)

        _run_stage_external(
            (
                java_path,
                "-jar",
                ffdec_path,
                "-air",
                "-onerror",
                "abort",
                "-replace",
                snapshot,
                injected_swf,
                TARGET_CLASS,
                patched_as,
            ),
            runner=runner,
            cwd=transaction,
            environment=environment,
        )
        _assert_source_hash(source, input_sha256)
        _require_created(injected_swf, "FFDec injected SWF")

        reopened_as = _export_target_class(
            injected_swf,
            reopen_export_dir,
            ffdec_path,
            java_path,
            verify_gate=True,
            runner=runner,
            cwd=transaction,
            environment=environment,
        )
        _assert_source_hash(source, input_sha256)
        output_sha256 = sha256_file(injected_swf)
        if hmac.compare_digest(output_sha256, input_sha256):
            raise BuildError("abyss stage output SWF is byte-identical to its input")
        after_method_sha256 = sha256_file(reopened_as)
        report = PatchStageReport(
            stage="abyss-mode-equipment",
            output_path=output,
            input_sha256=input_sha256,
            output_sha256=output_sha256,
            target_class=TARGET_CLASS,
            before_method_sha256=before_method_sha256,
            after_method_sha256=after_method_sha256,
            match_count=match_count,
        )

        _assert_source_hash(source, input_sha256)
        staged_output = _stage_output_sibling(
            injected_swf, output, output_sha256
        )

        cleanup_target = transaction
        _clean_transaction_before_publish(cleanup_target)
        transaction = None

        _assert_source_hash(source, input_sha256)
        _publish_staged_exclusive(staged_output, output, output_sha256)
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
                    raise BuildError(
                        "failed to clean abyss SWF stage transaction"
                    ) from cleanup_error
                original_error.add_note(
                    "failed to clean abyss SWF stage transaction: "
                    f"{type(cleanup_error).__name__}: {cleanup_error}"
                )
        if staged_output is not None:
            try:
                _cleanup_owned_staging(staged_output)
            except BaseException as cleanup_error:
                if original_error is None:
                    if isinstance(cleanup_error, BuildError):
                        raise
                    raise BuildError("failed to clean staged output SWF") from (
                        cleanup_error
                    )
                original_error.add_note(
                    "failed to clean staged output SWF: "
                    f"{type(cleanup_error).__name__}: {cleanup_error}"
                )


def _artifact_record(report_path: Path, hash_path: Path | None = None) -> dict[str, str]:
    canonical = report_path.resolve()
    return {
        "path": str(canonical),
        "sha256": sha256_file(hash_path or canonical),
    }


def _build_report(
    patched_as: Path,
    injected_swf: Path,
    signed_apk_stage: Path,
    final_apk: Path,
    reexported_as: Path,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "status": "verified",
        "class_name": TARGET_CLASS,
        "artifacts": {
            "patched_as": _artifact_record(patched_as),
            "injected_swf": _artifact_record(injected_swf),
            "signed_apk": _artifact_record(final_apk, signed_apk_stage),
            "reexported_as": _artifact_record(reexported_as),
        },
    }


def _stage_copy(source: Path, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            with source.open("rb") as source_handle:
                shutil.copyfileobj(source_handle, handle, 1024 * 1024)
            handle.flush()
            os.fsync(handle.fileno())
        return temporary
    except BaseException:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise


def _stage_report(data: Mapping[str, Any], destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = (
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        return temporary
    except BaseException:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise


def build_verified_apk(config: BuildConfig) -> dict[str, Any]:
    """Run the complete build and publish a final APK/report pair on success only."""
    config = _resolved_config(config)
    _validate_destination_paths(config)
    _remove_final_pair(config.output_apk, config.report)
    transaction: Path | None = None
    final_stages: list[Path] = []
    try:
        config.output_apk.parent.mkdir(parents=True, exist_ok=True)
        config.report.parent.mkdir(parents=True, exist_ok=True)
        config.work.mkdir(parents=True, exist_ok=True)
        _preflight(config)
        transaction = Path(
            tempfile.mkdtemp(prefix=".abyss-apk-build-", dir=config.work)
        ).resolve()
        original_swf = transaction / "original.swf"
        injected_swf = transaction / "injected.swf"
        verify_export = transaction / "verify_export"
        unsigned_apk = transaction / "unsigned.apk"
        aligned_apk = transaction / "aligned.apk"
        signed_apk = transaction / "signed.apk"

        _extract_original_swf(config.base, original_swf)
        _run_external(
            (
                config.java,
                "-jar",
                config.ffdec,
                "-air",
                "-onerror",
                "abort",
                "-replace",
                original_swf,
                injected_swf,
                TARGET_CLASS,
                config.battle_logic_as,
            )
        )
        _require_created(injected_swf, "FFDec injected SWF")

        reexported_as = export_verified_class(
            injected_swf,
            verify_export,
            config.ffdec,
            config.java,
        )

        rewrite_apk(config.base, unsigned_apk, injected_swf)
        _run_external(
            (config.zipalign, "-p", "-f", "4", unsigned_apk, aligned_apk)
        )
        _require_created(aligned_apk, "zipaligned APK")
        _run_external(
            (
                config.apksigner,
                "sign",
                "--v4-signing-enabled",
                "false",
                "--ks",
                config.keystore,
                "--ks-pass",
                f"env:{config.keystore_password_env}",
                "--out",
                signed_apk,
                aligned_apk,
            )
        )
        _require_created(signed_apk, "signed APK")
        _run_external(
            (
                config.apksigner,
                "verify",
                "--verbose",
                "--print-certs",
                signed_apk,
            )
        )

        report_data = _build_report(
            config.battle_logic_as,
            injected_swf,
            signed_apk,
            config.output_apk,
            reexported_as,
        )
        apk_stage = _stage_copy(signed_apk, config.output_apk)
        final_stages.append(apk_stage)
        report_stage = _stage_report(report_data, config.report)
        final_stages.append(report_stage)

        os.replace(apk_stage, config.output_apk)
        final_stages.remove(apk_stage)
        os.replace(report_stage, config.report)
        final_stages.remove(report_stage)
        validate_verification_report(config.report)
        return report_data
    except BaseException as original_error:
        _remove_final_pair(
            config.output_apk,
            config.report,
            original_error=original_error,
        )
        for stage in final_stages:
            try:
                stage.unlink(missing_ok=True)
            except BaseException as cleanup_error:
                original_error.add_note(
                    "failed to clean staged final output: "
                    f"{type(cleanup_error).__name__}: {cleanup_error}"
                )
        if transaction is not None:
            try:
                shutil.rmtree(transaction)
            except BaseException as cleanup_error:
                original_error.add_note(
                    "failed to clean build transaction: "
                    f"{type(cleanup_error).__name__}: {cleanup_error}"
                )
        raise


def _parse_args(argv: Sequence[str] | None) -> BuildConfig:
    parser = argparse.ArgumentParser(
        description="Build, sign, and re-decompile the abyss gate client APK."
    )
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--battle-logic-as", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path, dest="output_apk")
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--ffdec", required=True, type=Path)
    parser.add_argument("--java", required=True, type=Path)
    parser.add_argument("--zipalign", required=True, type=Path)
    parser.add_argument("--apksigner", required=True, type=Path)
    parser.add_argument("--ks", required=True, type=Path, dest="keystore")
    parser.add_argument(
        "--ks-pass-env", required=True, dest="keystore_password_env"
    )
    return BuildConfig(**vars(parser.parse_args(argv)))


def _redacted_error(error: BaseException, env_name: str) -> str:
    message = str(error)
    secret = os.environ.get(env_name)
    if secret:
        message = message.replace(secret, "<redacted>")
    return message


def main(argv: Sequence[str] | None = None) -> int:
    config = _parse_args(argv)
    try:
        report = build_verified_apk(config)
    except KeyboardInterrupt:
        print("[CANCELLED] client APK build cancelled; no final outputs kept.", file=sys.stderr)
        return 130
    except (
        BuildError,
        abyss_patch.PatchError,
        OSError,
        UnicodeError,
        zipfile.BadZipFile,
        subprocess.CalledProcessError,
    ) as exc:
        print(
            f"[ERROR] client APK build failed: "
            f"{_redacted_error(exc, config.keystore_password_env)}",
            file=sys.stderr,
        )
        return 1
    signed = report["artifacts"]["signed_apk"]
    print(
        f"[OK] verified APK {signed['path']} sha256={signed['sha256']}; "
        f"report={config.report.resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
