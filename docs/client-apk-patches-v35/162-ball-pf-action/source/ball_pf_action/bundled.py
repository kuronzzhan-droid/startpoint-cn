"""Read exact built-in PFA names from the three locked input APKs."""
import hashlib
import io
import json
import struct
import zipfile
import zlib
from bootstrap import ROOT, require_hash, sha

PATH = 'master/skill/power_flip_action_iosbundled.orderedmap'
SALT = 'K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy'


def keys(raw):
    size = struct.unpack_from('<I', raw)[0]
    header = zlib.decompress(raw[4:4 + size])
    count = struct.unpack_from('<I', header)[0]
    names = header[4 + 8 * count:]
    result, start = [], 0
    for index in range(count):
        end = struct.unpack_from('<I', header, 4 + 8 * index)[0]
        result.append(names[start:end].decode('utf-8'))
        start = end
    if start != len(names) or len(set(result)) != count or not all(result):
        raise ValueError('Unexpected bundled PFA orderedmap key header')
    return result


def load():
    lock = json.loads((ROOT / 'p13-input-lock.json').read_text('utf-8'))
    digest = hashlib.sha1((PATH + SALT).encode()).hexdigest()
    suffix = digest[:2] + '/' + digest[2:]
    sources, result = [], None
    for source in lock['apks']:
        require_hash(source['path'], source['sha256'])
        with zipfile.ZipFile(source['path']) as apk:
            with zipfile.ZipFile(io.BytesIO(apk.read('assets/bundle.zip'))) as bundle:
                matches = [name for name in bundle.namelist() if name.endswith('/' + suffix)]
                if len(matches) != 1:
                    raise ValueError('Ambiguous bundled PFA location: ' + repr(matches))
                raw = bundle.read(matches[0])
        found = keys(raw)
        if result is not None and found != result:
            raise ValueError('Bundled PFA keys differ across input APKs')
        result = found
        sources.append({'apk': source['path'], 'apk_sha256': source['sha256'],
                        'bundle_entry': matches[0], 'table_sha256': sha(raw)})
    return result, {'logical_path': PATH, 'key_count': len(result),
                    'keys': result, 'sources': sources}
