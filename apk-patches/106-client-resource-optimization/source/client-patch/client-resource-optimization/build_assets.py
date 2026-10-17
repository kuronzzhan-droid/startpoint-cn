import argparse, hashlib, json, os, subprocess
from pathlib import Path

import importlib.util as _quiet_importlib
import sys as _quiet_sys
_quiet_spec = _quiet_importlib.spec_from_file_location("starpoint_quiet_process", Path(__file__).resolve().parents[1] / 'quiet_process.py')
quiet = _quiet_importlib.module_from_spec(_quiet_spec)
_quiet_sys.modules[_quiet_spec.name] = quiet
_quiet_spec.loader.exec_module(quiet)
HERE=Path(__file__).resolve().parent
SDK=Path(os.environ.get('STARPOINT_AIR_SDK', 'AIRSDK_51.2.1.5'))
JAVA=Path(os.environ.get('STARPOINT_JAVA', 'java'))
def compile_assets(work):
    work=Path(work);work.mkdir(parents=True,exist_ok=True)
    base=[str(JAVA),'-Dflexlib='+str(SDK/'frameworks'),'-Xmx1g','-jar',str(SDK/'lib/compc-cli.jar'),'+configname=air','-swf-version=44','-target-player=32.0','-debug=false','-compiler.float=false']
    cmds=[base+['-source-path='+str(HERE/'src'),'-include-classes=cn.optimize.resources.ResourceRuntime','-output='+str(work/'runtime.swc')],
          base+['-source-path='+str(HERE/'donor'),'-external-library-path+='+str(work/'runtime.swc'),'-include-classes=pinball.asset.file.FileStreamWithCounter,pinball.common.task.MultiTask,pinball.asset.file._FileReader.OpenHandler,pinball.asset.file.ReadPngTextureFileHandler,pinball.asset.file.BitmapTextureRestoreHandler,pinball.context.activity.ActivityUtil','-output='+str(work/'donor.swc')]]
    for i,command in enumerate(cmds):
        result=quiet.run(command,capture_output=True,timeout=120)
        (work/('compile-'+str(i)+'.log')).write_bytes(result.stdout+result.stderr)
        if result.returncode:raise RuntimeError('compile failed: '+str(work/('compile-'+str(i)+'.log')))
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    manifest={'compiler_float_false':True,'sdk':str(SDK),'commands':cmds,
              'source_files':{p.relative_to(HERE).as_posix():sha(p) for folder in ('src','donor') for p in sorted((HERE/folder).rglob('*.as'))},
              'runtime_swc_sha256':sha(work/'runtime.swc'),'donor_swc_sha256':sha(work/'donor.swc')}
    (work/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    return work
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('work',type=Path);a=p.parse_args();print(compile_assets(a.work))
