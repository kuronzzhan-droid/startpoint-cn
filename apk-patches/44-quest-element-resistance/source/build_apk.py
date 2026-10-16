"""Reproducible local build, bounded FFDec audit, exact-helper AIR tests and signing."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shutil
from build_channel import HERE, build, run, module

# The shared AVM2 model prepends its own directory to sys.path; bind this
# packager by its exact file so the historical Lens packager cannot win.
package = module('quest_element_packager', HERE/'package_apk.py').package

def main(args):
    work = args.work.resolve()
    assert not work.exists(), 'use a fresh task-specific build directory'
    assert '.cdn' not in str(work).lower().replace('\\','/').split('/')
    assert '.cdn' not in str(args.out.resolve()).lower().replace('\\','/').split('/')
    work.mkdir(parents=True)
    compiler = [args.java,'-Dflexlib='+str(args.sdk/'frameworks'),'-Xmx512m','-jar']
    target = ['+configname=air','-swf-version=44','-target-player=32.0']
    swc = work/'quest-element.swc'
    run([*compiler,args.sdk/'lib/compc-cli.jar',*target,'-compiler.source-path='+str(HERE/'src'),
         '-include-classes=cn.rules.QuestElementResistance','-debug=false','-output='+str(swc)],work/'helper-compile.log')
    build(work,swc,args.variant)
    classes = work/'classes'; classes.mkdir()
    run([args.java.with_name('javac.exe'),'-cp',args.ffdec,'-d',classes,HERE/'CompareChannelBodies.java'],work/'comparer-compile.log')
    run([args.java,'-Xmx2g','-cp',str(classes)+';'+str(args.ffdec),'CompareChannelBodies',
         work/f'accepted-{args.variant}.swf',work/f'quest-element-{args.variant}.swf','284:21496',284,5],work/'ffdec-body-check.log')
    run([args.java,'-Xmx2g','-jar',args.ffdec,'-selectclass',
         'pinball.common.data.quest.battle.BattleQuestBaseImpl,cn.rules.QuestElementResistance',
         '-format','script:pcode','-export','script',work/'final-pcode',work/f'quest-element-{args.variant}.swf'],work/'ffdec-readback.log')
    run([*compiler,args.sdk/'lib/mxmlc-cli.jar',*target,'-default-size=540,960','-debug=true',
         '-output='+str(work/'harness.swf'),HERE/'tests/Harness.as'],work/'harness-compile.log')
    app = work/'harness-app'; app.mkdir()
    for src in [work/'harness.swf',work/'helper-library.swf',HERE/'tests/harness-app.xml']:
        shutil.copy2(src,app/src.name)
    run([args.sdk/'bin/adl64.exe','-nodebug',app/'harness-app.xml'],work/'harness-run.log',timeout=45)
    tests = json.loads((work/'harness-result.json').read_text('utf8'))
    assert tests['passed']
    print('Exact helper AIR checks passed: '+str(len(tests['checks'])),flush=True)
    package(work,args.out.resolve(),args.java,args.build_tools)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--work',required=True,type=Path); p.add_argument('--out',required=True,type=Path)
    p.add_argument('--sdk',required=True,type=Path)
    p.add_argument('--variant',choices=['public','lan'],default='public')
    p.add_argument('--java',type=Path,default=Path(r'D:\java\bin\java.exe'))
    p.add_argument('--ffdec',type=Path,default=Path(r'F:\codex\tools\ffdec_26.2.1\ffdec.jar'))
    p.add_argument('--build-tools',type=Path,default=Path(r'F:\StartPointCN\wf_full_patch\build-tools'))
    main(p.parse_args())
