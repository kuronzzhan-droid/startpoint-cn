"""沿用本机原构建脚本中的密钥配置；值只在内存和子进程环境中传递。"""
import ast
import os
from pathlib import Path
import subprocess
import sys

root = Path('D:/WF/startpoint-cn')
os.chdir(root)
t = ast.parse((root/'弹国服/instrument/build_instrumented_apk.py').read_text(encoding='utf8'))
settings = {}
for n in ast.walk(t):
    if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'add_argument'
            and n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value in ('--ks-pass', '--ks-key-pass')):
        settings[n.args[0].value] = ast.literal_eval(next(k.value for k in n.keywords if k.arg == 'default'))
env = os.environ.copy()
env['JAVA_HOME'] = 'D:/WF/runtimes/android-toolchain/jdk/jdk-17.0.19+10'
for option, variable in (('--ks-pass', 'WF_BATTLE_KS_PASSWORD'), ('--ks-key-pass', 'WF_BATTLE_KEY_PASSWORD')):
    value = settings[option] or settings['--ks-pass']
    if not isinstance(value, str) or not value:
        raise SystemExit('本地签名配置缺少口令')
    env[variable] = value.removeprefix('pass:')
d = Path(__file__).resolve().parent
args = [sys.executable, '-X', 'utf8', 'client-patch/battle-rules/build_apk.py',
        '--base', 'D:/WF/out/夏勇希与杰拉尔调整-20260924/WorldFlipper-voice-pools-ui.apk',
        '--swf', str(d/'gauge-performance.swf'), '--patch-report', str(d/'gauge-performance-report.json'),
        '--output', str(d/'WorldFlipper-gauge-performance.apk'), '--work', str(d/'apk-build-gauge-performance'),
        '--zipalign', 'D:/WF/runtimes/android-toolchain/sdk/build-tools/34.0.0/zipalign.exe',
        '--apksigner', 'D:/WF/runtimes/android-toolchain/sdk/build-tools/34.0.0/apksigner.bat',
        '--keystore', '弹国服/instrument/wf_new.keystore',
        '--ks-pass-env', 'WF_BATTLE_KS_PASSWORD', '--key-pass-env', 'WF_BATTLE_KEY_PASSWORD']
raise SystemExit(subprocess.run(args, env=env).returncode)
