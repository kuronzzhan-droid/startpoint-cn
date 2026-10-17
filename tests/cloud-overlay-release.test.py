#!/usr/bin/env python3
"""Cloud overlay release regressions using only disposable local Git repositories."""

import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile


TOOL = Path(__file__).resolve().parents[1] / "tools" / "build-cloud-overlay.py"
# Importing the builder should not leave generated files in the shared source tree.
sys.dont_write_bytecode = True


class CloudOverlayReleaseTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="cloud-overlay-release-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.origin = self.root / "origin.git"
        self.run_git("init", "--bare", str(self.origin), cwd=self.root)
        self.run_git("init", "-b", "main")
        self.run_git("config", "user.name", "Overlay Test")
        self.run_git("config", "user.email", "overlay@example.invalid")
        self.run_git("config", "core.autocrlf", "false")
        self.run_git("remote", "add", "origin", str(self.origin))
        self.write("src/runtime.txt", b"old runtime\n")
        self.write("out/runtime.js", b"old output\n")
        self.base = self.commit("initial runtime")
        self.run_git("push", "-u", "origin", "main")
        self.write("src/runtime.txt", b"new runtime\n")
        self.write("out/runtime.js", b"new output\n")
        self.write("src/new-runtime.txt", b"new file\n")
        self.head = self.commit("runtime update")
        spec = importlib.util.spec_from_file_location("cloud_overlay_under_test", TOOL)
        self.tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.tool)
        self.tool.REPO = str(self.repo)
        self.tool.OUT_ROOT = str(self.root / "packages")
        self.tool.RECORD = str(self.root / "delivery.json")
        Path(self.tool.RECORD).write_text(json.dumps({"latest_delivery": {"batch": "old"}}), encoding="utf-8")

    def run_git(self, *args, cwd=None):
        return subprocess.run(["git", *args], cwd=cwd or self.repo, check=True,
                              capture_output=True, text=True).stdout.strip()

    def write(self, path, content):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def commit(self, message):
        # Only this throwaway repository is ever staged or committed.
        paths = self.run_git("ls-files", "--modified", "--others", "--exclude-standard").splitlines()
        self.run_git("add", "--", *paths)
        self.run_git("commit", "-m", message)
        return self.run_git("rev-parse", "HEAD")

    def invoke(self, *args):
        output = io.StringIO()
        with mock.patch.object(sys, "argv", [str(TOOL), *args]), contextlib.redirect_stdout(output):
            self.tool.main()
        return json.loads(output.getvalue())

    def worktree_snapshot(self):
        return {p.relative_to(self.repo).as_posix(): p.read_bytes()
                for p in self.repo.rglob("*") if p.is_file() and ".git" not in p.relative_to(self.repo).parts}

    def release_tag(self, sequence=1):
        from datetime import datetime, timezone, timedelta
        date = datetime.now(timezone(timedelta(hours=8))).strftime("%Y.%m.%d")
        return f"release-{date}-{sequence}"

    @contextlib.contextmanager
    def gh_checks(self, conclusion="success", head_sha=None, check_runs=None):
        real_run = subprocess.run
        calls = []

        def run(command, *args, **kwargs):
            if command[0] == "gh":
                calls.append(command)
                body = {"check_runs": check_runs if check_runs is not None else [
                    {"id": 3, "name": "hygiene", "head_sha": head_sha or self.head,
                     "status": "completed", "conclusion": conclusion}]}
                return subprocess.CompletedProcess(command, 0, json.dumps(body), "")
            return real_run(command, *args, **kwargs)

        # API lookup uses a GitHub-shaped origin; Git transports still target the local bare repository.
        self.run_git("config", "remote.origin.url", "https://github.com/example/overlay-test.git")
        self.run_git("config", "url." + str(self.origin) + ".insteadOf", "https://github.com/example/overlay-test.git")
        with mock.patch.object(self.tool.subprocess, "run", side_effect=run):
            yield calls

    def test_only_pack_has_no_git_side_effect_and_reports_unpushed(self):
        before = self.run_git("rev-list", "--all", "--count")
        result = self.invoke("--batch", "plain", "--base", self.base)
        self.assertEqual(self.run_git("rev-parse", "HEAD"), self.head)
        self.assertEqual(self.run_git("rev-list", "--all", "--count"), before)
        self.assertEqual(self.run_git("tag", "--list"), "")
        self.assertEqual(self.run_git("ls-remote", "--tags", "origin"), "")
        latest = json.loads(Path(self.tool.RECORD).read_text(encoding="utf-8"))["latest_delivery"]
        self.assertIsNone(latest["source_status"]["pushed"])
        self.assertEqual(latest["source_status"]["branch"], "main")
        with zipfile.ZipFile(result["zip"]) as archive:
            self.assertEqual(archive.read("src/runtime.txt"), b"new runtime\n")
            self.assertIsNone(archive.testzip())
        digest = hashlib.sha256(Path(result["zip"]).read_bytes()).hexdigest()
        self.assertEqual(digest, result["sha256"])

    def test_release_tag_defaults_batch_but_does_not_publish(self):
        tag = self.release_tag()
        result = self.invoke("--release-tag", tag, "--base", self.base)
        self.assertEqual(result["batch"], tag)
        self.assertEqual(Path(result["zip"]).parent.name, tag)
        self.assertEqual(self.run_git("tag", "--list"), "")
        latest = json.loads(Path(self.tool.RECORD).read_text(encoding="utf-8"))["latest_delivery"]
        self.assertEqual(latest["release_tag"], tag)
        self.assertFalse(latest["tag_publication"]["pushed"])

    def test_partial_write_failure_does_not_publish_and_same_batch_can_retry(self):
        record_before = Path(self.tool.RECORD).read_bytes()
        def partial_write(filename, members, *args):
            with zipfile.ZipFile(filename, "w") as archive:
                archive.writestr(members[0], b"incomplete but readable archive")
            raise OSError("injected interrupted archive write")
        with mock.patch.object(self.tool, "build_zip", side_effect=partial_write):
            with self.assertRaisesRegex(OSError, "interrupted archive write"):
                self.invoke("--batch", "retry-write", "--base", self.base)
        folder = Path(self.tool.OUT_ROOT) / "retry-write"
        self.assertEqual(list(folder.iterdir()), [])
        self.assertEqual(Path(self.tool.RECORD).read_bytes(), record_before)
        result = self.invoke("--batch", "retry-write", "--base", self.base)
        self.assertTrue(Path(result["zip"]).is_file())
        with zipfile.ZipFile(result["zip"]) as archive:
            self.assertEqual(archive.read("out/runtime.js"), b"new output\n")

    def test_verification_failure_does_not_publish_and_same_batch_can_retry(self):
        record_before = Path(self.tool.RECORD).read_bytes()
        with mock.patch.object(self.tool, "verify_zip", side_effect=SystemExit("injected member verification failure")):
            with self.assertRaisesRegex(SystemExit, "member verification failure"):
                self.invoke("--batch", "retry-verify", "--base", self.base)
        folder = Path(self.tool.OUT_ROOT) / "retry-verify"
        self.assertEqual(list(folder.iterdir()), [])
        self.assertEqual(Path(self.tool.RECORD).read_bytes(), record_before)
        result = self.invoke("--batch", "retry-verify", "--base", self.base)
        self.assertTrue(Path(result["zip"]).is_file())

    def test_publication_race_cannot_overwrite_existing_formal_archive(self):
        real_verify = self.tool.verify_zip
        folder = Path(self.tool.OUT_ROOT) / "race"
        destination = folder / "startpoint-cn-cloud-overlay-race.zip"
        def competing_publication(*args):
            real_verify(*args)
            destination.write_bytes(b"independently published archive")
        with mock.patch.object(self.tool, "verify_zip", side_effect=competing_publication):
            with self.assertRaisesRegex(SystemExit, "已存在"):
                self.invoke("--batch", "race", "--base", self.base)
        self.assertEqual(destination.read_bytes(), b"independently published archive")
        self.assertEqual(list(folder.iterdir()), [destination])

    def test_cdn_zip_bytes_and_inner_production_are_preserved(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("production/android_upload/character.bin", b"client resource\x00\xff")
            archive.writestr("metadata.txt", b"archive metadata")
        payload = buffer.getvalue()
        archive_path = "assets/asset-patch/active/archive-diff.zip"
        self.write(archive_path, payload)
        self.write("assets/asset-patch/manifest.json", b'{"patches": []}\n')
        for path in ("config/private.json", ".cdn/archive.zip", "production/loose.bin",
                     "assets/asset-patch/production/loose.bin", "docs/unrelated.md",
                     "assets/asset-patch/audit/receipt.json"):
            self.write(path, b"excluded")
        self.commit("asset patch and exclusions")
        result = self.invoke("--batch", "cdn", "--base", self.base)
        with zipfile.ZipFile(result["zip"]) as archive:
            self.assertEqual(archive.read(archive_path), payload)
            self.assertEqual(set(archive.namelist()), {"src/runtime.txt", "out/runtime.js", "src/new-runtime.txt",
                                                       archive_path, "assets/asset-patch/manifest.json"})
        latest = json.loads(Path(self.tool.RECORD).read_text(encoding="utf-8"))["latest_delivery"]
        self.assertTrue(latest["validation"]["cdn_archives_included"])

    def test_rollback_uses_old_blobs_and_lists_deletions_without_changing_worktree(self):
        self.run_git("tag", "-a", "historical-source", self.base, "-m", "historical snapshot")
        self.write("src/runtime.txt", b"uncommitted local edit\n")
        before = self.worktree_snapshot()
        status = self.run_git("status", "--porcelain")
        result = self.invoke("--batch", "rollback", "--source", "historical-source", "--base", self.head)
        with zipfile.ZipFile(result["zip"]) as archive:
            self.assertEqual(archive.read("src/runtime.txt"), b"old runtime\n")
            self.assertEqual(archive.read("out/runtime.js"), b"old output\n")
            self.assertNotIn("src/new-runtime.txt", archive.namelist())
        deletions = Path(result["zip"] + ".delete-files.txt").read_text(encoding="utf-8")
        files = Path(result["zip"] + ".files.txt").read_text(encoding="utf-8")
        self.assertIn("src/new-runtime.txt", deletions)
        self.assertIn("src/new-runtime.txt", files)
        self.assertEqual(self.run_git("rev-parse", "HEAD"), self.head)
        self.assertEqual(self.run_git("status", "--porcelain"), status)
        self.assertEqual(self.worktree_snapshot(), before)

    def test_publish_creates_only_annotated_tag_after_package_verification(self):
        self.run_git("push", "origin", "main")
        before_refs = self.run_git("ls-remote", "--refs", "origin")
        before_count = self.run_git("rev-list", "--all", "--count")
        snapshot = self.worktree_snapshot()
        tag = self.release_tag()
        verified = []
        real_verify = self.tool.verify_zip

        def verify(*args, **kwargs):
            real_verify(*args, **kwargs)
            verified.append(True)

        real_publish = self.tool.publish_release_tag

        def publish(*args, **kwargs):
            self.assertTrue(verified, "tag publication must follow ZIP validation")
            return real_publish(*args, **kwargs)

        with self.gh_checks() as calls, mock.patch.object(self.tool, "verify_zip", side_effect=verify), \
                mock.patch.object(self.tool, "publish_release_tag", side_effect=publish):
            self.invoke("--release-tag", tag, "--publish-tag", "--base", self.base)
        self.assertTrue(calls)
        self.assertEqual(self.run_git("cat-file", "-t", tag), "tag")
        self.assertEqual(self.run_git("rev-parse", tag + "^{}"), self.head)
        after_refs = self.run_git("ls-remote", "--refs", "origin").splitlines()
        self.assertEqual([line for line in after_refs if line not in before_refs.splitlines()],
                         [self.run_git("rev-parse", tag) + "\trefs/tags/" + tag])
        self.assertEqual(self.run_git("rev-list", "--all", "--count"), before_count)
        self.assertEqual(self.worktree_snapshot(), snapshot)
        latest = json.loads(Path(self.tool.RECORD).read_text(encoding="utf-8"))["latest_delivery"]
        self.assertTrue(latest["source_status"]["pushed"])
        self.assertTrue(latest["tag_publication"]["pushed"])

    def test_failed_ci_and_wrong_sha_cannot_publish(self):
        self.run_git("push", "origin", "main")
        record_before = Path(self.tool.RECORD).read_bytes()
        for sequence, conclusion, sha in ((1, "failure", self.head), (2, "success", self.base)):
            with self.subTest(conclusion=conclusion, sha=sha), self.gh_checks(conclusion, sha):
                with self.assertRaises(SystemExit):
                    self.invoke("--release-tag", self.release_tag(sequence), "--publish-tag", "--base", self.base)
            self.assertEqual(self.run_git("tag", "--list"), "")
            self.assertEqual(self.run_git("ls-remote", "--tags", "origin"), "")
            self.assertEqual(Path(self.tool.RECORD).read_bytes(), record_before)
            receipts = list(Path(self.tool.OUT_ROOT).rglob("*.release.json"))
            receipt = json.loads(receipts[-1].read_text(encoding="utf-8"))
            self.assertFalse(receipt["tag_publication"]["pushed"])
            self.assertTrue(receipt["publication_error"])

    def test_latest_ci_failure_overrides_earlier_success(self):
        self.run_git("push", "origin", "main")
        runs = [{"id": 1, "name": "hygiene", "head_sha": self.head,
                 "status": "completed", "conclusion": "success"},
                {"id": 2, "name": "hygiene", "head_sha": self.head,
                 "status": "completed", "conclusion": "failure"}]
        with self.gh_checks(check_runs=runs), self.assertRaises(SystemExit):
            self.invoke("--release-tag", self.release_tag(), "--publish-tag", "--base", self.base)
        self.assertEqual(self.run_git("tag", "--list"), "")
        self.assertEqual(self.run_git("ls-remote", "--tags", "origin"), "")

    def test_delete_only_delivery_and_no_record(self):
        base = self.head
        self.run_git("rm", "src/new-runtime.txt")
        self.run_git("commit", "-m", "remove runtime")
        before = Path(self.tool.RECORD).read_bytes()
        result = self.invoke("--batch", "delete-only", "--base", base, "--no-record")
        with zipfile.ZipFile(result["zip"]) as archive:
            self.assertEqual(archive.namelist(), [])
            self.assertIsNone(archive.testzip())
        self.assertIn("src/new-runtime.txt", Path(result["delete_files_list"]).read_text(encoding="utf-8"))
        self.assertEqual(Path(self.tool.RECORD).read_bytes(), before)

    def test_invalid_batch_paths_and_tag_names_create_no_package(self):
        for args in (("--batch", "../escape"), ("--release-tag", "release-2026.02.30-1"),
                     ("--release-tag", "release-2026.10.09-0"), ("--publish-tag", "--batch", "no-tag")):
            with self.subTest(args=args), self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                self.invoke(*args, "--base", self.base)
        self.assertFalse(Path(self.tool.OUT_ROOT).exists())

    def test_unpushed_source_cannot_publish(self):
        with self.gh_checks():
            with self.assertRaises(SystemExit):
                self.invoke("--release-tag", self.release_tag(), "--publish-tag", "--base", self.base)
        self.assertEqual(self.run_git("tag", "--list"), "")
        self.assertEqual(self.run_git("ls-remote", "--tags", "origin"), "")

    def test_existing_local_or_remote_tag_cannot_be_rewritten(self):
        self.run_git("push", "origin", "main")
        tag = self.release_tag()
        self.run_git("tag", "-a", tag, self.base, "-m", "immutable release")
        original = self.run_git("rev-parse", tag)
        with self.gh_checks():
            with self.assertRaises(SystemExit):
                self.invoke("--release-tag", tag, "--publish-tag", "--base", self.base)
        self.assertEqual(self.run_git("rev-parse", tag), original)
        self.run_git("push", "origin", "refs/tags/" + tag)
        self.run_git("tag", "-d", tag)
        remote = self.run_git("ls-remote", "--refs", "origin")
        with self.gh_checks():
            with self.assertRaises(SystemExit):
                self.invoke("--batch", "remote-conflict", "--release-tag", tag, "--publish-tag", "--base", self.base)
        self.assertEqual(self.run_git("ls-remote", "--refs", "origin"), remote)
        self.assertEqual(self.run_git("tag", "--list"), "")


if __name__ == "__main__":
    unittest.main()
