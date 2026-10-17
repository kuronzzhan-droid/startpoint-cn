"""Method grafts and reversible owner hooks; append one uniquely named helper ABC."""
import argparse,copy,importlib.util,json,os,struct,zipfile,zlib
from pathlib import Path
from types import SimpleNamespace
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('resource_support',HERE.parent/'startup-cache/build_swf.py')
s=importlib.util.module_from_spec(sp);sp.loader.exec_module(s)
HELPER_NAME=b'cn.optimize.resources.ResourceRuntime'
ASSETS=os.environ.get('STARPOINT_RESOURCE_ASSETS')
_views={}
def view(a):
    key=id(a)
    if key not in _views:_views[key]=s.m.View(SimpleNamespace(abc=a),s.m.asm)
    return _views[key]
def library(path):
    swf=path.with_suffix('.swf')
    with zipfile.ZipFile(path) as z:swf.write_bytes(z.read('library.swf'))
    return [t for t in s.parts(swf)[2] if t[0]==82]
def q(a,ns,name):
    want=(7,(22,ns),name);v=view(a)
    hits=[i for i in range(1,len(a.multinames)) if v.mn(i)==want]
    if hits:return hits[0]
    pool=s.PoolEditor(a)
    spaces=[i for i,n in enumerate(a.namespaces) if i and n[0]==22 and a.s(n[1])==ns]
    if spaces:nsi=spaces[0]
    else:a.namespaces.append((22,pool.string(ns)));nsi=len(a.namespaces)-1
    a.multinames.append((7,nsi,pool.string(name)));return len(a.multinames)-1
def invoke(a,name,args):
    return s.m.asm.assemble([('getlex',q(a,'cn.optimize.resources','ResourceRuntime'))]+args+[('callpropvoid',q(a,'',name),len(args))])
GRAFTS=[
 'pinball.asset.file::FileStreamWithCounter/'+n+'|1' for n in ('openAsync','open','close','_openAsync','_close')
]+[
 'pinball.common.task::MultiTask/startNextTask|1','pinball.common.task::MultiTask/_startNextTask|1',
 'pinball.asset.file._FileReader::OpenHandler/execute|1',
 'pinball.asset.file::ReadPngTextureFileHandler/_uploadPng|1',
 'pinball.asset.file::BitmapTextureRestoreHandler/restoreHandler|1',
 'pinball.asset.file::BitmapTextureRestoreHandler/uploadPng|1']
CTORS={
 'pinball.asset.file._FileReader::OpenHandler/<ctor>':'attachOpen',
 'pinball.asset.file::ReadPngTextureFileHandler/<ctor>':'attachPng',
 'pinball.asset.file::ReadAtfTextureFileHandler/<ctor>':'attachAtf',
 'pinball.asset.file::BitmapTextureRestoreHandler/<ctor>':'attachRestore'}
PREFIX='pinball.asset.view::ViewAssetCache/'
INSERTS=list(CTORS)+['pinball.asset.file::ReadAtfTextureFileHandler/uploadAtf|1']+[
 PREFIX+n+'|1' for n in ('dispose','readTextureHandler','readTexture','downloadTexture','startOtherLoad','addGroup')]
INSERTS+=['pinball.asset.view::ViewAssetCache$/disposeDownloadedTexture|1']
def replace_bodies(a,donor_tags,labels=GRAFTS):
    target=view(a);changes=[]
    for label in labels:
        bi,=target.by_label[label]
        donors=[(view(t[3]),view(t[3]).by_label[label][0]) for t in donor_tags if label in view(t[3]).by_label]
        donor,di=donors[0];assert len(donors)==1,label
        old=a.bodies[bi]; imp=s.m.Importer(target,donor)
        a.bodies[bi]=imp.body(di,old[0],scope=old[3])
        assert not imp.method_changes and len(a.bodies[bi][7])==0
        check=s.m.check_body(a.bodies[bi],a)
        assert check['max_stack']<=a.bodies[bi][1] and check['max_scope']<=a.bodies[bi][4]
        changes.append({'method':label,'body':bi,'kind':'compiled-body-graft','donor_code_sha256':s.sha(donor.a.bodies[di][5]),'check':check})
    return changes
def insert(a,label,edits):
    bi,=view(a).by_label[label];body=a.bodies[bi];original=bytes(body[5])
    body[5],body[6],_,placed=s.m.asm.splice_many(body,edits)
    assert s.m.asm.unsplice_many(body[5],placed)==original
    body[1]+=3
    check=s.m.check_body(body,a);body[1]=max(body[1],check['max_stack']);body[4]=max(body[4],check['max_scope'])
    return {'method':label,'body':bi,'kind':'reversible-insertion','instructions':sum(len(e[1]) for e in edits),'check':check}
