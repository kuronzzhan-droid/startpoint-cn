# R11 personal history and town policy for iOS

This recipe continues an explicitly identified iOS full ABC after the content
operations stage. It imports the accepted R11 personal-history and town-policy
changes, preserving every existing declaration, native method ID, field layout,
unrelated body and constant-pool prefix. It creates no player save, network
request, resource patch, package, admission change or acceptance registration.

The stages are deliberately separate:

| Stage | Existing native methods | Independent helper |
| --- | --- | --- |
| Personal history | Seven period, date, sharing and text consumers | `cn.profile::PlayerHistoryState`, seven methods |
| Town policy | Original selector plus three-instruction `ResponseData` capture insertion | `cn.town::TownThemeState`, ten methods |

`prepare_profile_town.apply_profile(target, donor, helper)` and
`apply_town(target, donor, helper)` accept ABC objects or their existing `View`
wrapper. New method IDs are allocated from the supplied target, never copied
from Android or a previous intermediate build. The town stage requires the
operations constructor with only its content capture. It inserts the town
capture before content capture, verifies exact inverse removal, and requires
the complete final constructor to match R11 after resolving constant pools.

The personal-history stage keeps missing completion dates truthful: an achieved
entry may display an unknown date without becoming unachieved. The helper
copies the date array only when necessary and does not change raw stored data.
The town stage clears its small scalar snapshot only on a successful complete
load. Invalid or missing configuration executes the full original selection
algorithm. The existing iOS BGM getter and local preference storage remain
unchanged; a native getter test supplied by the Android fixture is a controlled
behavioral reference, not proof of an iOS device's current native execution.

Full method signatures include flags, optional constants and parameter names
resolved semantically. The selected methods also require matching scope,
activation and receiver slots. They contain no closures or outer-scope access;
new lexical access is rejected. Existing return-stub bodies are expected in the
iOS carrier. A separate native entry audit must confirm the real current entry
and retained aliases before linking, because return stubs are not runtime
implementation evidence. Existing MemberView, texture-loading, return-route
and other platform-specific methods are outside this recipe's change set.

## Prepare and compile

For historical R11 reproduction, use the pinned operations/profile full ABCs
and the R11 donor from the original stage reports. The current accepted
registries select inputs for later development; a final already-integrated R11
ABC is not a replacement for these historical stage inputs. Do not relax the
donor identity assertions or append the same helper classes twice.

```powershell
python -B client-patch/profile-town-ios/prepare_profile_town.py --batch profile --base <OPERATIONS_FULL_ABC> --base-sha256 <OPERATIONS_SHA256> --r11 <R11_APK> --out <PROFILE_PREPARED>
python -B client-patch/profile-town-ios/prepare_profile_town.py --batch town --base <PROFILE_PREPARED>/full.abc --base-sha256 <PROFILE_SHA256> --r11 <R11_APK> --out <TOWN_PREPARED>
```

Each stage produces `full.abc` and `port.json`. Compile each against its own
prepared report using the existing [AOT compiler recipe](../pr43-ios/compile_port.py):

```powershell
python -B <BACKGROUND_LAUNCHER> --timeout 660 --cwd <WORKTREE> -- python -B client-patch/pr43-ios/compile_port.py --prepared <STAGE>/port.json --sdk <AIR_SDK> --dependencies <PINNED_284_DEPENDENCIES> --background <BACKGROUND_LAUNCHER> --out <STAGE_AOT> --timeout 600
```

Use the existing environment containing the native parsing libraries. The
compiler restores old owner `newclass` contexts only in its separate compiler
input; none of those contexts may enter the runtime ABC. Target symbol coverage
and verifier warnings are mandatory. `audit_objects.py` then binds every target
to a unique native symbol, full function bytes, disassembly and all object
relocations while retaining the LIEF owning object during reads:

```powershell
python -B client-patch/profile-town-ios/audit_objects.py --prepared <STAGE>/port.json --compiled <STAGE_AOT>/compile-report.json --out <OBJECT_CONTRACTS_JSON> --native-libraries <EXISTING_NATIVE_LIBRARIES>
```

Intermediate objects cannot be reused after adding an earlier stage: method
numbers and constant-pool indices depend on the exact cumulative input.
Object contracts are unrelocated evidence. Final native linking, old-entry
guards, unwind data, runtime ABC/hash pairing, signing boundaries and IPA
packaging belong to the cumulative linker.

## Bounded behavior and guard checks

`validate_air.py` projects the actual prepared iOS methods and all seventeen
helper bodies into the established R11 AIR fixtures. It checks resolved
instructions and control flow for every projected method and writes
`ios-projection.json`. Unchanged Android fixture dependencies stay explicitly
separate. The profile fixture executes six complete changed consumers and the
actual period-text setter suffix of the seventh; it does not run the full
resource-dependent profile page. The town fixture runs the complete selector,
helper and eight-instruction response prologue, automatic fallback, malformed
responses, local BGM preference and Timer cases. A removed-hook negative
control must fail at the expected manual-selection assertion.

```powershell
python -B <BACKGROUND_LAUNCHER> --timeout 580 --cwd <WORKTREE> -- python -B client-patch/profile-town-ios/validate_air.py --candidate <TOWN_PREPARED>/full.abc --r11 <R11_APK> --out <AIR_EVIDENCE> --sdk <AIR_SDK> --java <JAVA>
python -B client-patch/profile-town-ios/test_guards.py --base <OPERATIONS_FULL_ABC> --r11 <R11_APK> --town-stage <TOWN_PREPARED>/full.abc --out <GUARD_REPORT>
```

The guard suite rejects changed flags, defaults, names, receiver slots,
unexpected native bodies, new closures and duplicate captures. All reports
distinguish compilation, controlled AVM2 execution and iOS device execution.
They do not establish complete-game rendering, resource download, installation,
signing or device acceptance.
