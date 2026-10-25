"""Execute prepared iOS bodies in the existing bounded R11 AIR fixtures.

The projection supplies original R11 dependencies as controlled test context.
Only the candidate methods/helpers are imported from the actual iOS ABC;
receipts distinguish these from the unchanged Android fixture dependencies.
Run the entire command through the workspace's background AIR launcher.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import struct
import subprocess
import sys
import zlib

import prepare_profile_town as recipe

sys.path.insert(0, str(recipe.CLIENT / 'content-operations'))
import build_bridge as bridge


def write_swf(path, version, header, tags):
    for tag in tags:
        if tag[3]:
            data = tag[2] + bridge.sc.serialize(tag[3], tag[4])
            tag[1] = struct.pack('<HI', (82 << 6) | 63, len(data)) + data
    raw = header + b''.join(tag[1] for tag in tags)
    Path(path).write_bytes(b'CWS' + bytes([version]) + struct.pack('<I', len(raw)+8) + zlib.compress(raw))


def project(candidate, r11, out, *, require_response):
    donor, helpers, raw = recipe.load_r11(r11)
    candidate = Path(candidate)
    full = candidate.read_bytes()
    ios = recipe.view(recipe.p.abcfmt.ABC(full))
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    source = out / 'r11-fixture-context.swf'
    source.write_bytes(raw)
    version, header, tags = bridge.sc.parts(source)
    main = next(t[3] for t in tags if t[3] and any(t[3].mn_name(x[0]) == 'pinball.context.global::GlobalLogic' for x in t[3].instances))
    target = recipe.view(main)
    labels = list(recipe.PROFILE_LABELS) + list(recipe.TOWN_LABELS)
    if require_response:
        recipe.response_capture_contract(ios, recipe.view(donor))
        labels.append(recipe.RESPONSE_LABEL)
    records = []
    for label in labels:
        si, = ios.by_label[label]
        ti, = target.by_label[label]
        old = main.bodies[ti]
        main.bodies[ti] = recipe.p.Importer(target, ios).body(si, old[0], scope=old[3])
        assert target.normalized(ti) == ios.normalized(si)
        records.append(dict(label=label, ios_method=ios.a.bodies[si][0],
                            candidate_code_sha256=recipe.sha(ios.a.bodies[si][5]),
                            normalized_body_cfg_exact=True))
    for helper_name, filename in [('cn.profile::PlayerHistoryState','player-history-helper.abc'),
                                  ('cn.town::TownThemeState','town-theme-helper.abc')]:
        helper = next(t[3] for t in tags if t[3] and any(t[3].mn_name(x[0]) == helper_name for x in t[3].instances))
        hv = recipe.view(helper)
        imp = recipe.p.Importer(hv, ios)
        for label, indices in hv.by_label.items():
            ti, = indices
            si, = ios.by_label[label]
            old = helper.bodies[ti]
            helper.bodies[ti] = imp.body(si, old[0], scope=old[3])
            assert hv.normalized(ti) == ios.normalized(si)
            records.append(dict(label=label, ios_method=ios.a.bodies[si][0], helper=True,
                                candidate_code_sha256=recipe.sha(ios.a.bodies[si][5]),
                                normalized_body_cfg_exact=True))
        (out / filename).write_bytes(helper.serialize())
    content = next(t[3] for t in tags if t[3] and any(t[3].mn_name(x[0]) == 'cn.content::ContentOperationsState' for x in t[3].instances))
    (out / 'production-helper.abc').write_bytes(content.serialize())
    projected = out / 'content-operations-android.swf'
    write_swf(projected, version, header, tags)
    # Recover the previous automatic selector by removing only its reviewed
    # ten-instruction town prologue. This baseline is fixture-only.
    baseline_tags = copy.deepcopy(tags)
    baseline_main = next(t[3] for t in baseline_tags if t[3] and any(t[3].mn_name(x[0]) == 'pinball.context.global::GlobalLogic' for x in t[3].instances))
    bv = recipe.view(baseline_main)
    si, = bv.by_label[recipe.TOWN_LABELS[0]]
    body = baseline_main.bodies[si]
    rows = recipe.p.asm.decode(body[5])
    assert [r.op for r in rows[2:12]] == [0x60,0xd0,0x46,0x2a,0x20,0x13,0x80,0x48,0x09,0x29]
    assert not body[6]
    body[5] = recipe.p.asm.unsplice(body[5], 2, 10)
    ci, = bv.by_label[recipe.RESPONSE_LABEL]
    ctor = baseline_main.bodies[ci]
    assert not ctor[6]
    ctor[5] = recipe.p.asm.unsplice(ctor[5], 2, 3)
    baseline = out / 'native-auto-baseline.swf'
    write_swf(baseline, version, header, baseline_tags)
    receipt = dict(candidate_full_abc=str(candidate.resolve()), candidate_full_abc_sha256=recipe.sha(full),
                   projected_swf_sha256=recipe.sha(projected.read_bytes()), methods=records,
                   candidate_method_count=len(records), response_from_candidate=require_response,
                   original_r11_fixture_dependencies=True, full_game_executed=False, device_tested=False)
    recipe.dump(out / 'ios-projection.json', receipt)
    return projected, baseline


def execute(args):
    production = args.out / 'projection'
    projected, baseline = project(args.candidate, args.r11, production, require_response=not args.isolated)
    swc = production / 'town-theme-state.swc'
    cmd = [str(args.java), '-Dflexlib='+str(args.sdk/'frameworks'), '-jar', str(args.sdk/'lib/compc-cli.jar'),
           '+configname=air', '-swf-version=44', '-target-player=32.0', '-compiler.float=false',
           '-debug=false', '-compiler.source-path='+str(recipe.CLIENT/'town-theme/src'),
           '-include-classes=cn.town.TownThemeState', '-output='+str(swc)]
    result = subprocess.run(cmd, capture_output=True, timeout=120)
    (production/'compile-town-library.log').write_bytes(result.stdout+result.stderr)
    assert result.returncode == 0, 'town fixture library compilation failed'
    commands = [
        ('profile', [sys.executable,'-B',str(recipe.CLIENT/'content-operations/player_history_runtime_fixtures.py'),
                     '--work',str(args.out/'profile-air'),'--production-work',str(production),
                     '--sdk',str(args.sdk),'--java',str(args.java),'--native-regression']),
        ('town', [sys.executable,'-B',str(recipe.CLIENT/'town-theme/native_runtime_fixtures.py'),
                  '--work',str(args.out/'town-air'),'--candidate',str(projected),'--baseline',str(baseline),
                  '--sdk',str(args.sdk),'--java',str(args.java)]),
        ('town-negative', [sys.executable,'-B',str(recipe.CLIENT/'town-theme/native_runtime_fixtures.py'),
                  '--work',str(args.out/'town-negative-air'),'--candidate',str(projected),'--baseline',str(baseline),
                  '--sdk',str(args.sdk),'--java',str(args.java),'--expect-r10-missing-hooks']),
    ]
    reports = []
    for name, command in commands:
        result = subprocess.run(command, capture_output=True, timeout=180)
        (args.out/(name+'.log')).write_bytes(result.stdout+result.stderr)
        reports.append(dict(name=name, exit_code=result.returncode, command=command))
        recipe.dump(args.out/'air-run.json', reports)
        assert result.returncode == 0, ('AIR fixture failed', name, (result.stdout+result.stderr).decode('utf8','replace')[-5000:])
        print(name, 'passed', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('candidate','r11','out','sdk','java'):
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--isolated', action='store_true', help='Use donor response prologue, mark it explicitly untested for candidate')
    args = parser.parse_args()
    execute(args)


if __name__ == '__main__':
    main()
