"""复用 party 的完整资源方法/匿名闭包夹具，验证视觉入口确实抵达。"""
import copy
import asm
from party.worlds import world, preload
from party import runtime

_lookup = runtime.VM._lookup


def _builtins(obj, key):
    if isinstance(obj, str) and str(key).split('::')[-1] == 'indexOf':
        return obj.find
    return _lookup(obj, key)


runtime.VM._lookup = _builtins


def paths(abc, table=None, owner=0, overrides=None):
    env, party, mains, unisons = world(abc, table)
    found = []
    original_run = env.run
    original_body = env.run_body
    altered = {abc.bodies[env.labels[label]][0]: code for label, code in (overrides or {}).items()
               if label in env.labels}

    def run_body(body, args, scopes=None):
        if body[0] in altered:
            body = copy.deepcopy(body)
            body[5] = asm.encode(altered[body[0]])[0]
        return original_body(body, args, scopes)

    def run(label, this, *args):
        if label == 'BattleCharacterLogic/resolvePathCollection':
            args[0]['addAnimationLayout'] = found.append
        return original_run(label, this, *args)

    env.run_body, env.run = run_body, run
    env.lex['Battle'] = {'wfxPfReadString': lambda *args: env.run(
        'Battle$/wfxPfReadString', env.lex['Battle'], *args)}
    env.lex['BattleCharacterLogic'] = {}
    for name in ('wfxVisualPaths', 'wfxPreloadVisualFor'):
        env.lex['BattleCharacterLogic'][name] = lambda *args, n=name: env.run(
            'BattleCharacterLogic$/' + n, env.lex['BattleCharacterLogic'], *args)
    preload(env, mains, unisons, owner, visual_hook=lambda char, builder, who: env.run(
        'BattleCharacterLogic/wfxPreloadAbilityVisuals', char, builder, who))
    return found, env


def checks(before, after, overrides=None):
    old, _ = paths(before)
    now, _ = paths(after, overrides=overrides)
    assert now == old, ('full preload unchanged without config', now, old)
    config = {'ability_visual_fire_dragon': 'visual/a|visual/b|visual/c',
              'ability_visual_absent': 'visual/must/not/load'}
    found, env = paths(after, config, overrides=overrides)
    assert [p for p in found if p.startswith('visual/')] == ['visual/a','visual/b','visual/c'], found
    assert 'ability_visual_absent' not in env.reads, env.reads
    remote, env = paths(after, config, owner=1, overrides=overrides)
    assert [p for p in remote if p.startswith('visual/')] == ['visual/a','visual/b','visual/c'], remote
    assert 'ability_visual_absent' not in env.reads, env.reads
    return ['full resource method no-key parity', 'full resource hook reaches true helpers',
            'full resource hook includes actual remote party', 'full resource hook excludes absent party member']
