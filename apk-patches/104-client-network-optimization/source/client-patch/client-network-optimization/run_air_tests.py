"""Run exact network bytecode insertions and real manager methods in a hidden AIR fixture."""
import argparse,json,struct,subprocess,zlib
from pathlib import Path

import importlib.util as _quiet_importlib
import sys as _quiet_sys
_quiet_spec = _quiet_importlib.spec_from_file_location("starpoint_quiet_process", Path(__file__).resolve().parents[1] / 'quiet_process.py')
quiet = _quiet_importlib.module_from_spec(_quiet_spec)
_quiet_sys.modules[_quiet_spec.name] = quiet
_quiet_spec.loader.exec_module(quiet)
from patch_swf import s,view,q,start_block,error_block,SDK,JAVA,HERE

def run(work,game):
    work.mkdir(parents=True,exist_ok=False)
    command=[JAVA,'-Dflexlib='+str(SDK/'frameworks'),'-Xmx512m','-jar',SDK/'lib/mxmlc-cli.jar',
      '+configname=air','-swf-version=32','-target-player=21.0','-debug=false','-compress=false','-compiler.float=false',
      '-compiler.source-path='+str(HERE/'tests'),'-compiler.source-path+='+str(HERE/'src'),
      '-output='+str(work/'fixture.swf'),HERE/'tests/RuntimeHarness.as']
    result=quiet.run([str(x) for x in command],capture_output=True,timeout=120)
    (work/'compile.log').write_bytes(result.stdout+result.stderr)
    assert result.returncode==0,'compile: '+str(work/'compile.log')
    version,header,tags=s.parts(work/'fixture.swf')
    donor,=[t[3] for t in s.parts(game)[2] if t[0]==82 and t[2][4:-1]==b'boot_ffc6']
    dv=view(donor);grafts=[]
    def locate(suffix):
        hits=[(t,indices[0]) for t in tags if t[0]==82 for label,indices in view(t[3]).by_label.items() if label.endswith(suffix)]
        assert len(hits)==1,(suffix,len(hits));return hits[0]
    for name in ('startProbe','errorProbe'):
        tag,bi=locate('QueueProbe/'+name+'|1');a=tag[3];body=a.bodies[bi]
        assert [i.op for i in s.m.asm.decode(body[5])]==[0x47]
        if name=='startProbe':
            suffix=s.m.asm.assemble([('getlocal_0',),('getlocal_3',),('setproperty',q(a,'','actualStarted')),
              ('getlocal_0',),('dup',),('getproperty',q(a,'','sends')),('increment_i',),('setproperty',q(a,'','sends')),('returnvoid',)])
            body[5]=s.m.asm.encode(start_block(a)+suffix)[0]
        else:body[5]=s.m.asm.encode(error_block(a)+s.m.asm.assemble([('returnvoid',)]))[0]
        body[1]=8
        body[1]=s.m.check_body(body,a)['max_stack']
    for name in ('addEventListeners','removeListeners','onTimeout','close','onProgress','onHttpStatus','onIoError','onSecurityError'):
        label='pinball.context.remote::RemoteEventListenerManager/'+name+'|1'
        source,=dv.by_label[label];tag,bi=locate('RemoteEventListenerManager/'+name+'|1')
        a=tag[3];body=a.bodies[bi];imp=s.m.Importer(view(a),dv)
        a.bodies[bi]=imp.body(source,body[0],scope=body[3]);s.m.check_body(a.bodies[bi],a)
        grafts.append({'label':label,'source_code_sha256':s.sha(donor.bodies[source][5])})
    for tag in tags:
        if tag[0]==82:
            payload=tag[2]+s.serialize(tag[3],tag[4]);tag[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
    raw=header+b''.join(t[1] for t in tags)
    (work/'RuntimeHarness.swf').write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    try:
        result=quiet.run([str(SDK/'bin/adl.exe'),str(HERE/'tests/harness-app.xml'),str(work)],capture_output=True,timeout=15)
    except subprocess.TimeoutExpired as error:
        (work/'adl.log').write_bytes((error.stdout or b'')+(error.stderr or b''))
        raise
    (work/'adl.log').write_bytes(result.stdout+result.stderr)
    assert (work/'runtime-tests.json').exists(),'runtime: '+str(work/'adl.log')
    report=json.loads((work/'runtime-tests.json').read_text());report.update({'adl_exit_code':result.returncode,'grafted_methods':grafts,
      'scope':'production insertions and eight actual manager methods; controlled transport events, not device or live HTTP'})
    (work/'runtime-tests.json').write_text(json.dumps(report,indent=2)+'\n')
    assert result.returncode==0 and report['passed'],report
    return report
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('work',type=Path);ap.add_argument('--game-source',type=Path,required=True)
    args=ap.parse_args();print(json.dumps(run(args.work,args.game_source),indent=2))
