# iOS equipment preparation and isolated repair

The historical equipment preparation imported Android L7 equipment rules into
static `cn.mod::AuthorState` helpers without extending native character layouts.
Its old native bridge contract is unsafe: the report confused a body index with
a method ID, and its static Object signature is incompatible with the typed
instance resolver. The historical CLI is disabled before any file writes.
`prepare_historical_input_unlinked()` retains the preparation recipe for
inspection and emits `native_repair_contract_v2` with `linking_allowed=false`.
It no longer emits the legacy linker key `native_preload_bridge`.

## Current ABC repair

`repair_current.py` requires explicit pinned current ABC and donor inputs. It
regenerates seven helpers through the corrected production transforms. For the
reviewed 101496-method input, exactly three bodies change: 101439, 101442 and
101443, containing eight local-store corrections. Declarations, constant pools,
class/script layouts, body metadata and all unrelated bodies are frozen and
checked again after serialization. Existing output files are never overwritten.
The output is a private full ABC, not an installable client.

```powershell
python -B repair_current.py --full-abc <current.abc> --input-sha256 <sha256> --donor-swf <l7.swf> --donor-sha256 2eebe2196d5cbe51388efda7ce50bb8eb050da4bcc22eab1a0af85bb680f8845 --output-dir <new-directory>
python -B test_prepare_equipment.py
python -B test_native_preload.py
```

The transformer handles generic and compact local reads/writes, including
kill/increment/decrement instructions, and relocates exception byte boundaries
when instruction encodings expand. `method_id_for_label()` resolves through the
body's actual method ID: resolver body index 17701 belongs to method 18392;
method 17701 itself is `LoginBonusKind.Item`.

## Native contract

`native_preload.py` generates a 52-byte ARM64 wrapper and unapplied word patches.
It accepts only the real five-parameter resolver ABI on `BattleCharacterLogic`,
with MethodEnv in x6. The wrapper saves x0-x7 and fp/lr in an aligned 80-byte
frame, calls the complete reviewed thunk entry, restores the frame, and branches
to the captured current resolver wrapper. It rejects the old Object bridge,
mid-function entry, changed bytes, bad method IDs and out-of-range branches.

The thunk is compiled only as original method 18392 with its existing owner,
MethodInfo and four activation slots. It boxes typed pointers for the static
preload helper and obtains that helper's own MethodEnv. The runtime ABC retains
the original resolver declaration/body; the compiler-only thunk input is never
used as runtime ABC. Legacy bridge method 101444 remains reserved to preserve
all later method indices, and is not selected by the repair.

Native integration must also replace the three corrected helper implementations.
Compiling only the thunk would still call the old erroneous native helpers.
`compile_resolver_thunk.py`, `compile_corrected_helpers.py` and
`test_repaired_equipment.py` are isolated verification entries bound to the local
reviewed inputs, rather than a complete production packaging pipeline.
All AIR/AOT/ADL execution must use the workspace background runner.

Compiler and fixture entries take explicit input/output, SDK, dependencies,
runtime-map and background-runner paths. Their portable reader/fixture source
closure and the required private historical data are documented in
[verification support](support/README.md). Moving configuration does not relax
input identities or turn old execution receipts into new compiler evidence.

The current resolver AOT slot points to the existing five-in-one wrapper at
`0x106207AA0`. Preserve that wrapper and the retained original resolver at
`0x104963A08`; the former calls the latter, so redirecting the latter back to
the new wrapper would recurse. Login factory recovery requires both method
17701's AOT slot and its displaced first instruction, recovered from actual
current wrapper bytes. Plans never write a Mach-O or IPA.

Offline ABC execution and compiled ARM64 inspection do not validate native
execution, GC, exception unwinding, asset loading, rendering or device behavior.
No signing, admission rotation, accepted-registry update or release is included.
The historical F1009 report remains a historical offline receipt only; it does
not establish that the defective bridge works on a device.
