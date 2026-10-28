"""Preserve and document the exact P0c build chain used by C1."""
import json
from bootstrap import ROOT, P0, BASE, P13, BASE_SHA, P13_SHA, require_hash, sha, write_json


def main():
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    upstream = P0 / 'build-p0c'
    inputs = sorted((upstream / 'source').rglob('*'))
    inputs = [p for p in inputs if p.is_file() and '__pycache__' not in p.parts]
    inputs += [upstream / 'swf/boot-riven-p0c.swf', upstream / 'inputs/v35abyss-p13-local.swf',
               upstream / 'P0C-DELIVERY-MANIFEST.json', upstream / 'audit/build.json']
    manifest = json.loads((upstream / 'P0C-DELIVERY-MANIFEST.json').read_text('utf-8-sig'))
    apk_entry = next(k for k in manifest['files'] if k.endswith('.signed.apk'))
    inputs.append(P0 / apk_entry)
    report = {'inputs': {str(p): {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                         for p in inputs},
              'copied_source_files': {str(p.relative_to(ROOT)): sha(p.read_bytes())
                                      for p in sorted((ROOT / 'source').rglob('*'))
                                      if p.is_file() and '__pycache__' not in p.parts}}
    write_json(ROOT / 'audit/input-lock.json', report)
    print(json.dumps({'status': 'locked', 'input_files': len(inputs)}))


if __name__ == '__main__':
    main()
