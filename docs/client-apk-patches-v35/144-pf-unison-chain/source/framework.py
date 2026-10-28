"""按固定v35j方法锁编辑现有ABC；不反编译回编、不新增类。"""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import bootstrap
from bootstrap import ROOT
import asm
import bodies
from swfabc import PoolEditor, SwfAbc, abcfmt as FMT
from static_check import check_body


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Editor:
    def __init__(self, swf, locks=None):
        self.swf = SwfAbc(swf) if isinstance(swf, (str, Path)) else swf
        self.abc = self.swf.abc
        self.pool = PoolEditor(self.abc)
        self.locks = locks if locks is not None else json.loads((ROOT / 'baseline-locks.json').read_text(encoding='utf-8'))
        self.insertions, self.new_methods, self.traits = {}, [], []
        self.extra_editors = {}
        self.report, self._qcache = {}, {}
        self.original_count = len(self.abc.bodies)
        self.original_bodies = copy.deepcopy(self.abc.bodies)

    def q(self, name):
        if name in self._qcache:
            return self._qcache[name]
        hits = [i for i in range(1, len(self.abc.multinames))
                if self.abc.multinames[i][0] == 7 and self.abc.mn_name(i) == name
                and self.abc.namespaces[self.abc.multinames[i][1]][0] in (0x16, 0x08)]
        if len(hits) != 1:
            raise asm.AsmError(f'ambiguous or missing symbol {name}: {hits}')
        self._qcache[name] = hits[0]
        return hits[0]

    def newq(self, name):
        return self.pool.public_qname(name, self.q('index'))

    def number(self, n):
        if -128 <= n <= 127:
            return ('pushbyte', n & 255)
        for name, opcode in (('ints', 'pushint'), ('uints', 'pushuint'), ('doubles', 'pushdouble')):
            for i, value in enumerate(getattr(self.abc, name)):
                if i and value == n:
                    return (opcode, i)
        raise asm.AsmError('TASK12 forbids adding numeric pool constants: ' + str(n))

    def string(self, value):
        if value == '':
            matches = [i for i, s in enumerate(self.abc.strings) if i and s == b'']
            if not matches:
                self.abc.strings.append(b'')
                return ('pushstring', len(self.abc.strings) - 1)
            return ('pushstring', matches[0])
        return ('pushstring', self.pool.string(value))

    def instance(self, cls):
        found = [(i, row) for i, row in enumerate(self.abc.instances)
                 if self.abc.mn_name(row[0]) == cls]
        if len(found) != 1:
            raise asm.AsmError('expected one class: ' + cls)
        return found[0]

    def add_slot(self, cls, name, type_name, static=False):
        if not static:
            raise asm.AsmError('TASK12 only authorizes appended static slots')
        index, row = self.instance(cls)
        traits = self.abc.classes[index][1] if static else row[6]
        if any(self.abc.mn_name(t.name) == name for t in traits):
            raise asm.AsmError('already patched slot: ' + name)
        trait = FMT.Trait()
        trait.name, trait.kind, trait.attr = self.newq(name), 0, 0
        type_index = 0 if type_name == '*' else self.q(type_name)
        trait.data, trait.metadata = ['slot', 0, type_index, 0, None], []
        traits.append(trait)
        self.traits.append((cls, name, static))
        return trait.name

    def add_method(self, cls, name, returns, args, code, locals_, static=False):
        index, row = self.instance(cls)
        traits = self.abc.classes[index][1] if static else row[6]
        if any(self.abc.mn_name(t.name) == name for t in traits):
            raise asm.AsmError('already patched method: ' + name)
        ins = asm.assemble(code)
        metrics = asm.simulate(ins, 1, self.abc.multinames)
        if metrics[2] or asm.block_locals(ins) > locals_:
            raise asm.AsmError(f'invalid generated method: {name}: {metrics}')
        mi = len(self.abc.methods)
        type_index = lambda t: 0 if t == '*' else self.q(t)
        self.abc.methods.append([type_index(returns), [type_index(x) for x in args], 0, 0, None, None])
        raw, _ = asm.encode(ins)
        body = [mi, max(1, metrics[0]), locals_, 1, metrics[1], raw, [], []]
        checks = check_body(self.abc, body)
        self.abc.bodies.append(body)
        trait = FMT.Trait()
        trait.name, trait.kind, trait.attr = self.newq(name), 1, 0
        trait.data, trait.metadata = ['method', 0, mi], []
        traits.append(trait)
        label = cls.split('::')[-1] + ('$' if static else '') + '/' + name
        self.new_methods.append({'name': name, 'label': label, 'body': len(self.abc.bodies) - 1,
                                 'sha256': sha(raw), 'header': body[1:5], 'static_check': checks})
        self.traits.append((cls, name, static))
        bodies._CACHE.pop(id(self.abc), None)
        return trait.name

    def body(self, label):
        return self.abc.bodies[bodies.resolve(self.abc, label)]

    def replace(self, label, code_bytes, exceptions=None, header=None):
        body = self.body(label)
        lock = self.locks[label]
        if sha(body[5]) != lock['sha'] or body[1:5] != lock['header']:
            raise asm.AsmError('unknown method sha/header: ' + label)
        before = copy.deepcopy(body)
        body[5] = code_bytes
        if exceptions is not None:
            body[6] = exceptions
        if header is not None:
            body[1:5] = header
        ins = asm.decode(code_bytes)
        analysis = [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in ins]
        _, offsets = asm.encode(ins)
        pc = {offset: i for i, offset in enumerate(offsets)}
        metrics = asm.simulate(analysis, body[3], self.abc.multinames, [pc[x[2]] for x in body[6]])
        body[1] = max(body[1], metrics[0])
        body[2] = max(body[2], asm.block_locals(ins))
        if metrics[1] != body[4]:
            raise asm.AsmError('scope changed: ' + label)
        checks = check_body(self.abc, body)
        self.report[label] = {'body': bodies.resolve(self.abc, label),
                              'before': sha(before[5]), 'after': sha(body[5]),
                              'before_header': before[1:5], 'after_header': body[1:5],
                              'static_check': checks}

    def insert(self, label, at, code, incoming=asm.ENTER):
        self.insertions.setdefault(label, []).append((at, asm.assemble(code), incoming))

    def apply(self):
        for label, additions in self.insertions.items():
            body = self.body(label)
            additions.sort(key=lambda row: row[0])
            code, exceptions, ins, recovery = asm.splice_many(body, additions)
            if asm.unsplice_many(code, recovery) != body[5]:
                raise asm.AsmError('not reversible: ' + label)
            self.replace(label, code, exceptions)
            self.report[label]['insertions'] = recovery
        self.insertions.clear()
        return self.report
