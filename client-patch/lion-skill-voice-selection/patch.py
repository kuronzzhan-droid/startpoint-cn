"""只在当前 V16-plus 狮子技能语音池中去除两条已否决的中间录音。"""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'client-patch/abcasm'))
import asm
import bodies
from swfabc import SwfAbc
import ui_block

# 全文件及目标方法分别锁定，不接受只按版本名猜测的 SWF。
BASE_SHA = '2a514ff300dc2be2ef09a3d08aa0d2ae28e2ec2189aa44c6212dd40084a0ad42'
TARGET = 'CharacterShortVoiceLogic/get_skillVoicePaths'
BODY_SHA = '04016206d2129f275c2cfd0a0350c11f5df1968fdab8019e29c849648060340a'
CID = 119996
CODE = 'lion_swordman_reborn'
INSERT_AT = 6


def sha(data):
    return hashlib.sha256(data).hexdigest()


def block():
    # native generateVoicePaths returns a new array in contiguous suffix order.
    # Keep that array on the stack; splice affects only suffixes 2 and 3.
    return [('getlocal_0',), ('getproperty', 7439), ('pushint', 5756),
            ('ifne', 'END'), ('dup',), ('pushbyte', 2), ('pushbyte', 2),
            ('callpropvoid', 210, 2), ('label', 'END')]


def listing(body, abc, target=TARGET):
    lines = [f'; {target}', f'; maxstack={body[1]} localcount={body[2]} '
             f'initscope={body[3]} maxscope={body[4]}']
    for index, instruction in enumerate(asm.decode(body[5])):
        args = ', '.join(map(str, instruction.args))
        if instruction.target is not None:
            args += (' ' if args else '') + f'L{instruction.target:04d}'
        note = ''
        if instruction.name in ('getproperty', 'findproperty', 'callproperty', 'callpropvoid', 'coerce'):
            note = ' ; ' + abc.mn_name(instruction.args[0])
        elif instruction.name == 'pushint':
            note = ' ; ' + str(abc.ints[instruction.args[0]])
        elif instruction.name == 'pushstring':
            note = ' ; ' + abc.strings[instruction.args[0]].decode('utf-8')
        lines.append(f'L{index:04d}: {instruction.name} {args}'.rstrip() + note)
    return '\n'.join(lines) + '\n'


def apply(source, output, report):
    source, output, report = map(Path, (source, output, report))
    evidence = [report.parent / f'{kind}-{name}' for kind in ('skill', 'ready-ui')
                for name in ('before.pcode', 'after.pcode', 'method.diff')]
    destinations = [output, report, *evidence]
    if any(path.exists() for path in destinations):
        raise asm.AsmError('all candidate and evidence outputs must be new')
    if len({source.resolve(), *(p.resolve() for p in destinations)}) != len(destinations)+1:
        raise asm.AsmError('input and outputs must be distinct')
    if sha(source.read_bytes()) != BASE_SHA:
        raise asm.AsmError('input differs from the verified installed V16-plus SWF')
    swf = SwfAbc(source)
    abc = swf.abc
    index = bodies.resolve(abc, TARGET)
    original = [body[:] for body in abc.bodies]
    body = abc.bodies[index]
    if sha(body[5]) != BODY_SHA or body[1:5] != [2, 1, 1, 2] or body[6]:
        raise asm.AsmError('target method baseline differs')
    if abc.mn_name(7439) != 'characterId' or abc.ints[5756] != CID:
        raise asm.AsmError('character guard constant differs')
    if abc.mn_name(210) != 'http://adobe.com/AS3/2006/builtin::splice':
        raise asm.AsmError('native Array.splice constant differs')
    code, exceptions, instructions, locations = asm.splice_many(
        body, [(INSERT_AT, asm.assemble(block()), asm.ENTER)])
    if asm.unsplice_many(code, locations) != body[5]:
        raise asm.AsmError('original getter instructions changed')
    metrics = asm.simulate(instructions, body[3], abc.multinames)
    if metrics != (4, 2, 0):
        raise asm.AsmError(f'unexpected stack/scope requirement: {metrics}')
    body[1], body[5], body[6] = 4, code, exceptions
    ui_index = bodies.resolve(abc, ui_block.TARGET)
    ui_body = abc.bodies[ui_index]
    if sha(ui_body[5]) != ui_block.BODY_SHA or ui_body[1:5] != [4, 36, 1, 2] or ui_body[6]:
        raise asm.AsmError('ready UI method baseline differs')
    if any(abc.strings[i].decode('utf-8') != p for i, p in zip(ui_block.STRING_IDS, ui_block.PATHS)):
        raise asm.AsmError('ready UI path constants differ')
    ui_code, ui_exceptions, ui_instructions, ui_locations = asm.splice_many(
        ui_body, [(ui_block.INSERT_AT, asm.assemble(ui_block.block()), asm.ENTER)])
    if asm.unsplice_many(ui_code, ui_locations) != ui_body[5]:
        raise asm.AsmError('original UI instructions changed')
    ui_metrics = asm.simulate(ui_instructions, ui_body[3], abc.multinames)
    if ui_metrics[0] > ui_body[1] or ui_metrics[1] > ui_body[4]:
        raise asm.AsmError(f'UI insertion exceeds original header: {ui_metrics}')
    ui_body[5], ui_body[6] = ui_code, ui_exceptions
    changed = [i for i, (a, b) in enumerate(zip(original, abc.bodies)) if a != b]
    if set(changed) != {index, ui_index}:
        raise asm.AsmError('unexpected method body mutation')
    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    swf.save(output)
    for number, (target_name, target_index) in enumerate(((TARGET, index), (ui_block.TARGET, ui_index))):
        old_listing = listing(original[target_index], abc, target_name)
        new_listing = listing(abc.bodies[target_index], abc, target_name)
        evidence[number*3].write_text(old_listing, encoding='utf-8')
        evidence[number*3+1].write_text(new_listing, encoding='utf-8')
        evidence[number*3+2].write_text(''.join(difflib.unified_diff(old_listing.splitlines(True),
            new_listing.splitlines(True), fromfile='original '+target_name,
            tofile='selected Lion '+target_name)), encoding='utf-8')
    if sha(source.read_bytes()) != BASE_SHA:
        raise asm.AsmError('source changed during patch construction')
    result = dict(status='built_static_pending_verification', capability='lion-skill-voice-selection-v1',
        source=str(source), source_sha256=BASE_SHA, output=str(output), output_sha256=sha(output.read_bytes()),
        method=TARGET, body_index=index, before_code_sha256=BODY_SHA, after_code_sha256=sha(code),
        insertions=locations, before_header=original[index][1:5], after_header=body[1:5],
        unchanged_method_bodies=len(original)-2, constants_added=0, selected_suffixes=[0,1,4,5,6],
        removed_suffixes=[2,3], ready_ui=dict(method=ui_block.TARGET, body_index=ui_index,
            before_code_sha256=ui_block.BODY_SHA, after_code_sha256=sha(ui_code),
            insertions=ui_locations, header=ui_body[1:5], paths=[ui_block.PATHS[i] for i in (0,2,3)]),
        device_or_store_writes=False)
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'output'):
        parser.add_argument(name, type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(apply(args.source, args.output, args.report), ensure_ascii=False))
