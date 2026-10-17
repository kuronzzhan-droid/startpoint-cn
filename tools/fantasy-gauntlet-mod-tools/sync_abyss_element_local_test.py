"""Preimage-checked local test sync; no Git submission or cloud deployment."""
from __future__ import annotations
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
RUNTIME=Path(r'F:\startpoint-cn-main')
AUDIT=ROOT/'assets/asset-patch/audit/abyss-element-sponsor-laite-1.4.104-test'

def sha(data):return hashlib.sha256(data).hexdigest()
def readj(path):return json.loads(path.read_text('utf8'))
def savej(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')

def main(work,apply):
    work=work.resolve();runtime=RUNTIME.resolve();server=work/'candidate-server'
    cdn=(ROOT/'.cdn').resolve()
    assert runtime!=ROOT.resolve() and not work.is_relative_to(cdn)
    report=readj(AUDIT/'report.json');entry=readj(AUDIT/'manifest-entry.json')
    assert report['validation']['actual_archive_rows_in_apk_helper']==30
    assert report['validation']['isolated_server_build_passed']
    assert not readj(work/'direct-resource-preflight.json')['non_baseline']
    assert (ROOT/'assets/asset-patch/manifest.json').read_bytes()==(work/'source-manifest-before.json').read_bytes()
    current_manifest=RUNTIME/'assets/asset-patch/manifest.json'
    baseline=subprocess.check_output(['git','show','HEAD:assets/asset-patch/manifest.json'],cwd=ROOT)
    assert readj(current_manifest)==json.loads(baseline) and readj(current_manifest)['cdn_version']=='1.4.103'
    with socket.socket() as probe:
        probe.settimeout(0.5)
        assert probe.connect_ex(('127.0.0.1',8001))!=0,'local server must be stopped for this first activation'
    payloads={};sources={};skipped=[]
    def add(rel,source):
        path=(RUNTIME/rel).resolve()
        assert path.is_relative_to(runtime) and not path.is_relative_to(cdn)
        raw=source.read_bytes()
        if path.exists() and path.read_bytes()==raw:
            skipped.append(rel);return
        payloads[rel]=raw;sources[rel]=str(source)
    for item in readj(AUDIT/'release-files.json'):
        rel=item['path'];source=server/rel;raw=source.read_bytes()
        assert sha(raw)==item['sha256']
        target=RUNTIME/rel
        if target.exists():
            actual=target.read_bytes()
            old=subprocess.check_output(['git','show','HEAD:'+rel],cwd=ROOT)
            assert actual==old or actual==raw,('runtime source drift',rel)
            if rel.endswith('.json') and json.loads(actual)==json.loads(raw):
                skipped.append(rel);continue
        add(rel,source)
    archive=ROOT/'assets/asset-patch/inactive/candidates'/entry['archive']
    assert sha(archive.read_bytes())==report['archive']['sha256']
    assert not (RUNTIME/'assets/asset-patch/active'/archive.name).exists()
    add('assets/asset-patch/active/'+archive.name,archive)
    # Verify every loose preimage through the same pristine+.103 chain.
    donor=Path(r'F:\codex\work\abyss-sponsor-laite-20260909')
    os.environ.update(WF_SERVER_DIR=str(donor/'candidate-server'),WF_CDN_DIR=str(donor/'pristine-read-links/cn'),WF_LIVE_CDN='1')
    import wf_live_cdn as live
    for item in readj(AUDIT/'resource-inventory.json'):
        if not item['included']:continue
        rel='assets/asset-patch/'+item['member'];target=RUNTIME/rel
        if target.exists():
            try:old=live.read_logical(item['logical']).data
            except live.LiveCdnEntryMissing:old=None
            assert target.read_bytes()==old,('runtime direct resource drift',rel)
        source=server/rel;assert sha(source.read_bytes())==item['sha256'];add(rel,source)
    incoming=server/'assets/asset-patch/manifest.json'
    assert readj(incoming)['cdn_version']=='1.4.104' and readj(incoming)['patches'][-1]==entry
    assert all(e['id'] not in {'entry-condition-message-1.4.104','sponsor-special-thanks-1.4.105','abyss-laite-exchange-1.4.106'}
               for e in readj(incoming)['patches'])
    add('assets/asset-patch/manifest.json',incoming)
    manifest_rel='assets/asset-patch/manifest.json'
    ordered=[rel for rel in payloads if rel!=manifest_rel]+[manifest_rel]
    before={rel:(RUNTIME/rel).read_bytes() if (RUNTIME/rel).exists() else None for rel in ordered}
    rows=[{'path':rel,'source':sources[rel],'before_sha256':sha(before[rel]) if before[rel] is not None else None,
           'sha256':sha(payloads[rel]),'size':len(payloads[rel])} for rel in ordered]
    plan={'mode':'authorized_uncommitted_local_test','target':str(RUNTIME),'files':rows,'skipped_unchanged':skipped,
          'source_manifest_preserved':True,'cloud_deployed':False,'committed':False,'pushed':False}
    savej(work/'local-sync-plan.json',plan)
    if not apply:
        print(json.dumps({'status':'preflight_passed','files':len(rows),'skipped':skipped},ensure_ascii=False));return
    backup=RUNTIME/'.codex-backups'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-abyss-element-local-test')
    assert backup.resolve().is_relative_to(runtime) and not backup.exists();backup.mkdir(parents=True)
    for rel,raw in before.items():
        if raw is not None:
            path=backup/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            assert path.read_bytes()==raw
    savej(backup/'sync-plan.json',plan)
    written=[]
    try:
        for rel in ordered:
            path=RUNTIME/rel
            assert (path.read_bytes() if path.exists() else None)==before[rel],('concurrent runtime write',rel)
            path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(payloads[rel]);written.append(rel)
            assert path.read_bytes()==payloads[rel]
    except BaseException:
        for rel in reversed(written):
            path=(RUNTIME/rel).resolve();assert path.is_relative_to(runtime) and not path.is_relative_to(cdn)
            if before[rel] is None:path.unlink()
            else:path.write_bytes(before[rel])
        raise
    plan.update(status='local_test_synced',backup=str(backup),copied=len(written),new_files=sum(before[x] is None for x in ordered))
    savej(work/'local-sync-report.json',plan);savej(AUDIT/'local-sync-report.json',plan)
    print(json.dumps({'status':plan['status'],'copied':len(written),'backup':str(backup)},ensure_ascii=False))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--work',type=Path,required=True);ap.add_argument('--apply',action='store_true')
    args=ap.parse_args();main(args.work,args.apply)
