"""Narrow, explicit adapters; upstream exported source files stay byte-exact."""
import inspect

from compose_conflicts import compose_ranks, compose_ui, V33_PINS, RANKS


def data_adapter(module):
    source = inspect.getsource(module.optimize_methods)
    anchor = "    for label,hashes in pins.items():"
    assert source.count(anchor) == 1
    source = source.replace(anchor, f"    pins[{RANKS!r}] = [{V33_PINS[RANKS]!r}]\n" + anchor)
    anchor = "edit('pinball.scene.character.characterTable::CharacterTable/applyCharacters|1',ranks)"
    assert source.count(anchor) == 1
    source = source.replace(anchor, "edit(_ranks_label, lambda body: _compose_rank(abc))")
    module._ranks_label = RANKS
    module.compositions = []

    def compose(abc):
        module.compositions.append(compose_ranks(module, abc))

    module._compose_rank = compose
    exec(compile(source, '<v34 data method adapter>', 'exec'), module.__dict__)


def ui_adapter(module):
    original = module.patch_body
    module.compositions = []

    def patch_body(abc, label):
        if label in V33_PINS:
            report = compose_ui(module, abc, label)
            module.compositions.append(report)
            return report
        return original(abc, label)

    module.patch_body = patch_body


def network_adapter(module):
    # SDK 51.1 emits the same two independent helper classes in reverse tag
    # order. Restore upstream's explicit order and retain its exact set checks.
    source = inspect.getsource(module.compile_helper)
    anchor = '    assert tuple(t[2][4:-1] for t in helpers) == HELPER_NAMES'
    assert source.count(anchor) == 1
    source = source.replace(anchor,
        '    assert {t[2][4:-1] for t in helpers} == set(HELPER_NAMES)\n'
        '    helpers.sort(key=lambda t: HELPER_NAMES.index(t[2][4:-1]))\n' + anchor)
    exec(compile(source, '<v34 network helper order adapter>', 'exec'), module.__dict__)
    compiled = module.compile_helper
    module.compile_helper = lambda work: compiled(work.with_name(work.name + '-ordered'))
