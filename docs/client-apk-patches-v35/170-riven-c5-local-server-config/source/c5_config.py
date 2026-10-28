"""C5 delivery identity; network behavior changes only through SWF literals."""
from bootstrap import ROOT, FINAL

VERSION_CODE = 1008056
BUILD_TAG = 'riven-p1c5-18001'
SWF = FINAL
APK = ROOT / f'apk/worldflipper-{BUILD_TAG}-local-wf-x86-v{VERSION_CODE}.signed.apk'
PACKAGE_REPORT = ROOT / f'build-audit/{BUILD_TAG}-apk-final.json'
ADMISSION_BUILD = '<ADMISSION_ID>'
OLD_ADDRESS = '<SERVER_HOST>:8001'
NEW_ADDRESS = '<SERVER_HOST>:18001'
