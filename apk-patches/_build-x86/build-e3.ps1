# Builds the E3 x86 probe APK (emulator-native test build). Run manually:
#   powershell -ExecutionPolicy Bypass -File D:\WF\perf-v30-20261015\build-e3.ps1
$ErrorActionPreference = 'Stop'
$R  = 'D:\WF\perf-v30-20261015'
$W  = "$R\work\x86stubs"
$CL = 'D:\WF\runtimes\ndk-dl\android-ndk-r27\toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe'
$T  = 'D:\WF\runtimes\android-toolchain\sdk\build-tools\34.0.0'
$O  = "$R\out"

# 1. library set: E2 libs, with the E3 SocketHelper
New-Item -ItemType Directory -Force "$W\build\x86_64-e3" | Out-Null
Copy-Item "$W\build\x86_64-e2\*.so" "$W\build\x86_64-e3\" -Force
& $CL --target=x86_64-linux-android21 -shared -fPIC -O2 '-Wl,-z,max-page-size=16384' '-Wl,-soname,libSocketHelper.so' `
  -o "$W\build\x86_64-e3\libSocketHelper.so" "$W\src\SocketHelper_e3.c" -llog
if ($LASTEXITCODE) { throw 'compile failed' }

# 2. add lib/x86_64 to a v30-perf2 copy, then give every ANE an Android-x64 platform
foreach ($f in 'e3-stage1.unsigned.apk','e3-x86.unsigned.apk','e3-x86.aligned.apk','e3-x86.signed.apk') { Remove-Item "$O\$f" -ErrorAction SilentlyContinue }
$base = (Get-ChildItem $O -Filter '*v30-perf2.signed.apk' | Select-Object -First 1).FullName
python "$R\tools\build_x86.py" $base "$W\build\x86_64-e3" "$O\e3-stage1.unsigned.apk"
if ($LASTEXITCODE) { throw 'build_x86 failed' }
python "$W\src\ane_x64_patch.py" "$O\e3-stage1.unsigned.apk" "$O\e3-x86.unsigned.apk"
if ($LASTEXITCODE) { throw 'ane patch failed' }

# 3. align + sign with the usual debug cert (SDK default debug password)
& "$T\zipalign.exe" -p -f 4 "$O\e3-x86.unsigned.apk" "$O\e3-x86.aligned.apk"
$env:WF_KS = 'android'
& "$T\apksigner.bat" sign --ks "$env:USERPROFILE\.android\debug.keystore" --ks-key-alias androiddebugkey `
  --ks-pass env:WF_KS --key-pass env:WF_KS --v4-signing-enabled false --out "$O\e3-x86.signed.apk" "$O\e3-x86.aligned.apk"
$env:WF_KS = $null
& "$T\apksigner.bat" verify --print-certs "$O\e3-x86.signed.apk" | Select-String 'certificate SHA-256'
(Get-FileHash "$O\e3-x86.signed.apk").Hash.ToLower()
