"""One-time C9 harness setup from the preserved C8 build harness."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT.parent / 'build-c8'


def clone(source, target, replacements):
    text = (BASE / source).read_text('utf-8-sig')
    for old, new in replacements:
        if len(old) < 10:
            parts = re.split(r'([0-9a-f]{64})', text)
            text = ''.join(part if i % 2 else part.replace(old, new)
                           for i, part in enumerate(parts))
        else:
            text = text.replace(old, new)
    path = ROOT / target
    assert not path.exists(), path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, 'utf-8')


def main():
    phases = [('C8', 'TEMP_C9'), ('C7', 'C8'), ('TEMP_C9', 'C9'),
              ('c8', 'temp_c9'), ('c7', 'c8'), ('temp_c9', 'c9')]
    clone('source/c8_prepare.py', 'source/c9_prepare.py', phases)
    clone('source/c8_config.py', 'source/c9_config.py',
          [('C8', 'C9'), ('C7', 'C8'), ('c8', 'c9'), ('1008058', '1008070')])
    clone('source/c8_package.py', 'source/c9_package.py', phases + [
          ('VERSION_CODE == 1008058', 'VERSION_CODE == 1008070')])
    clone('source/c8_verify_package.py', 'source/c9_verify_package.py', phases + [
          ('623', '708'), ('== 22', '== 26')])
    clone('source/c8_seal.py', 'source/c9_seal.py', phases + [('1008058', '1008070')])
    clone('audit/c8/audit_helpers.py', 'audit/c9/audit_helpers.py', [])
    clone('audit/c8/independent_audit.py', 'audit/c9/independent_audit.py', phases + [
          ('b962e3de9aaf5b8b4672a421ef4b8bf6f5be36231dbebea978e2dbc5fc1ca01d',
           'acb72efeee94e4479ae44fd3911cb41a91f17cf2b79d265c27f35208059b3104')])


if __name__ == '__main__':
    main()
