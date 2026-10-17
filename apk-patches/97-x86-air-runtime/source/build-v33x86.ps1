# Builds the v33 dual-ABI test APK (arm64 as shipped + native x86_64 for emulators). Run manually:
#   powershell -ExecutionPolicy Bypass -File D:\WF\perf-v30-20261015\build-v33x86.ps1
$ErrorActionPreference = 'Stop'
$R = 'D:\WF\perf-v30-20261015'
$W = "$R\work\x86stubs"
$T = 'D:\WF\runtimes\android-toolchain\sdk\build-tools\34.0.0'
$O = "$R\out"
$base = (Get-ChildItem '%USERPROFILE%\Downloads' -Filter '*-v33.apk' | Where-Object { $_.Name -notmatch 'x86' } | Select-Object -First 1).FullName
$h = (Get-FileHash $base).Hash.ToLower()
if ($h -ne '3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532') { throw "unexpected v33 base: $h" }

foreach ($f in 'v33x86-stage1.unsigned.apk','v33x86.unsigned.apk','v33x86.aligned.apk','v33x86.signed.apk') { Remove-Item "$O\$f" -ErrorAction SilentlyContinue }
python "$R\tools\build_x86.py" $base "$W\build\x86_64-e3" "$O\v33x86-stage1.unsigned.apk"
if ($LASTEXITCODE) { throw 'build_x86 failed' }
python "$W\src\ane_x64_patch.py" "$O\v33x86-stage1.unsigned.apk" "$O\v33x86.unsigned.apk"
if ($LASTEXITCODE) { throw 'ane patch failed' }

& "$T\zipalign.exe" -p -f 4 "$O\v33x86.unsigned.apk" "$O\v33x86.aligned.apk"
$env:WF_KS = 'android'
& "$T\apksigner.bat" sign --ks "$env:USERPROFILE\.android\debug.keystore" --ks-key-alias androiddebugkey `
  --ks-pass env:WF_KS --key-pass env:WF_KS --v4-signing-enabled false --out "$O\v33x86.signed.apk" "$O\v33x86.aligned.apk"
$env:WF_KS = $null
& "$T\apksigner.bat" verify --print-certs "$O\v33x86.signed.apk" | Select-String 'certificate SHA-256'
(Get-FileHash "$O\v33x86.signed.apk").Hash.ToLower()
