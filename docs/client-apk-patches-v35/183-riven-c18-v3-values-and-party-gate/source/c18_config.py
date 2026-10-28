"""C18 delivery identity; retain C17's C5 admission identity and dedicated endpoint."""
from bootstrap import ROOT, FINAL

VERSION_CODE = 1008079
BUILD_TAG = 'riven-p1c18-18001'
SWF = FINAL
APK = ROOT / f'apk/worldflipper-{BUILD_TAG}-local-wf-x86-v{VERSION_CODE}.signed.apk'
PACKAGE_REPORT = ROOT / f'build-audit/{BUILD_TAG}-apk-final.json'
ADMISSION_BUILD = '<ADMISSION_ID>'
HTTP_CDN_ENDPOINT = '<SERVER_HOST>:18001'

