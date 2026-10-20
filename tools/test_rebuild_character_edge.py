"""Run with: python tools/test_rebuild_character_edge.py

Integration tests use tiny synthetic inputs and invoke the real CLI. They do
not require a repository checkout, character assets or external packages.
"""
import base64
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib

TOOL = Path(__file__).with_name('rebuild_character_edge.py')
TABLE = 'production/upload/aa/table'
ART = 'production/medium_upload/bb/art'


def sha(raw): return hashlib.sha256(raw).hexdigest()


class RebuildCharacterEdgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='character-edge-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('active', 'baseline', 'art', 'server/assets'):
            (self.root / name).mkdir(parents=True)
        # A deliberately unoptimized compressed row detects recompression.
        self.old_row = zlib.compress(b'preserve-me\n', level=0)
        self.new_row = zlib.compress(b'new-character\n', level=9)
        index = struct.pack('<III', 1, 3, len(self.old_row)) + b'old'
        packed_index = zlib.compress(index)
        table = struct.pack('<I', len(packed_index)) + packed_index + self.old_row
        self.archive = self.root / 'active/pinball-1.4.54-1.4.55-1-base.zip'
        with zipfile.ZipFile(self.archive, 'w') as z:
            z.writestr(TABLE, table)
        archive_bytes = self.archive.read_bytes()
        self.manifest = {
            'cdn_version': '1.4.55',
            'patches': [{
                'id': 'base-55', 'version': '1.4.55',
                'depends_on': '1.4.54', 'enabled': True,
                'archive': self.archive.name,
                'archive_integrity': [{
                    'name': self.archive.name, 'size': len(archive_bytes),
                    'sha256': sha(archive_bytes), 'members': 1, 'files': [TABLE]
                }]
            }]
        }
        # Real one-pixel PNG; the pipeline treats art bytes as opaque assets.
        self.art = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII=')
        with zipfile.ZipFile(self.root / 'art/art.zip', 'w') as z:
            z.writestr(ART, self.art)
            # A table in the art source is intentionally unrelated and invalid.
            # Successful output must obtain its valid table from active instead.
            z.writestr(TABLE, b'never-use-art-source-tables')
        self.spec = {
            'schema': 1, 'id': 'tiny-character', 'name': '合成角色',
            'characterId': 'new',
            'tables': [{
                'logical': 'master/character/character.orderedmap',
                'member': TABLE, 'group': 1,
                'rows': {'new': base64.b64encode(self.new_row).decode()}
            }],
            'resources': [{
                'logical': 'character/tiny/ui/icon.png', 'member': ART,
                'group': 1, 'artArchive': 'art.zip',
                'size': len(self.art), 'sha256': sha(self.art)
            }],
            'requiredBaselineResources': [],
            'serverAdditions': {'assets/test.json': {'new': {'value': 1}}}
        }
        self.save('server/assets/test.json', {'old': {'value': 7}})

    def save(self, name, value):
        (self.root / name).write_text(json.dumps(value), encoding='utf-8')

    def run_cli(self):
        self.save('manifest.json', self.manifest)
        self.save('spec.json', self.spec)
        args = [sys.executable, str(TOOL),
                '--spec', str(self.root / 'spec.json'),
                '--manifest', str(self.root / 'manifest.json'),
                '--active', str(self.root / 'active'),
                '--baseline', str(self.root / 'baseline'),
                '--server-root', str(self.root / 'server'),
                '--art-dir', str(self.root / 'art'),
                '--from-version', '1.4.55', '--to-version', '1.4.56',
                '--output', str(self.root / 'output')]
        return subprocess.run(args, capture_output=True, text=True)

    def assert_rejected(self, diagnostic):
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(diagnostic, result.stderr)
        self.assertFalse((self.root / 'output').exists())

    def test_preserves_old_raw_row_and_appends_new_row(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        output = self.root / 'output'
        entry = json.loads((output / 'manifest-entry.json').read_text('utf-8'))
        self.assertEqual(entry['depends_on'], '1.4.55')
        self.assertEqual(entry['version'], '1.4.56')
        with zipfile.ZipFile(output / 'assets/asset-patch/active' / entry['archive']) as z:
            data = z.read(TABLE)
            self.assertEqual(z.read(ART), self.art)
        index_size = int.from_bytes(data[:4], 'little')
        index = zlib.decompress(data[4:4 + index_size])
        self.assertEqual(int.from_bytes(index[:4], 'little'), 2)
        # Inspect the independent wire-format offsets, not builder helpers.
        old_end = int.from_bytes(index[8:12], 'little')
        new_end = int.from_bytes(index[16:20], 'little')
        self.assertEqual(index[20:], b'oldnew')
        rows = data[4 + index_size:]
        self.assertEqual(rows[:old_end], self.old_row)
        self.assertEqual(rows[old_end:new_end], self.new_row)
        self.assertEqual(len(rows), new_end)
        self.assertEqual(json.loads((output / 'assets/test.json').read_text()),
                         {'old': {'value': 7}, 'new': {'value': 1}})

    def test_rejects_private_key_conflict(self):
        self.spec['tables'][0]['rows'] = {'old': base64.b64encode(self.new_row).decode()}
        self.assert_rejected('Private key conflict')

    def test_rejects_missing_active_archive(self):
        self.archive.unlink()
        self.assert_rejected('Missing active archive')

    def test_rejects_duplicate_enabled_version(self):
        self.manifest['patches'].append({
            'id': 'duplicate-enabled', 'version': '1.4.55', 'enabled': True})
        self.assert_rejected('Duplicate enabled manifest version')

    def test_allows_disabled_historical_same_version(self):
        self.manifest['patches'].append({
            'id': 'disabled-history', 'version': '1.4.55', 'enabled': False})
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / 'output/manifest-entry.json').is_file())

    def test_rejects_occupied_output_version_even_if_disabled(self):
        self.manifest['patches'].append({
            'id': 'disabled-candidate', 'version': '1.4.56', 'enabled': False})
        self.assert_rejected('Output version already occupied')

    def test_rejects_noncontiguous_output_groups(self):
        self.spec['tables'][0]['group'] = 2
        self.spec['resources'][0]['group'] = 2
        self.assert_rejected('Output groups must be contiguous starting at 1')

    def test_rejects_duplicate_id_even_if_disabled(self):
        self.manifest['patches'].append({
            'id': 'base-55', 'version': '1.4.57', 'enabled': False})
        self.assert_rejected('Duplicate manifest id')


if __name__ == '__main__':
    unittest.main(verbosity=2)