def owner_hooks(a):
    changes=[]
    for label,method in CTORS.items():
        bi,=view(a).by_label[label];rows=s.m.asm.decode(a.bodies[bi][5]);assert rows[-1].op==0x47
        changes.append(insert(a,label,[(len(rows)-1,invoke(a,method,[('getlocal_0',)]),s.m.asm.ENTER)]))
    label='pinball.asset.file::ReadAtfTextureFileHandler/uploadAtf|1'
    block=s.m.asm.assemble([('getlex',q(a,'cn.optimize.resources','ResourceRuntime')),('getlocal_0',),('callproperty',q(a,'','allow'),1),('iftrue','proceed'),('getlocal_0',),('getproperty',q(a,'','byteArray')),('callpropvoid',q(a,'','clear'),0),('returnvoid',),('label','proceed')])
    changes.append(insert(a,label,[(0,block,s.m.asm.ENTER)]))
    for name,method,args in [('dispose','cancelOwner',[('getlocal_0',)]),('readTextureHandler','bindTexture',[('getlocal_0',),('getlocal_3',)])]:
        changes.append(insert(a,PREFIX+name+'|1',[(0,invoke(a,method,args),s.m.asm.ENTER)]))
    changes.append(insert(a,'pinball.asset.view::ViewAssetCache$/disposeDownloadedTexture|1',[(0,invoke(a,'forgetTexture',[('getlocal_2',)]),s.m.asm.ENTER)]))
    for name,called in [('readTexture','readTextureFile'),('downloadTexture','downloadTextureFile')]:
        label=PREFIX+name+'|1';bi,=view(a).by_label[label];v=view(a);rows=s.m.asm.decode(a.bodies[bi][5])
        positions=[i for i,r in enumerate(rows) if r.op in (0x46,0x4f) and v.mn(r.args[0])[-1]==called and r.args[1]==2]
        assert len(positions)==1,(name,positions)
        block=s.m.asm.assemble([('getlex',q(a,'cn.optimize.resources','ResourceRuntime')),('swap',),('getlocal_0',),('callproperty',q(a,'','register'),2)])
        changes.append(insert(a,label,[(positions[0],block,s.m.asm.ENTER)]))
    for name in ('startOtherLoad','addGroup'):
        label=PREFIX+name+'|1';bi,=view(a).by_label[label];v=view(a);rows=s.m.asm.decode(a.bodies[bi][5])
        positions=[i+1 for i,r in enumerate(rows) if r.op==0x4a and v.mn(r.args[0])==(7,(22,'pinball.common.task'),'MultiTask') and r.args[1]==0]
        assert len(positions)==1,(name,positions)
        block=s.m.asm.assemble([('getlex',q(a,'cn.optimize.resources','ResourceRuntime')),('swap',),('getlocal_0',),('callproperty',q(a,'','ownTask'),2)])
        changes.append(insert(a,label,[(positions[0],block,s.m.asm.ENTER)]))
    return changes
def pack_tag(tag):
    data=tag[2]+s.serialize(tag[3],tag[4]);tag[1]=struct.pack('<HI',(82<<6)|63,len(data))+data
def write_swf(version,header,tags,path):
    raw=header+b''.join(t[1] for t in tags);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
def patch(source,output,assets=ASSETS):
    source,output=Path(source).resolve(),Path(output).resolve();assert source!=output and not output.exists()
    assert '.cdn' not in [p.lower() for p in output.parts]
    assert assets is not None, 'pass --assets or set STARPOINT_RESOURCE_ASSETS'
    assets=Path(assets);manifest=json.loads((assets/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['compiler_float_false'] is True
    for name,digest in manifest['source_files'].items():assert s.sha((HERE/name).read_bytes())==digest,'stale compiled source: '+name
    for name in ('runtime','donor'):assert s.sha((assets/(name+'.swc')).read_bytes())==manifest[name+'_swc_sha256'],'compiled artifact mismatch'
    version,header,tags=s.parts(source);main,=[t for t in tags if t[0]==82 and t[2][4:-1]==b'boot_ffc6']
    assert not any(t[0]==82 and t[2][4:-1]==HELPER_NAME for t in tags),'helper already present'
    old=copy.deepcopy(main[3]);v=view(main[3]);pins=json.loads((HERE/'method-pins.json').read_text())
    for label in GRAFTS+INSERTS:
        bi,=v.by_label[label];assert s.sha(main[3].bodies[bi][5])==pins[label]['sha'],'unsupported original method: '+label
    changes=replace_bodies(main[3],library(Path(assets)/'donor.swc'))+owner_hooks(main[3])
    expected=sorted(c['body'] for c in changes)
    actual=[i for i,b in enumerate(main[3].bodies) if s.m.freeze(b)!=s.m.freeze(old.bodies[i])];assert actual==expected
    for field in ('methods','metadata','instances','classes','scripts'):
        assert s.m.freeze(getattr(old,field))==s.m.freeze(getattr(main[3],field)),field
    assert len(old.bodies)==len(main[3].bodies)
    for field in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames'):
        assert s.m.freeze(getattr(main[3],field)[:len(getattr(old,field))])==s.m.freeze(getattr(old,field)),field
    pack_tag(main)
    helper,=library(Path(assets)/'runtime.swc');helper[2]=struct.pack('<I',1)+HELPER_NAME+b'\0';pack_tag(helper)
    index=next(i for i,t in enumerate(tags) if t is main);tags.insert(index,helper);write_swf(version,header,tags,output)
    _,header2,final=s.parts(output);assert header2==header and len(final)==len(tags)
    assert all(t[1]==f[1] for t,f in zip(tags,final)),'serialized readback mismatch'
    assert [helper[3].minor,helper[3].major]==[16,46],'compiler must emit native ABC46'
    report={'input_swf_sha256':s.sha(source.read_bytes()),'output_swf_sha256':s.sha(output.read_bytes()),'helper_abc_name':HELPER_NAME.decode(),'helper_abc_sha256':s.sha(helper[4]),'helper_abc_version':[helper[3].minor,helper[3].major],'compiled_asset_manifest':manifest,'changes':changes,'changed_main_bodies':expected,'game_class_layouts_preserved':True,'existing_pools_prefix_preserved':True,'unrelated_tags_preserved':True,'texture_capacity_and_format_changed':False}
    output.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);p.add_argument('--assets',type=Path,default=ASSETS);a=p.parse_args();print(json.dumps(patch(a.input,a.output,a.assets),ensure_ascii=False))
