"""锁定基线上的追加式 ABC 编辑；不回编 AS3、不改变既有指令。"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'abcasm'))
import asm
import bodies
from swfabc import PoolEditor, SwfAbc

FMT = asm.load_abc_module('abcfmt')
MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
TOTALIZER = 'pinball.scene.battle.battle.ability::MemberAbilityTotalizerImpl'
ADDRESS = 'pinball.online.battle.address::InstantAbilityAddress'


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Editor:
    def __init__(self, swf):
        self.swf, self.abc = swf, swf.abc
        self.pool = PoolEditor(self.abc)
        self.locks = json.loads((HERE / 'baseline.json').read_text())
        self.insertions, self.new_methods, self.traits = {}, [], []
        self.before = self.abc.serialize()
        self._qcache = {}

    def q(self, name):
        if name in self._qcache:
            return self._qcache[name]
        matches = [i for i in range(1, len(self.abc.multinames))
                   if self.abc.multinames[i][0] == 7 and self.abc.mn_name(i) == name
                   and self.abc.namespaces[self.abc.multinames[i][1]][0] in (0x16, 0x08)]
        if len(matches) != 1:
            raise asm.AsmError(f'ambiguous or missing symbol {name}: {matches}')
        self._qcache[name] = matches[0]
        return matches[0]

    def newq(self, name):
        return self.pool.public_qname(name, self.q('index'))

    def number(self, n):
        if -128 <= n <= 127:
            return ('pushbyte', n & 255)
        if n < 0:
            raise asm.AsmError('negative constants must fit signed byte')
        return ('pushint', self.pool.integer(n))

    def string(self, text):
        # Index 0 is the ABC sentinel, not a usable pushstring literal.
        if text == '':
            matches = [i for i, value in enumerate(self.abc.strings) if i and value == b'']
            if not matches:
                raise asm.AsmError('baseline lacks an explicit empty string constant')
            return ('pushstring', matches[0])
        return ('pushstring', self.pool.string(text))

    def instance(self, cls):
        found = [(i, row) for i, row in enumerate(self.abc.instances)
                 if self.abc.mn_name(row[0]) == cls]
        if len(found) != 1:
            raise asm.AsmError(f'expected one class: {cls}')
        return found[0]

    def add_slot(self, cls, name, type_name, static=False):
        index, row = self.instance(cls)
        traits = self.abc.classes[index][1] if static else row[6]
        if any(self.abc.mn_name(t.name) == name for t in traits):
            raise asm.AsmError('already patched: ' + name)
        trait = FMT.Trait()
        trait.name, trait.kind, trait.attr = self.newq(name), 0, 0
        trait.data, trait.metadata = ['slot', 0, self.q(type_name), 0, None], []
        traits.append(trait)
        self.traits.append((cls, name, static))
        return trait.name

    def add_method(self, cls, name, returns, args, code, locals_, static=False):
        index, row = self.instance(cls)
        traits = self.abc.classes[index][1] if static else row[6]
        if any(self.abc.mn_name(t.name) == name for t in traits):
            raise asm.AsmError('already patched: ' + name)
        ins = asm.assemble(code)
        if any(x.target is not None and x.target >= len(ins) for x in ins):
            raise asm.AsmError('generated method branches past return: ' + name)
        # Symbolic assembler labels emit no byte. AVM2 requires a real label
        # opcode at loop entries, even when the rules array is empty at runtime.
        if any(x.target is not None and x.target <= i and ins[x.target].op != 0x09
               for i, x in enumerate(ins)):
            raise asm.AsmError('generated backward branch lacks AVM2 label: ' + name)
        metrics = asm.simulate(ins, 1, self.abc.multinames)
        if metrics[2] or asm.block_locals(ins) > locals_:
            raise asm.AsmError(f'invalid generated method: {name}: {metrics}')
        mi = len(self.abc.methods)
        self.abc.methods.append([self.q(returns), [self.q(x) for x in args], 0, 0, None, None])
        raw, _ = asm.encode(ins)
        self.abc.bodies.append([mi, max(1, metrics[0]), locals_, 1, metrics[1], raw, [], []])
        trait = FMT.Trait()
        trait.name, trait.kind, trait.attr = self.newq(name), 1, 0
        trait.data, trait.metadata = ['method', 0, mi], []
        traits.append(trait)
        self.new_methods.append({'name': name, 'body': len(self.abc.bodies)-1,
                                 'sha256': sha(raw), 'metrics': metrics})
        self.traits.append((cls, name, static))
        return trait.name

    def insert(self, method, at, code, incoming=asm.ENTER):
        self.insertions.setdefault(method, []).append((at, asm.assemble(code), incoming))

    def apply(self):
        report = {}
        for method, additions in self.insertions.items():
            body = self.abc.bodies[bodies.resolve(self.abc, method)]
            lock = self.locks[method]
            if sha(body[5]) != lock['sha'] or body[1:5] != lock['header']:
                raise asm.AsmError('unknown method baseline: ' + method)
            before = body[5]
            additions.sort(key=lambda row: row[0])
            code, exceptions, ins, recovery = asm.splice_many(body, additions)
            # Exact recovery catches branch relocations as well as unrelated edits.
            if asm.unsplice_many(code, recovery) != before:
                raise asm.AsmError('not reversible: ' + method)
            analysis = [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in ins]
            metrics = asm.simulate(analysis, body[3], self.abc.multinames)
            body[1] = max(body[1], metrics[0])
            body[2] = max(body[2], asm.block_locals(ins))
            if metrics[1] != body[4]:
                raise asm.AsmError('scope changed: ' + method)
            body[5], body[6] = code, exceptions
            report[method] = {'before': sha(before), 'after': sha(code),
                              'insertions': recovery, 'metrics': metrics}
        return report
