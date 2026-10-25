"""Extract only the pinned R11 SWF and two required ABC donors."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
import zipfile
import zlib

from prepare import sha, dump, DONOR_SHA256, HELPER_SHA256
from swfabc import abcfmt, swftags

APK_SHA256 = 'e9b9bbd8a0557a4cfaf6534b0e952caf20d142f5e6702fb2d35a0977f9a871b8'
SWF_SHA256 = '9c672e56e5911679848047daece874e139255b2d128f67ab11e605c5db2bb951'


def run(apk, out):
    apk, out = Path(apk), Path(out)
    apk_raw = apk.read_bytes()
    if sha(apk_raw) != APK_SHA256:
        raise ValueError('Requires the fixed accepted R11 LAN APK')
    if out.exists():
        raise ValueError('Input extraction needs a fresh output directory')
    with zipfile.ZipFile(apk) as archive:
        swf_raw = archive.read('assets/worldflipper_android_release.swf')
    if sha(swf_raw) != SWF_SHA256:
        raise ValueError('Embedded R11 SWF differs')
    payload = zlib.decompress(swf_raw[8:]) if swf_raw[:3] == b'CWS' else swf_raw[8:]
    selected = {}
    wanted = {'pinball.context.remote::RequestQueue': ('r11-main.abc', DONOR_SHA256),
              'cn.content::ContentOperationsState': ('r11-content-helper.abc', HELPER_SHA256)}
    for kind, at, header, size in swftags.iter_tags(payload):
        if kind != 82:
            continue
        tag = payload[at+header:at+header+size]
        end = tag.index(b'\0', 4)
        abc = abcfmt.ABC(tag[end+1:])
        classes = {abc.mn_name(row[0]) for row in abc.instances}
        for owner, (name, digest) in wanted.items():
            if owner not in classes:
                continue
            raw = abc.serialize()
            if name in selected or sha(raw) != digest:
                raise ValueError(('Donor missing, duplicated or changed', owner))
            selected[name] = raw
    if set(selected) != {name for name, digest in wanted.values()}:
        raise ValueError('Required R11 donors are missing')
    out.mkdir(parents=True)
    (out / 'r11-donor.swf').write_bytes(swf_raw)
    for name, raw in selected.items():
        (out / name).write_bytes(raw)
    report = dict(apk=str(apk), apk_sha256=sha(apk_raw), swf_sha256=sha(swf_raw),
                  extracted={name:sha(raw) for name, raw in selected.items()},
                  source_script_sha256=sha(Path(__file__).read_bytes()), source_unchanged=True)
    dump(out / 'inputs.json', report)
    print(json.dumps(dict(apk_sha256=report['apk_sha256'], swf_sha256=report['swf_sha256'], extracted=report['extracted'])))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args=parser.parse_args()
    run(args.apk,args.out)
