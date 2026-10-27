import sys,json
from pathlib import Path
sys.path.insert(0,str(Path('run6').resolve()))
import bootstrap
from framework import Editor
from heal_damage import patches
from heal_fever import patches as fever
x=Editor(bootstrap.BASE)
x.locks['AbilityDamageShot/dispose']={'sha':'38d34ec0e14a2bb4a124fdc9c7d76a0a09e1f8a7603413db846d7278746ab002','header':[2,3,1,2]}
fever.build(x); print(patches.build(x)); x.apply(); print('okay',x.report)
x.swf.save(Path('run6/heal_damage/probe.swf'))
