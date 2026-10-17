"""Whole-file invariants plus an independent FFDec method-body/exception-table comparison."""
import argparse,importlib.util,json,os,subprocess
from pathlib import Path

import importlib.util as _quiet_importlib
import sys as _quiet_sys
_quiet_spec = _quiet_importlib.spec_from_file_location("starpoint_quiet_process", Path(__file__).resolve().parents[1] / 'quiet_process.py')
quiet = _quiet_importlib.module_from_spec(_quiet_spec)
_quiet_sys.modules[_quiet_spec.name] = quiet
_quiet_spec.loader.exec_module(quiet)
from types import SimpleNamespace
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('comprehensive_swf',HERE.parent/'startup-cache/build_swf.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)

def verify(source,candidate,expected_path,work,java=None,ffdec=None):
    expected=json.loads(expected_path.read_text('utf-8'))
    ver0,header0,tags0=s.parts(source);ver1,header1,tags1=s.parts(candidate)
    assert (ver0,header0)==(ver1,header1),'SWF header changed'
    def abcs(tags):
        result={}
        for t in tags:
            if t[0]==82:
                name=t[2][4:-1].decode();key=name;occurrence=1
                while key in result:
                    occurrence+=1;key=name+'#'+str(occurrence)
                result[key]=t
        return result
    before,after=abcs(tags0),abcs(tags1)
    helpers=set(after)-set(before);assert helpers==set(expected['helpers']),(helpers,expected['helpers'])
    assert set(before)<=set(after)
    assert [t[1] for t in tags0 if t[0]!=82]==[t[1] for t in tags1 if t[0]!=82],'non-ABC tag change'
    assert [t[2] for t in tags0 if t[0]==82]==[t[2] for t in tags1 if t[0]==82 and t[2][4:-1].decode() in before]
    changed=[];count=0;details=[]
    for name,oldtag in before.items():
        newtag=after[name];a,b=oldtag[3],newtag[3]
        assert a.major==b.major and a.minor==b.minor
        assert len(a.bodies)==len(b.bodies);count+=len(a.bodies)
        for field in ('methods','instances','classes','scripts','metadata'):
            assert s.m.freeze(getattr(a,field))==s.m.freeze(getattr(b,field)),(name,field)
        for field in ('strings','ints','uints','doubles','namespaces','ns_sets','multinames'):
            left=getattr(a,field);assert s.m.freeze(left)==s.m.freeze(getattr(b,field)[:len(left)]),(name,field)
        v=s.m.View(SimpleNamespace(abc=b),s.m.asm)
        for i,(left,right) in enumerate(zip(a.bodies,b.bodies)):
            if s.m.freeze(left)!=s.m.freeze(right):
                key=name+':'+str(i);changed.append(key)
                assert left[0]==right[0] and s.m.freeze(left[7:])==s.m.freeze(right[7:]),(key,'body method/traits')
                details.append({'id':key,'labels':[k for k,value in v.by_label.items() if i in value],
                  'code_sha256':s.sha(right[5]),'check':s.m.check_body(right,b)})
    assert count==96706,count
    assert set(changed)==set(expected['changed_methods']),(sorted(changed),expected['changed_methods'])
    for name in helpers:
        a=after[name][3];assert a.major==46
        assert all(a.mn_name(i[0]).startswith(('cn.optimize.network::','cn.optimize.data::','cn.optimize.ui::','cn.optimize.resources::')) for i in a.instances)
    work.mkdir(parents=True,exist_ok=False)
    java=Path(java or os.environ.get('STARPOINT_JAVA','java'))
    ffdec=Path(ffdec or os.environ['STARPOINT_FFDEC_JAR'])
    javac=java.with_name('javac.exe') if java.parent!=Path('.') else Path('javac')
    classes=work/'classes';classes.mkdir()
    def run(command,label):
        result=quiet.run([str(x) for x in command],capture_output=True,timeout=180)
        (work/(label+'.log')).write_bytes(result.stdout+result.stderr);assert result.returncode==0,label
        return result.stdout.decode()
    run([javac,'-cp',ffdec,'-d',classes,HERE/'CompareNamedBodies.java'],'compile')
    output=run([java,'-Xmx2g','-cp',str(classes)+';'+str(ffdec),'CompareNamedBodies',source,candidate],'ffdec')
    fields=dict(line.strip().split('=',1) for line in output.splitlines() if '=' in line)
    assert int(fields['method_bodies'])==count
    assert set(fields['changed'].split(','))==set(changed)
    assert set(fields['helpers'].split(','))==helpers
    report={'passed':True,'baseline_sha256':s.sha(source.read_bytes()),'swf_sha256':s.sha(candidate.read_bytes()),
      'original_method_bodies':count,'changed_methods':sorted(changed),'helpers':sorted(helpers),
      'new_helper_bodies':int(fields['added_bodies']),'original_layout_and_signatures_preserved':True,
      'constant_pool_prefixes_preserved':True,'non_abc_tags_preserved':True,'independent_ffdec_agrees':True,'details':details}
    (work/'swf-verification.json').write_text(json.dumps(report,indent=2)+'\n');return report
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('baseline',type=Path);ap.add_argument('candidate',type=Path)
    ap.add_argument('--expected',type=Path,required=True);ap.add_argument('--work',type=Path,required=True)
    ap.add_argument('--java',type=Path);ap.add_argument('--ffdec',type=Path)
    a=ap.parse_args();print(json.dumps(verify(a.baseline,a.candidate,a.expected,a.work,a.java,a.ffdec),indent=2))
