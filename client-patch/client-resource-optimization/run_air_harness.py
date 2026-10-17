"""Run production method bytes on AIR with native FileStream and controlled GPU factory."""
import argparse,json,subprocess
from pathlib import Path
from patch_swf import s,view,GRAFTS,CTORS,pack_tag,write_swf,q,HELPER_NAME
from build_assets import SDK,JAVA,HERE
def run(work,source,assets):
    work=Path(work);work.mkdir(parents=True,exist_ok=False)
    original=work/'fixture-original.swf'
    command=[str(JAVA),'-Dflexlib='+str(SDK/'frameworks'),'-Xmx1g','-jar',str(SDK/'lib/mxmlc-cli.jar'),'+configname=air','-swf-version=44','-target-player=32.0','-debug=false','-compress=false','-compiler.float=false','-source-path='+str(HERE/'tests')+','+str(HERE/'donor'),'-external-library-path+='+str(Path(assets)/'runtime.swc'),'-output='+str(original),str(HERE/'tests/RuntimeHarness.as')]
    compiled=subprocess.run(command,capture_output=True,timeout=120);(work/'compile.log').write_bytes(compiled.stdout+compiled.stderr)
    assert compiled.returncode==0,'fixture compile failed'
    version,header,tags=s.parts(original);game=s.parts(Path(source))[2]
    main,=[t for t in game if t[0]==82 and t[2][4:-1]==b'boot_ffc6'];donor=view(main[3])
    helper,=[t for t in game if t[0]==82 and t[2][4:-1]==HELPER_NAME]
    labels=GRAFTS+list(CTORS)+['pinball.asset.file::ReadAtfTextureFileHandler/uploadAtf|1','pinball.asset.file::ReadAtfTextureFileHandler/atfReadHandler|1','pinball.common.task::MultiTask/run|1','pinball.common.task::MultiTask/add|1','pinball.common.task::MultiTask/<ctor>','pinball.asset.file::FileStreamWithCounter/<ctor>']
    grafts=[]
    for label in labels:
        matches=[(t,view(t[3]).by_label[label][0]) for t in tags if t[0]==82 and label in view(t[3]).by_label];assert len(matches)==1,label
        tag,bi=matches[0];target=view(tag[3]);di,=donor.by_label[label];old=target.a.bodies[bi];imp=s.m.Importer(target,donor)
        # The game has its own Haxe Date.now; the fixture clock is a controlled dependency.
        for index in range(1,len(donor.a.multinames)):
            if donor.mn(index)==(7,(22,''),'Date'):imp.cache[('multinames',index)]=q(target.a,'','FixtureClock')
        target.a.bodies[bi]=imp.body(di,old[0],scope=old[3]);check=s.m.check_body(target.a.bodies[bi],target.a)
        norm1=donor.normalized(di);norm2=target.normalized(bi)
        # Only Date QName is intentionally mapped; method bodies and exception tables otherwise match.
        def clock(value):
            if value==(7,(22,''),'Date'):return (7,(22,''),'FixtureClock')
            if isinstance(value,(tuple,list)):return tuple(clock(x) for x in value)
            return value
        assert clock(norm1)==clock(norm2),label
        grafts.append({'method':label,'production_body':di,'code_sha256':s.sha(donor.a.bodies[di][5]),'normalized_equal':True,'check':check})
    for tag in tags:
        if tag[0]==82:pack_tag(tag)
    tags.insert(next(i for i,t in enumerate(tags) if t[0]==82),helper)
    write_swf(version,header,tags,work/'RuntimeHarness.swf')
    xml='''<?xml version="1.0" encoding="utf-8"?><application xmlns="http://ns.adobe.com/air/application/51.0"><id>cn.optimize.resource.fixture</id><versionNumber>1.0</versionNumber><filename>ResourceFixture</filename><initialWindow><content>RuntimeHarness.swf</content><visible>false</visible><width>1</width><height>1</height></initialWindow></application>'''
    (work/'app.xml').write_text(xml,encoding='utf-8')
    try:
        result=subprocess.run([str(SDK/'bin/adl.exe'),str(work/'app.xml'),str(work)],capture_output=True,timeout=30)
    except subprocess.TimeoutExpired as error:
        (work/'adl.log').write_bytes((error.stdout or b'')+(error.stderr or b''));raise
    (work/'adl.log').write_bytes(result.stdout+result.stderr)
    report=json.loads((work/'runtime-tests.json').read_text())
    report.update({'adl_exit_code':result.returncode,'production_swf_sha256':s.sha(Path(source).read_bytes()),'production_grafted_methods':grafts,'helper_byte_exact_from_production':True,'native_version_compiler_float_false':True,'scope':'real AIR production helper + production methods listed below; native FileStream/ByteArray/BitmapData, controlled Texture/Activity/Progress/Clock dependencies; no game scene/device/GPU acceptance'})
    (work/'runtime-tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    assert result.returncode==0 and report['passed'],report['failures']
    print(json.dumps({'passed':True,'assertions':len(report['assertions']),'grafts':len(grafts),'adl_exit_code':result.returncode}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('work',type=Path);p.add_argument('--source',type=Path,required=True);p.add_argument('--assets',type=Path,required=True);a=p.parse_args();run(a.work,a.source,a.assets)
