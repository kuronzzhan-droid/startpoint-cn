"""使用独立解析器核验既有方法、类槽及常量池仅发生声明过的追加。"""
import importlib.util
from core import HERE, asm, bodies


def verify_editor(e, methods):
    path = HERE.parent / 'rank-scene-p2/independent/myabc.py'
    spec = importlib.util.spec_from_file_location('battle_rules_independent', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    a, b = m.parse_abc(e.before), m.parse_abc(e.abc.serialize())
    changed = [i for i, (x, y) in enumerate(zip(a['bodies'], b['bodies'])) if x != y]
    expected = sorted(bodies.resolve(e.abc, name) for name in methods)
    if changed != expected or len(b['bodies']) != len(a['bodies'])+len(e.new_methods):
        raise asm.AsmError(f'unexpected changed bodies: {changed}')
    for k in ('scripts', 'metadata', 'minor', 'major'):
        if a[k] != b[k]:
            raise asm.AsmError('unrelated structure changed: ' + k)
    for k, values in a['pools'].items():
        # Compare floating NaN through repr; ABC pool bytes are additionally checked on roundtrip.
        if repr(values) != repr(b['pools'][k][:len(values)]):
            raise asm.AsmError('pool prefix changed: ' + k)
    if a['methods'] != b['methods'][:len(a['methods'])]:
        raise asm.AsmError('existing method signatures changed')
    expected_traits = {}
    for cls, name, static in e.traits:
        index, _ = e.instance(cls)
        expected_traits.setdefault(('classes' if static else 'instances', index), []).append(e.newq(name))
    for section in ('instances', 'classes'):
        for index, (x, y) in enumerate(zip(a[section], b[section])):
            if x[:-1] != y[:-1] or x[-1] != y[-1][:len(x[-1])]:
                raise asm.AsmError(f'existing traits changed: {section}/{index}')
            added = [t[0] for t in y[-1][len(x[-1]):]]
            if added != expected_traits.get((section, index), []):
                raise asm.AsmError(f'unexpected traits: {section}/{index}')
    return len(a['bodies']) - len(changed)
