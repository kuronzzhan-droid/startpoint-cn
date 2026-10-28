"""AVM exception-table dispatch for offline execution of actual method bodies.

Only explicit AvmThrow values model a VM/native exception. Python harness bugs
remain uncaught. No gameplay or diagnostic recovery behavior is modeled here.
"""
import asm


def inject_exception_dispatch(source):
    source = source.replace('        stack, scopes = [], list(scopes or [])',
        '        stack, scopes = [], list(scopes or [])\n        fp_entry_scopes = list(scopes)')
    start = source.index("            if op in ('nop',")
    end = source.index('\n\n\ndef slice_method', start)
    original = source[start:end]
    wrapped = '            try:\n' + ''.join(
        '    ' + line + '\n' for line in original.splitlines())
    wrapped += '''            except AvmThrow as error:
                handler = next((row for row in getattr(self, 'fp_handlers', [])
                                if row[0] <= pc - 1 < row[1]), None)
                if handler is None:
                    raise
                if handler[3] != 0:
                    raise AssertionError('typed AVM exception fixture unsupported')
                stack[:] = [error.value]
                scopes[:] = fp_entry_scopes
                pc = handler[2]
'''
    return source[:start] + wrapped.rstrip() + source[end:]


def install_handler_metadata(machine):
    original = machine.__init__

    def initialize(self, world, body):
        original(self, world, body)
        ins = asm.decode(body[5])
        _, offsets = asm.encode(ins)
        positions = {offset: index for index, offset in enumerate(offsets)}
        positions[len(body[5])] = len(ins)
        self.fp_handlers = [(positions[start], positions[end], positions[target], typ)
                            for start, end, target, typ, _ in body[6]]

    machine.__init__ = initialize
