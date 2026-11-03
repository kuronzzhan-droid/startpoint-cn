"""独立 CT 边界复审；被验收治疗、CT、发弹路径全部执行候选真实 ABC。"""
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import bootstrap
from bootstrap import output_path
from swfabc import SwfAbc
from heal_any.runtime import World


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def source_snapshot():
    paths = [Path(__file__), ROOT/'bootstrap.py', ROOT/'heal_any/runtime.py']
    paths += sorted((ROOT/'vendor').glob('*.py'))
    return {p.relative_to(ROOT).as_posix(): digest(p.read_bytes()) for p in paths}


def source_dependencies():
    paths = []
    for module in tuple(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).suffix == '.py':
            path = Path(path).resolve()
            if path.is_relative_to(ROOT.parent) and not path.is_relative_to(ROOT):
                paths.append(path)
    return {str(p): digest(p.read_bytes()) for p in sorted(set(paths))}


def setup(abc, damage='wfx:34:5054:100000:150000:ct', additional=None):
    table = {34: damage, 35: 'wfx:35:50:500:1000:fever', **(additional or {})}
    world = World(abc, table)
    holder = world.unit([world.condition(34), world.condition(35)])
    target = world.unit(hp=0)
    return world, holder, target


def timeline(world):
    return [(s['frame'], s['member'], s['strength']/100000) for s in world.shots]


def run(output=None):
    output = Path(output or ROOT/'v35k.swf')
    sources, dependencies = source_snapshot(), source_dependencies()
    source_sha = digest(output.read_bytes())
    abc = SwfAbc(output).abc
    checks = []

    # The qualifying event opens the window even if that channel's multiplier is zero.
    w, _, target = setup(abc, 'wfx:34:5054:0:150000:overflow_only')
    overflow = w.unit(hp=100)
    w.heal(target, 5, origin=-1)
    w.tick(29)
    w.heal(overflow, 5, origin=-1)
    w.tick()
    assert timeline(w) == [(30, 0, 15)]*2
    checks.append('qualified-zero-weight-channel-opens-shared-30-frame-window')

    # An empty/zero-weight emission window cannot start a cooldown before damage exists.
    w, _, target = setup(abc, 'wfx:34:5054:0:150000:overflow_only')
    overflow = w.unit(hp=100)
    w.heal(target, 5, origin=-1)
    w.tick(31)
    assert not w.shots
    w.heal(overflow, 5, origin=-1)
    w.tick(30)
    assert timeline(w) == [(61, 0, 15)]*2
    checks.append('zero-weight-window-does-not-start-ct-before-first-damage')

    # Same CT and owner, but distinct damage classifications share a single gate.
    w, holder, target = setup(abc, additional={36: 'wfx:34:5051:200000:300000:skill'})
    holder['conditionSlot'] = w.slot([w.condition(34), w.condition(36), w.condition(35)])
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert timeline(w) == [(30, 0, 20)]*2+[(30, 0, 10)]*2
    w.heal(target, 5, origin=-1)
    w.tick(300)
    assert len(w.shots) == 4 and w.fever_ratios() == [.05, .05]
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert timeline(w)[4:] == [(360, 0, 20)]*2+[(360, 0, 10)]*2
    checks.append('same-owner-same-ct-distinct-classifications-share-window-and-cooldown')

    # A second holder introduced while the first is cooling down starts its own clock.
    w, _, target = setup(abc)
    w.heal(target, 5, origin=-1)
    w.tick(60)
    w.unit([w.condition(34)])
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert timeline(w) == [(30, 0, 10)]*2+[(90, 2, 10)]*2
    w.tick(240)
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert timeline(w)[4:] == [(360, 0, 10)]*2
    checks.append('staggered-holders-have-independent-expiry-330-and-390')

    # Re-enter through an actual applyHeal during the output boundary's first shot.
    w, _, target = setup(abc)
    emit = w.zone_manager['executeAbilityDamage']
    reentered = []
    def reentrant(*args):
        emit(*args)
        if not reentered:
            reentered.append(True)
            w.heal(target, 5, origin=-1)
    w.zone_manager['executeAbilityDamage'] = reentrant
    w.heal(target, 5, origin=-1)
    w.tick(630)
    assert reentered and timeline(w) == [(30, 0, 10)]*2
    assert w.fever_ratios() == [.05, .05]
    checks.append('synchronous-heal-during-first-emission-sees-ct-no-hoard-fever-preserved')

    assert source_snapshot() == sources and source_dependencies() == dependencies
    assert digest(output.read_bytes()) == source_sha
    report = {'schema_version': 1, 'status': 'passed', 'output_swf_sha256': source_sha,
              'checks': checks, 'count': len(checks), 'source_locks': sources,
              'readonly_dependency_locks': dependencies,
              'sources_unchanged_during_verification': True,
              'scope': '真实字节码离线边界复审；未验证完整AIR设备表现，未裁定未确认的混配参数'}
    output_path(ROOT/'audit/ct-review-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    print(json.dumps(run(), ensure_ascii=False, indent=2))
