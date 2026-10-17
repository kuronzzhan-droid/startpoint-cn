"""Reject unknown target bytecode and an occupied output without writing a SWF."""
import argparse
import importlib.util
import json
from pathlib import Path

spec=importlib.util.spec_from_file_location('refusal_patch',Path(__file__).resolve().parents[1]/'patch_swf.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

def run(source,output):
    source,output=Path(source),Path(output)
    before=output.read_bytes()
    try:p.patch(source,output)
    except AssertionError:pass
    else:raise AssertionError('occupied output accepted')
    assert output.read_bytes()==before
    main=next(t[3] for t in p.s.parts(source)[2] if t[0]==82 and t[2][4:-1]==b'boot_ffc6')
    label='pinball.scene.character.characterTable::CharacterTable/applyCharacters|1'
    _,body=p.label_body(main,label);body[5]=b'\x47'
    try:p.optimize_methods(main)
    except AssertionError as e:assert str(e)=='unsupported target/reader: '+label
    else:raise AssertionError('unknown target accepted')
    result={'passed':True,'assertions':3,'occupied_output_preserved':True,'unknown_target_rejected':True}
    print(json.dumps(result))
    return result

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('source');a.add_argument('existing_output');args=a.parse_args();run(args.source,args.existing_output)
