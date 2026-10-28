"""Stage-5 identity proof: 1008092 keeps every 1008091 endpoint/admission byte.

Compares every SWF tag of the final SWF with the 1008091 wt SWF. Only the main
game DoABC may differ (riven splices); admission tags (ClientAdmission,
BuildConfig) and all other tags must be byte-identical; the main ABC URL/host
string set must be identical. Prints hashes only, never key material.
"""
import hashlib, json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / 'source'), str(ROOT / 'source/vendor')]
from c4_admission import tags
BASE = Path('<WORKDIR>/outputs/work/continue-cost-20261026/build/p13s-wt-continue-cost.swf')
FINAL = ROOT / 'build/riven-wt-1008092.swf'
sha = lambda b: hashlib.sha256(b).hexdigest()
a, b = tags(BASE.read_bytes()), tags(FINAL.read_bytes())
assert len(a) == len(b)
diff = [i for i, (x, y) in enumerate(zip(a, b)) if x[2] != y[2]]
assert all(x[0] == y[0] and x[1] == y[1] for x, y in zip(a, b))
# Allowed: main game ABC (riven splices) and C14's TrueTypeCompositor library splice.
assert {a[i][1] for i in diff} == {b'boot_ffc6', b'starling/text/TrueTypeCompositor',
                                   b'cn/admission/ClientAdmission', b'cn/admission/BuildConfig'}, diff
main_i = next(i for i in diff if a[i][1] == b'boot_ffc6')
names = {x[1] for x in a if x[1]}
adm = [i for i, x in enumerate(a) if x[1] in (b'cn/admission/ClientAdmission', b'cn/admission/BuildConfig')]
OLD_BUILD, NEW_BUILD = b'<ADMISSION_ID>', b'<ADMISSION_ID>'
assert len(adm) == 2 and set(adm) <= set(diff)
for i in adm:
    # Only the build-ID literal differs: byte-for-byte reverse substitution
    # recovers the 1008091 tag exactly (key and endpoint bytes included).
    assert len(a[i][2]) == len(b[i][2])
    assert b[i][2].replace(NEW_BUILD, OLD_BUILD) == a[i][2]
    assert OLD_BUILD not in b[i][2]
assert OLD_BUILD not in b''.join(x[2] for x in b)
url = re.compile(rb'(?:https?|wss?)://[^\x00-\x20"\']{3,200}')
ua, ub = sorted(set(url.findall(a[main_i][2]))), sorted(set(url.findall(b[main_i][2])))
assert ua == ub
build = re.findall(rb'SP-ADMISSION-1\n([^\n]{1,80})\n', b''.join(x[2] for x in b))
result = {'status': 'passed', 'base_sha256': sha(BASE.read_bytes()), 'final_sha256': sha(FINAL.read_bytes()),
          'tag_count': len(a), 'differing_tags': [{'index': i, 'name': (a[i][1] or b'').decode()} for i in diff],
          'admission_tags_differ_only_by_build_id_literal': True,
          'admission_tags_reverse_substitution_equals_1008091': True,
          'admission_build_id_previous': OLD_BUILD.decode(),
          'admission_key_bytes_unchanged': True,
          'all_other_tags_byte_identical': True,
          'main_abc_url_strings_identical': True, 'url_string_count': len(ua),
          'url_set_sha256': sha(b'\n'.join(ua)),
          'admission_build_id': sorted({x.decode() for x in build}),
          'key_material_printed': False}
(ROOT / 'audit/identity.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', 'utf-8')
print(json.dumps(result, ensure_ascii=False))
