"""C21 local-only delivery identity; inherited C5 admission remains unchanged."""
from bootstrap import ROOT, FINAL

VERSION_CODE = 1008082
BUILD_TAG = 'riven-p1c21-18001'
SWF = FINAL
APK = ROOT / f'apk/worldflipper-{BUILD_TAG}-local-wf-x86-v{VERSION_CODE}.signed.apk'
PACKAGE_REPORT = ROOT / f'build-audit/{BUILD_TAG}-apk-final.json'
ADMISSION_BUILD = '<ADMISSION_ID>'
HTTP_CDN_ENDPOINT = '<SERVER_HOST>:18001'
