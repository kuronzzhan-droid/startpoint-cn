"""Inline the existing UID parser without changing its decisions or its owner."""
import hashlib

import asm


PARSER = 'MemberView/wfxDualFormUid'
DEPENDENCIES = {
    PARSER: ('c8f821b6f6aa9b5456507094a6694b8c3ac5f74da7211d8fa0c638f501a460ad', [4, 6, 1, 2]),
    'MemberView/draw': ('d554f876ffe9149d17797abbf77ac6eb7ee22f4ebf04626c587eb27b6b31dbde', [4, 26, 1, 2]),
    'Battle$/wfxPfParseUInt': ('5ada965be7bfd983277a4f7f1523fd61b4434d184b40428df4e288c11163cc8f', [2, 7, 1, 2]),
}


def parser_block(editor, first_local):
    """Leave the original parser's int result on the stack; use five fresh locals."""
    for label, (expected, header) in DEPENDENCIES.items():
        body = editor.body(label)
        if hashlib.sha256(body[5]).hexdigest() != expected or body[1:5] != header:
            raise asm.AsmError('dual-form dependency differs from p10: ' + label)
    body = editor.body(PARSER)
    original = asm.decode(body[5])
    if body[6] or [op.name for op in original[:2]] != ['getlocal_0', 'pushscope']:
        raise asm.AsmError('unexpected dual-form parser scope/exception layout')
    code = [('getlocal_0',), ('callproperty', editor.q('get_characterTags'), 0),
            ('setlocal', first_local)]
    for index, op in enumerate(original[2:], 2):
        code.append(('label', f'PARSER_{index}'))
        if op.name == 'returnvalue':
            code.append(('jump', 'PARSER_DONE'))
        elif op.target is not None:
            code.append((op.name, f'PARSER_{op.target}'))
        elif op.name.startswith(('getlocal_', 'setlocal_')):
            name, slot = op.name.rsplit('_', 1)
            if not 1 <= int(slot) <= 5:
                raise asm.AsmError('parser unexpectedly reads its receiver')
            code.append((name, first_local + int(slot) - 1))
        elif op.name in ('getlocal', 'setlocal', 'inclocal_i'):
            if not 1 <= op.args[0] <= 5:
                raise asm.AsmError('unexpected parser local')
            code.append((op.name, first_local + op.args[0] - 1))
        else:
            if op.cases is not None:
                raise asm.AsmError('unexpected parser switch')
            code.append((op.name, *op.args))
    code.append(('label', 'PARSER_DONE'))
    return asm.assemble(code)
