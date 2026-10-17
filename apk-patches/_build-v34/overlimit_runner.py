"""Run unchanged upstream O8-O12 definitions using workspace-local dependencies."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'incoming/overlimit-tools'
SOURCE = ROOT / 'incoming/overlimit-original/102-overlimit-owned-pedestal/source/v34_patches.py'


def confined(value):
    path = Path(value).resolve()
    if not path.is_relative_to(ROOT.resolve()):
        raise ValueError(f'Output/input path must remain in workspace: {path}')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    parser.add_argument('--select', choices=('O8', 'O9', 'O10', 'O11', 'O12', 'both', 'all'), default='all',
                        help='both retains its historical O8/O9 meaning; all selects O8-O12')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    source, target, report_path = map(confined, (args.source, args.target, args.report))
    if source == target:
        raise ValueError('Immutable input cannot be the output')
    # The original source prepends its historical tool location. Pin every import
    # before loading it so the actual implementation stays in this workspace.
    sys.path.insert(0, str(TOOLS))
    import common
    import perf2_core
    spec = importlib.util.spec_from_file_location('unchanged_overlimit_source', SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    pinned = {}
    for name in ('common', 'perf2_core', 'asm', 'bodies', 'swfabc'):
        path = Path(sys.modules[name].__file__).resolve()
        if not path.is_relative_to(TOOLS.resolve()):
            raise ValueError(f'Unexpected dependency origin: {name}={path}')
        pinned[name] = str(path.relative_to(ROOT))
    select = (None if args.select == 'all' else
              {'O8', 'O9'} if args.select == 'both' else {args.select})
    output, report = perf2_core.apply_patches(source.read_bytes(), module.PATCHES, select)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(output)
    report['workspace_dependency_origins'] = pinned
    report['source_definition'] = str(SOURCE.relative_to(ROOT))
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
