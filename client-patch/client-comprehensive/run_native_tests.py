import argparse,importlib.util,json,os,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('native_tools',HERE.parent/'startup-cache/build_periodic_apk.py')
n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n)
def run(work):
    work.mkdir(parents=True,exist_ok=False)
    stubs=work/'stubs'
    for relative,content in n.STUBS.items():
        path=stubs/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content)
    identity=stubs/'cn/startpoint/BuildIdentity.java';identity.parent.mkdir(parents=True,exist_ok=True)
    identity.write_text('package cn.startpoint; final class BuildIdentity { static final String ID="fixture-id"; }')
    classes=work/'classes';classes.mkdir()
    java=Path(os.environ.get('STARPOINT_JAVA','java'))
    n.run([java.with_name('javac.exe'),'--release','8','-d',classes,*stubs.rglob('*.java'),
      HERE/'native/cn/startpoint/StartupCache.java',HERE/'tests/StartupCacheTest.java'],work,'compile')
    result=n.run([java,'-cp',classes,'cn.startpoint.StartupCacheTest',work/'fixture'],work,'test')
    assert 'PASS assertions=' in result
    report={'passed':True,'output':result.strip(),'scope':'JVM real helper methods; Android framework stubs, not device acceptance'}
    (work/'native-tests.json').write_text(json.dumps(report,indent=2)+'\n');return report
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('work',type=Path);print(json.dumps(run(ap.parse_args().work),indent=2))
