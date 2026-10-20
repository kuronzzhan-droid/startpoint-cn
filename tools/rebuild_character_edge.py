#!/usr/bin/env python3
"""Rebase a declared-row character spec onto an explicit local resource chain.

Python standard library only. All inputs are read-only. Art archives supply only
the non-table members listed by the spec, never table preimages. Missing inputs,
private-key conflicts, archive drift and oversize groups stop the build.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import zipfile
import zlib

def sha(b): return hashlib.sha256(b).hexdigest()
def readj(p): return json.loads(p.read_text('utf-8-sig'))
def version(s):
    assert re.fullmatch(r'\d+\.\d+\.\d+', s), 'Invalid version'
    return tuple(map(int, s.split('.')))

def rawmap(raw):
    assert len(raw)>=4
    size=struct.unpack_from('<I',raw)[0]
    assert size<=len(raw)-4
    decoder=zlib.decompressobj()
    index=decoder.decompress(raw[4:4+size])+decoder.flush()
    assert decoder.eof and not decoder.unused_data
    count=struct.unpack_from('<I',index)[0]
    assert 4+8*count<=len(index)
    keyblob=index[4+8*count:]; rowblob=raw[4+size:]
    rows={}; ke=re_=0
    for i in range(count):
        kn,rn=struct.unpack_from('<II',index,4+8*i)
        assert ke<=kn<=len(keyblob) and re_<=rn<=len(rowblob)
        key=keyblob[ke:kn].decode('utf-8')
        assert key not in rows, 'Duplicate orderedmap key'
        rows[key]=rowblob[re_:rn]; ke,re_=kn,rn
    assert ke==len(keyblob) and re_==len(rowblob)
    return rows

def packmap(rows):
    keys=bytearray(); data=bytearray(); pairs=[]
    for key,row in rows.items():
        keys+=key.encode(); data+=row; pairs.append((len(keys),len(data)))
    index=struct.pack('<I',len(rows))+b''.join(struct.pack('<II',*v) for v in pairs)+keys
    compressed=zlib.compress(index)
    return struct.pack('<I',len(compressed))+compressed+data

def zipbytes(payload):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,data in sorted(payload.items()):
            info=zipfile.ZipInfo(name,(2026,9,3,12,0,0)); info.compress_type=zipfile.ZIP_DEFLATED
            info.create_system=3; info.external_attr=0o100644<<16
            z.writestr(info,data)
    return out.getvalue()

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--spec',required=True,type=Path)
    ap.add_argument('--manifest',required=True,type=Path)
    ap.add_argument('--active',required=True,type=Path,action='append',help='Repeat for verified local archive caches')
    ap.add_argument('--baseline',required=True,type=Path,help='Read-only pristine cn directory containing archive-* subdirectories')
    ap.add_argument('--baseline-version',default='1.4.54')
    ap.add_argument('--server-root',required=True,type=Path)
    ap.add_argument('--art-dir',required=True,type=Path,help='Directory containing the six original art-source ZIPs')
    ap.add_argument('--from-version',required=True)
    ap.add_argument('--to-version',required=True)
    ap.add_argument('--output',required=True,type=Path)
    args=ap.parse_args()
    out=args.output.resolve()
    for input_path in [args.spec,args.manifest,args.baseline,args.server_root,args.art_dir,*args.active]:
        assert input_path.exists(), 'Missing input: '+str(input_path)
    assert not out.exists(), 'Output must be new'
    assert '.cdn' not in out.parts
    assert not any(out.is_relative_to(x.resolve()) for x in [args.baseline,*args.active,args.art_dir])
    assert not args.manifest.resolve().is_relative_to(out)
    spec=readj(args.spec); manifest=readj(args.manifest)
    assert spec['schema']==1 and manifest['cdn_version']==args.from_version
    assert version(args.to_version)>version(args.from_version)
    all_versions=[p['version'] for p in manifest['patches']]
    all_ids=[p['id'] for p in manifest['patches']]
    enabled_versions=[p['version'] for p in manifest['patches'] if p.get('enabled')]
    assert len(enabled_versions)==len(set(enabled_versions)), 'Duplicate enabled manifest version'
    assert len(all_ids)==len(set(all_ids)), 'Duplicate manifest id'
    assert args.to_version not in all_versions, 'Output version already occupied'
    group_numbers={r['group'] for r in spec['tables']+spec['resources']}
    assert all(type(n) is int for n in group_numbers) and sorted(group_numbers)==list(range(1,len(group_numbers)+1)), 'Output groups must be contiguous starting at 1'
    patches=sorted((p for p in manifest['patches'] if p.get('enabled')),key=lambda p:version(p['version']))
    tail=args.baseline_version; chain=[]
    for patch in patches:
        assert patch['depends_on']==tail, 'Non-contiguous input chain'
        tail=patch['version']; integrity={x['name']:x for x in patch.get('archive_integrity',[])}
        for name in patch.get('chain') or [patch['archive']]: chain.append((name,integrity.get(name),tail))
    assert tail==args.from_version
    def locate(name):
        for folder in args.active:
            path=folder/name
            if path.is_file(): return path
        raise FileNotFoundError('Missing active archive: '+name)
    def inventory(path,info=None):
        raw=path.read_bytes()
        if info:
            assert sha(raw)==info['sha256'] and len(raw)==info['size'], 'Archive drift: '+path.name
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names=z.namelist()
            assert len(names)==len(set(names)) and z.testzip() is None
            if info and 'files' in info: assert set(names)==set(info['files'])
        return names
    required={t['member'] for t in spec['tables']}|{r['member'] for r in spec['requiredBaselineResources']}
    unresolved=set(required); winners={}
    for name,info,ver in reversed(chain):
        if not unresolved: break
        names=info.get('files') if info else None
        if names is None:
            names=info.get('members') if info and isinstance(info.get('members'),list) else inventory(locate(name),info)
        for member in unresolved.intersection(names): winners[member]=(locate(name),info,ver)
        unresolved-=set(names)
    base=[]
    for folder in args.baseline.glob('archive-*'):
        for path in folder.glob('*.zip'):
            if '-full' in folder.name: base.append((0,path.name,path))
            else:
                match=re.match(r'pinball-\d+\.\d+\.\d+-1\.4\.(\d+)-',path.name)
                if match and int(match[1])<=version(args.baseline_version)[2]: base.append((int(match[1]),path.name,path))
    remaining=set(unresolved)
    for _,name,path in sorted(base):
        with zipfile.ZipFile(path) as z:
            for member in remaining.intersection(z.namelist()): winners[member]=(path,None,args.baseline_version)
    assert required<=set(winners), 'Unresolved required resources: '+str(sorted(required-set(winners)))
    verified=set(); provenance={}
    def get(member):
        path,info,ver=winners[member]
        if path not in verified: inventory(path,info); verified.add(path)
        with zipfile.ZipFile(path) as z: raw=z.read(member)
        provenance[member]={'archive':path.name,'version':ver,'sha256':sha(raw)}
        return raw
    for item in spec['requiredBaselineResources']:
        assert sha(get(item['member']))==item['sha256'], 'Shared baseline resource changed'
    groups={}; tableproof=[]; preimages={}
    for table in spec['tables']:
        before=get(table['member']); old=rawmap(before)
        assert not set(old).intersection(table['rows']), 'Private key conflict: '+table['logical']
        added={k:base64.b64decode(v,validate=True) for k,v in table['rows'].items()}
        merged={**old,**added}; after=packmap(merged); readback=rawmap(after)
        assert readback==merged and list(readback)==list(merged)
        assert all(readback[k]==v for k,v in old.items())
        groups.setdefault(table['group'],{})[table['member']]=after
        preimages[table['logical']]=before
        tableproof.append({'logical':table['logical'],'source':provenance[table['member']],'oldRows':len(old),'addedKeys':list(added),'preimageSha256':sha(before),'sha256':sha(after),'allOldRawRowsPreserved':True})
    for resource in spec['resources']:
        assert not resource['logical'].startswith('master/'), 'Table masquerading as art'
        path=args.art_dir/resource['artArchive']
        with zipfile.ZipFile(path) as z: raw=z.read(resource['member'])
        assert len(raw)==resource['size'] and sha(raw)==resource['sha256'], 'Art drift: '+resource['logical']
        group=groups.setdefault(resource['group'],{})
        assert resource['member'] not in group
        group[resource['member']]=raw
    server={}; serverproof=[]
    for rel,additions in spec['serverAdditions'].items():
        relative=Path(rel); assert not relative.is_absolute() and '..' not in relative.parts
        before=readj(args.server_root/relative)
        assert isinstance(before,dict) and not set(before).intersection(additions), 'Server key conflict: '+rel
        merged={**before,**additions}; assert all(merged[k]==v for k,v in before.items())
        server[rel]=merged; serverproof.append({'path':rel,'oldKeys':len(before),'addedKeys':list(additions),'oldValuesPreserved':True})
    generated={}; records=[]
    for group,payload in sorted(groups.items()):
        name=f'pinball-{args.from_version}-{args.to_version}-{group}-{spec["id"]}.zip'
        raw=zipbytes(payload); assert len(raw)<5*1024*1024, 'Group exceeds 5 MiB; repartition explicitly'
        generated[name]=raw; records.append({'name':name,'size':len(raw),'sha256':sha(raw),'members':len(payload),'files':sorted(payload)})
    names=[r['name'] for r in records]
    members=[m for r in records for m in r['files']]; assert len(members)==len(set(members))
    entry={'id':spec['id']+'-'+args.to_version,'type':'patch','name':spec['name'],'description':'追加角色'+spec['characterId']+'及配套资源，保留'+args.from_version+'已有表行。','version':args.to_version,'depends_on':args.from_version,'enabled':True,'archive':names[0],'archive_size':sum(r['size'] for r in records),'chain':names,'files':sorted(members),'archive_integrity':records}
    def write(rel,raw):
        target=(out/rel).resolve(); assert target.is_relative_to(out)
        target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(raw)
    def save(rel,obj): write(rel,(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode())
    for name,raw in generated.items(): write('assets/asset-patch/active/'+name,raw)
    for rel,obj in server.items(): save(rel,obj)
    for rel,raw in preimages.items(): write('preimages/'+rel,raw)
    save('manifest-entry.json',entry); save('server-additions.json',spec['serverAdditions'])
    active_overlaps=[{'logical':r['logical'],**r['source']} for r in tableproof if r['source']['version']!=args.baseline_version]
    save('rebuild-proof.json',{'status':'PASS_OFFLINE','inputManifestSha256':sha(args.manifest.read_bytes()),'specSha256':sha(args.spec.read_bytes()),'tables':tableproof,'activeTableOverlapCount':len(active_overlaps),'activeTableOverlaps':active_overlaps,'activeTableOverlapPolicy':'Informational: merge declared rows over these effective active table preimages, preserving all old raw rows.','server':serverproof,'archives':records,'runtimeVerified':False,'deviceVerified':False})
    for record in records:
        path=out/'assets/asset-patch/active'/record['name']; assert sha(path.read_bytes())==record['sha256']
        inventory(path,record)
    print(json.dumps({'status':'PASS_OFFLINE','archives':len(records),'tables':len(tableproof),'activeTableOverlapCount':len(active_overlaps),'activeTableOverlaps':active_overlaps,'artResources':len(spec['resources']),'serverFiles':len(server)},ensure_ascii=False))

if __name__=='__main__': main()
