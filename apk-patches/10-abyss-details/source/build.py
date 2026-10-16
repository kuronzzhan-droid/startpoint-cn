"""Bounded cumulative LAN build and native AIR API checks; no runtime sync."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import zlib

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('abyss_details_swf', HERE/'build_swf.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
SDK = Path(r'F:\codex\ios-rush-leaderboard-port-20260830\AIRSDK_51.2.1.5')
JAVA = Path(r'D:\java\bin\java.exe')
FFDEC = Path(r'F:\codex\tools\ffdec_26.2.1\ffdec.jar')
air = b.module('abyss_details_air_validation', HERE/'air_validation.py')

def build(work, fixtures, *, run_air_tests=False):
    work.mkdir(parents=True,exist_ok=True)
    compiler = [JAVA,'-Dflexlib='+str(SDK/'frameworks'),'-Xmx512m','-jar']
    flags = ['+configname=air','-swf-version=44','-target-player=32.0']
    swc = work/'abyss-details.swc'
    b.run([*compiler,SDK/'lib/compc-cli.jar',*flags,'-compiler.source-path='+str(HERE/'src'),
        '-include-classes=cn.ui.AbyssDetails','-debug=false','-output='+str(swc)],work/'helper-compile.log')
    report = b.build(work,swc)
    state = air.validate(work, air_input_paths(work,fixtures), run_air_tests=run_air_tests,
        runner=lambda: run_native_air(work,fixtures,compiler,flags))
    print('Desktop AIR validation: '+state['status']+'; checks='+str(state['checks']),flush=True)
    classes=work/'classes';classes.mkdir(exist_ok=True)
    b.run([JAVA.with_name('javac.exe'),'-cp',FFDEC,'-d',classes,HERE/'CompareDetailBodies.java'],work/'comparer-compile.log')
    b.run([JAVA,'-Xmx2g','-cp',str(classes)+';'+str(FFDEC),'CompareDetailBodies',work/'input.swf',
        work/'abyss-details-lan.swf','285:71835,285:78350',285,report['helper_bodies']],work/'ffdec-body-check.log')
    b.run([JAVA,'-Xmx2g','-jar',FFDEC,'-selectclass',
        'pinball.ui.component.quest.QuestTranslator,pinball.scene.partySelect.topPanel.PartySelectTopPanelView,cn.ui.AbyssDetails',
        '-format','script:pcode','-export','script',work/'final-pcode',work/'abyss-details-lan.swf'],work/'ffdec-readback.log')
    print((work/'ffdec-body-check.log').read_text('utf8'),flush=True)

def air_input_paths(work, fixtures):
    return {'swf':work/'abyss-details-lan.swf', 'helper_source':HERE/'src/cn/ui/AbyssDetails.as',
        'harness_source':HERE/'tests/Harness.as', 'descriptor':HERE/'tests/harness-app.xml',
        'fixtures':fixtures, 'driver':HERE/'build.py', 'validation_policy':HERE/'air_validation.py'}


def run_native_air(work, fixtures, compiler, flags):
    print('Starting the requested desktop AIR check; the runtime may show its splash screen.',flush=True)
    app=work/'harness-app'; app.mkdir(exist_ok=True)
    sig,version,_,raw=b.swftags.load_swf(str(work/'abyss-details-lan.swf'))
    tags=list(b.swftags.iter_tags(raw)); pieces=[raw[:tags[0][1]]]; removed=[]
    for code,off,header,size in tags:
        tag=raw[off:off+header+size]
        if code==76:
            data=raw[off+header:off+header+size]; count=struct.unpack_from('<H',data)[0]; at=2; keep=[]
            for _ in range(count):
                start=at; identifier=struct.unpack_from('<H',data,at)[0];at=data.index(b'\0',at+2)+1
                if identifier==0: removed.append(data[start+2:at-1].decode())
                else: keep.append(data[start:at])
            payload=struct.pack('<H',len(keep))+b''.join(keep)
            tag=struct.pack('<HI',(76<<6)|63,len(payload))+payload
        pieces.append(tag)
    assert removed==['boot_ffc6']
    raw=b''.join(pieces)
    (app/'api-test.swf').write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    b.run([*compiler,SDK/'lib/mxmlc-cli.jar',*flags,'-default-size=540,960','-debug=true',
        '-output='+str(app/'harness.swf'),HERE/'tests/Harness.as'],work/'harness-compile.log')
    shutil.copy2(HERE/'tests/harness-app.xml',app/'harness-app.xml')
    shutil.copy2(fixtures,app/'floor-fixtures.json')
    b.run([SDK/'bin/adl64.exe','-nodebug',app/'harness-app.xml'],work/'harness-run.log',timeout=45)
    tests=json.loads((work/'harness-result.json').read_text('utf8'));assert tests['passed']


def parse_args(argv=None):
    parser=argparse.ArgumentParser();parser.add_argument('--work',type=Path,required=True)
    parser.add_argument('--fixtures',type=Path,required=True)
    parser.add_argument('--run-air-tests',action='store_true',
        help='Explicitly launch desktop AIR; may show the HARMAN splash screen. Default: static checks / exact cached results.')
    return parser.parse_args(argv)


if __name__=='__main__':
    args=parse_args()
    build(args.work.resolve(),args.fixtures.resolve(),run_air_tests=args.run_air_tests)
