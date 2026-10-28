"""Accept only the hash-pinned, append-only C21 option-2 clarification."""
import json
from bootstrap import ROOT, WORKSPACE, sha, write_immutable, write_json
from c21_prepare import inventory

OLD_SHA = 'd8d377d83d0c28a10be27ef1794607dac4ad8fd252e68ab327403ed1c3a0e72c'
NEW_SHA = 'b51d667e602721d959bc4045b08e65e4549b1161599abdc6c323f56571bb72f0'
OLD_BYTES = 2355


def main():
    assert __debug__
    lock_path = ROOT / 'audit/input-lock.json'
    archived = ROOT / 'audit/run1/input-lock.json'
    original = archived.read_bytes() if archived.exists() else lock_path.read_bytes()
    old = json.loads(original)
    brief_path = WORKSPACE / 'C21-BRIEF.md'
    brief = brief_path.read_bytes()
    assert sha(brief) == NEW_SHA and sha(brief[:OLD_BYTES]) == OLD_SHA
    assert old['inputs'][str(brief_path)] == {'sha256': OLD_SHA, 'bytes': OLD_BYTES}
    current = inventory()
    changes = {key for key in current.keys() | old['inputs'].keys()
               if current.get(key) != old['inputs'].get(key)}
    assert changes == {str(brief_path)}, ('Unapproved input change', changes)
    updated = {**old, 'inputs': current}
    encoded = (json.dumps(updated, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    assert lock_path.read_bytes() in (original, encoded), 'Unexpected active input lock'
    write_immutable(archived, original)
    write_immutable(ROOT / 'audit/run1/C21-BRIEF.md', brief[:OLD_BYTES])
    write_json(ROOT / 'audit/brief-amendment.json', {
        'status': 'passed', 'decision': 'C21-BRIEF.md appendix: option 2',
        'old_brief_sha256': OLD_SHA, 'brief_sha256': NEW_SHA,
        'original_brief_bytes_preserved': OLD_BYTES,
        'original_lock_sha256': sha(original), 'active_lock_sha256': sha(encoded),
        'changed_inputs': [str(brief_path)],
        'unchanged_input_count': len(current) - 1,
        'historical_baselines_unchanged': True})
    lock_path.write_bytes(encoded)
    print(json.dumps({'status': 'passed', 'changed_inputs': ['C21-BRIEF.md'],
                      'unchanged_inputs': len(current) - 1}))


if __name__ == '__main__':
    main()
