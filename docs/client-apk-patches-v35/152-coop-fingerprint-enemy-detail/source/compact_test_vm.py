"""Finite AVM fixture: UTF-16 native strings and bytecode instruction accounting."""
import types
import fp_test_vm

VM = fp_test_vm.VM
if not getattr(VM, '_compact_utf16', False):
    _base_lookup = VM._lookup

    def _lookup(obj, key):
        if isinstance(obj, str):
            name = str(key).split('::')[-1]
            raw = obj.encode('utf-16-le', 'surrogatepass')
            if name == 'length':
                return len(raw) // 2
            if name == 'charCodeAt':
                return lambda i: int.from_bytes(raw[int(i) * 2:int(i) * 2 + 2], 'little')
            if name == 'charAt':
                return lambda i: raw[int(i) * 2:int(i) * 2 + 2].decode('utf-16-le', 'surrogatepass')
        return _base_lookup(obj, key)

    VM._lookup = _lookup
    VM._compact_utf16 = True


def make_world(abc):
    world = fp_test_vm.make_world(abc)
    world.instruction_counts = {}
    world.method_calls = {}

    def run_body(self, body, args, scopes=None):
        self.executed.add(body[0])
        machine = fp_test_vm.Machine(self, body)
        machine.max_steps = 5_000_000
        try:
            return machine.run(fp_test_vm.module.instructions(bytes(body[5])), args, scopes)
        finally:
            self.instruction_counts[body[0]] = self.instruction_counts.get(body[0], 0) + machine.steps
            self.method_calls[body[0]] = self.method_calls.get(body[0], 0) + 1

    world.run_body = types.MethodType(run_body, world)
    return world
