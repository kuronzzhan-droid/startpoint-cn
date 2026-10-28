"""P2 catalog id as a build parameter (item table change -> new catalog id).

Input JSON (default round2/p2-catalog.json, written by the server/data task) has
the port175 evidence shape: {catalog_id, canonical?, resources:[{logical, path, sha256}]}.
When the resource files exist (next to the JSON, or under --resources) the id is
recomputed: 'riven-multi-v1-' + SHA256(sorted 'logical\\tsha256\\n')[:32] and the
96 affix keys 15990001..15990096 are re-read from ability_soul (must be unchanged,
because the consumer's affix whitelist is not re-emitted). Carriers 16000001..16000999
exclude the fragment 16000900 and the themed-unknown block 16000901..16000919.

Patch: every `pushstring <catalog in SWF>` gets `pop; pushstring <new>` right after
it (8 sites on 1008092). Identical ids -> no insert (no-op).
"""
import hashlib
import json
import sys
from pathlib import Path
import asm
from r2_common import ops_of, label_index
from r2_paths import WORK

PREFIX = b'riven-multi-v1-'
TABLES = ('master/ability/ability_soul.orderedmap', 'master/item/equipment.orderedmap',
          'master/item/item.orderedmap', 'master/string/custom_ability_string.orderedmap')
AFFIX_KEYS = tuple(range(15990001, 15990097))


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def load(path, resources=None):
    path = Path(path)
    evidence = json.loads(path.read_bytes())
    cid = evidence['catalog_id']
    assert cid.startswith(PREFIX.decode()) and len(cid) == len(PREFIX) + 32, cid
    result = {'source': str(path), 'source_sha256': _sha(path.read_bytes()), 'catalog_id': cid,
              'recomputed': False}
    rows = {}
    for row in evidence.get('resources', []):
        for base in ([Path(resources)] if resources else []) + [path.parent, path.parent / 'p2-assets']:
            f = base / row['path']
            if f.exists():
                raw = f.read_bytes()
                assert _sha(raw) == row['sha256'], row['logical']
                rows[row['logical']] = raw
                break
    if sorted(rows) == sorted(TABLES):
        canonical = ''.join(t + '\t' + _sha(rows[t]) + '\n' for t in sorted(rows))
        assert 'riven-multi-v1-' + _sha(canonical.encode())[:32] == cid
        sys.path.insert(0, str(WORK / 'library/generator'))
        from riven_sources import flat_table
        souls = flat_table(rows[TABLES[0]])
        keys = tuple(sorted(int(k) for k in souls if 15990001 <= int(k) <= 15999999))
        assert keys == AFFIX_KEYS, 'affix whitelist changed; consumer must be rebuilt'
        carriers = sorted(int(k) for k in souls if 16000001 <= int(k) <= 16000999
                          and not 16000900 <= int(k) <= 16000919)
        themed = sorted(int(k) for k in souls if 16000901 <= int(k) <= 16000919)
        result.update(recomputed=True, carriers=[carriers[0], carriers[-1], len(carriers)],
                      themed_soul_rows=themed)
    return result


def queue_catalog(q, new_id):
    e = q.e
    old = [i for i, s in enumerate(e.abc.strings) if s.startswith(PREFIX)]
    assert len(old) == 1, old
    old_id = e.abc.strings[old[0]].decode()
    sites = []
    labels = label_index(e.abc)
    if old_id == new_id:
        return {'old': old_id, 'new': new_id, 'sites': [], 'noop': True}
    import opwalk_enc
    needle = b'\x2c' + opwalk_enc.u30(old[0])
    for label, i in labels.items():
        code = e.abc.bodies[i][5]
        if needle not in code:
            continue
        ops = None
        try:
            ops = asm.decode(code)
        except Exception:
            continue
        for k, o in enumerate(ops):
            if o.name == 'pushstring' and o.args[0] == old[0]:
                q.add('catalog', label, k + 1, [('pop',), e.string(new_id)], asm.FORBID,
                      'P2 catalog id parameter')
                sites.append([label, k])
    assert len(sites) == 8, sites
    return {'old': old_id, 'new': new_id, 'sites': sites, 'noop': False}
