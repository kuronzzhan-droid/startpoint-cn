"""C22 local P2 delivery identity; authenticated server registration is separate."""
from bootstrap import ROOT, FINAL

VERSION_CODE = 1008083
BUILD_TAG = 'riven-p2c22-18001'
SWF = FINAL
APK = ROOT / f'apk/worldflipper-{BUILD_TAG}-local-wf-x86-v{VERSION_CODE}.signed.apk'
PACKAGE_REPORT = ROOT / f'build-audit/{BUILD_TAG}-apk-final.json'
ADMISSION_BUILD = '<ADMISSION_ID>'
HTTP_CDN_ENDPOINT = '<SERVER_HOST>:18001'
