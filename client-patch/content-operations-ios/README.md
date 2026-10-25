# iOS R11 content operations port

This recipe transfers the final Android R11 operations implementation into the
equipment-corrected iOS PR43 full ABC. It replaces 121 existing method bodies and
appends the complete 85-method `cn.content.ContentOperationsState` class. The
standalone helper source is an exact, pinned copy of the final Android source.
It does not change saved identifiers, inventory, earned progress, server data,
admission credentials or existing native class slots.

| Area | Transferred behavior |
| --- | --- |
| Real time and login | Login snapshot capture, server epoch plus monotonic elapsed time, cache invalidation and local expiry; exact operations reload message through the original date-change dialog and title callback. |
| Activities, pools and passes | Independent visible/enter/claim/exchange actions, exact quest and mission scopes, original qualification checks and native pass selection. |
| Historical entrances | Controlled Rush and boss-header entries, associated reward-box quest routing, retained earned rights without fabricated eligibility. |
| Requests and exchange | Freeze the existing request identity across retries; preserve original native box/shop/campaign/gacha exchange flows and server authority. |
| Date controls | Existing time fields show permanent/action-specific text or exact UTC+8 deadlines. Native None/no-date and daily-count behavior are retained. |

The operations stage deliberately removes the three-instruction town capture
prologue from the R11 `ResponseData` constructor. Its inverse insertion/CFG proof
is saved in `port.json`; the subsequent town stage restores that exact prologue.
Profile and town selection are separate increments.

## Input and ABI contract

The exact accepted R11 APK/SWF and its main/helper ABC hashes are pinned in
`extract_inputs.py` and `prepare.py`. The base is the equipment-corrected full
ABC `d35c1063…e1cde` with 101496 methods. A stripped runtime ABC is not accepted.
The prepared full ABC has 101581 methods and SHA-256
`547ae516a4056fb10c0d0e8d53fc2ca42326532c412ed0b10b3c3a3114e6f98d`.

Every replacement is mapped by QName and binds the body index to its actual
`body[0]` MethodInfo ID. Complete signatures, flags, optional constants, parameter
names, inheritance and native owner fields must match. Existing declarations,
activation traits, constant-pool prefixes and unrelated bodies remain exact.
None of the 121 original methods creates a new closure. `port.json` contains the
exact method map and before/after body hashes.

## Reproduction

Use Python 3.11+ with the existing ABC support files. Native object inspection
uses the existing `lief` installation; do not install or change a global Python
environment. Provide the fixed 284 dependency ABCs accepted by
`pr43-ios/support/dependency-hashes.json`, AIR SDK 51.2.1.5 and Java.

Set `$recipe` to this source directory and `$work` to a fresh task directory.

```powershell
python -B "$recipe/extract_inputs.py" --apk $r11Apk --out "$work/inputs"
python -B "$recipe/prepare.py" --base $equipmentFullAbc --donor "$work/inputs/r11-main.abc" --helper "$work/inputs/r11-content-helper.abc" --out "$work/prepared"
python -B "$recipe/compile.py" --prepared "$work/prepared/port.json" --out "$work/compiled" --sdk $sdk --dependencies $abcDependencies --background $backgroundWrapper
python -B $backgroundWrapper --timeout 900 --cwd $worktree -- python -B -u "$recipe/verify_runtime.py" --prepared "$work/prepared/port.json" --source-swf "$work/inputs/r11-donor.swf" --work "$work/air" --sdk $sdk --java $java
```

The compiler command itself is wrapped by `compile.py` through the existing
background runner. Compiler-only owner/newclass contexts and unrelated return
stubs remain exclusively in `compiled/cumulative.abc`; they must never replace
the prepared full ABC or a runtime payload. `compile-report.json` requires all
206 target symbols. All nine compiler objects are retained, including AOTInfo,
flags, activation metadata, generated code and compact-unwind sections.

`native-contract.json` describes complete symbol extents and every relocation,
including explicit ARM64 ADDEND pairs. Eight functions contain trailing switch
data: 246036 code bytes plus 304 inline data bytes form 246340 retained bytes.
The exact frameless `currentRevision` getter has no compact-unwind descriptor;
its guarded bytes are `LDR d0,[x0,#0xc8]; RET`. Code length and symbol extent must
not be conflated when adding unwind ranges. Linking must preserve previous
equipment code/unwind, old native entry aliases and AOT tables, and then update
runtime/full ABC/SWF digests and signable LINKEDIT layout.

## Verification and limits

The prepared methods and helper are imported into bounded AIR fixtures after
exact normalized instruction/CFG comparison. The four applicable suites pass
369 assertions: core behavior 170, final period/exchange consumers 45, request
identity 39 and historical native entrances 115. The current period fixture is
`content-operations/period_runtime_fixtures.py`. The older native fixture expects
permanent date panels to disappear and is not the final R11 display contract.

`air_fixture_adapter.py` supplies the final UiText and box end-date interfaces to
the older core fixture without changing production code or its assertions.
The initial interface failure and obsolete date-expectation failure remain in
task evidence. Unchanged dependencies in these fixtures use fixed R11 reference
bodies and isolated objects. These checks do not execute the iOS native binary,
full game, GPU or device, and do not prove current cloud-service deployment.

`verify_contract.py` independently checks the saved full ABC, all old declaration
and pool prefixes, the 121 replacements, 85 helper bodies, equipment corrections,
compiler-only ABI, all 206 extracted symbols, nine retained objects and AIR
receipts. Native linking, exception/unwind acceptance, signing and packaging are
the cumulative caller's next steps. This directory does not update a registry,
service, CDN, save or admission record.
