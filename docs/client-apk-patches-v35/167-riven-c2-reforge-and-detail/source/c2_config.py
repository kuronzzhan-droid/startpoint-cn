"""Single source of delivery version and filenames."""
from bootstrap import ROOT

VERSION_CODE = 1008053
BUILD_TAG = 'riven-p1c2'
SWF = ROOT / f'swf/boot-{BUILD_TAG}.swf'
APK = ROOT / f'apk/worldflipper-{BUILD_TAG}-local-wf-x86-v{VERSION_CODE}.signed.apk'
PACKAGE_REPORT = ROOT / f'build-audit/{BUILD_TAG}-apk-final.json'
