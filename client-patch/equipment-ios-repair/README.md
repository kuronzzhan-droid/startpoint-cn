# Equipment native repair and sparse delta metadata

`build_candidate.py` turns the reviewed equipment relocation plan into a real
ARM64 Mach-O, synchronized AOT/SWF pair and unsigned IPA. It consumes the
accepted carrier and stage-10 plan through explicit paths. Existing inputs and
the acceptance registry are never overwritten.

## Equipment contract

- Install all 19 planned code chunks in a new read/execute `__EQFIX` segment at
  the plan's reviewed addresses. Move `__LINKEDIT` and its advertised file
  offsets; preserve the indices and mappings of all preceding segments.
- Redirect resolver 18392 only through its active AOT slot. Preserve the old
  wrapper, its call to the original resolver and the original resolver bytes.
- Redirect helpers 101439, 101442 and 101443 through both their AOT slots and
  complete old entry points. Restore Item 17701's slot and original instruction.
  Require exact preimages for all nine planned patches.
- Verify the five retargeted or restored pointer slots already have pointer
  rebases. The count and table locations are unchanged, and the added code uses
  PC-relative instructions; no pointer relocation is silently omitted.
- Retain the existing stripped runtime ABC byte for byte. Its affected AOT
  bodies contain no bytecode and all metadata matches the corrected full ABC.
  The resolver-owned compiler thunk and compiler-only script restoration do
  not enter that runtime ABC. Synchronize the full ABC SHA-1, AOTInfo digest and
  SWF hash stub together.
- Import the four compiler-emitted compact unwind records and reviewed wrapper
  and veneer encodings. Repack `__TEXT,__unwind_info` within its existing section
  while retaining all old encodings, personality pointers and LSDA records.
  Keep `__eh_frame` in place for this equipment candidate. Append all new starts
  to `LC_FUNCTION_STARTS` before the symbol string table.
- Check loader metadata against both the signature-tail and TrollStore ldid
  trim boundaries, including six replacement signature-size models. Retain
  the public constructor origin, admission materials and package identity.
- Replace exactly the native executable and main SWF in the IPA. Read every
  final ZIP member back and compare all other bytes and package metadata.

The output contains `worldflipper`, `worldflipper_ios_release.swf`,
`equipment-fixed-full.abc`, `runtime-stripped.abc`, an unsigned IPA,
`link-report.json` and `package-report.json`. Reports bind the plan, objects,
functions, source files, method-table readback, relocations and payload hashes.
The package's existing signature bytes are stale; this tool does not sign it.

Run the complete Python command through the workspace's external background
runner on Windows. The inner command is:

```text
python -B -u client-patch/equipment-ios-repair/build_candidate.py \
  --registry <fixed-PR43-registry-snapshot.json> \
  --plan <stage-10>/native-plan-final/plan.json \
  --output <fresh-external-output-directory> \
  --libraries <existing-LIEF-and-Capstone-environment>
```

The equipment plan is a fixed historical recipe. Supply the PR43 registry
snapshot captured before this repair, never the mutable latest registry. The
compact registration retains that input under
`lineage.previous_ios_baseline_registration`; save that object as a separate
private JSON input when reproducing this step. Keep its original artifact
identity and all plan/hash guards. New development starts from the latest
registry and must not replay this historical repair.

## Subsequent AOT deltas

`finalize_delta.py` exposes a pure post-link function; it returns bytes and a
receipt and does not write, sign, package or register anything:

```python
native, metadata = finalize_delta(
    native_after_link,
    compiled_report,                 # parsed dict or JSON path
    link_report["functions"],         # method, address, size, sha256
    link_report["entry_bridges"],
    link_report["veneers"],
    generated_initializers=link_report.get("generated_initializers"),
)
```

Load the same `pr43-ios/native_support.py` backend and external LIEF environment
used by the linker before calling. Object paths and hashes come from the
compile report. Negative generated method IDs must be accompanied by the
symbol-to-ID map. Full object function extents and linked bytes are checked.
Compiler function records may include signed-offset switch tables after the
code range declared by compact unwind. Such tails are accepted only with exact
self-symbol PAGE/PAGEOFF/ADDEND ownership, bounded LDRSW/ADD/BR dispatch,
unchanged linked table bytes and actual linked address materialization. The
bounds branch must bypass the dispatch; selector and flags cannot be clobbered.
Every table target must return to a decoded instruction in the same function.
These tables receive separate zero/no-unwind ranges and are not function starts.

Functions with no object compact-unwind row, and branch-only synthetic bridges,
receive explicit zero/no-unwind entries and are listed in the receipt; no
unproven frame encoding is substituted.

The postprocessor preserves original nonzero unwind entries and all original
LSDAs, supports bridges in previously uncovered address ranges, and appends
function starts for compiled and synthetic functions. Up to twelve verified
zero alignment bytes between adjacent new functions may share the preceding
new unwind range; those spans are recorded.

When the original unwind section lacks room, the tool moves the old EH section
into verified zero padding between the load commands and first section. It
reorders the `__TEXT` section headers by address and remaps symbol `n_sect`
indices, retaining all other symbol fields and old function addresses. The
released EH bytes extend the existing unwind section without changing the
original final section end. Rebase/symbol pointers into the old EH range and
unhandled section or external/local relocation tables are rejected. Historical
code after the original EH section is preserved. The tool accepts only the carrier's
explicit simple arm64 `zR` CIE, PC-relative 64-bit FDE starts, empty FDE
augmentation and supported CFI instruction set. Moving the EH section adjusts
each FDE start and verifies that all absolute function targets, CIE data and
CFI instruction bytes are unchanged. Adjacent new equal encodings without
LSDA/personality may be folded as in LLVM's linker; original entries remain.
Unknown layouts, personalities, LSDA relocations, insufficient space or
overlapping code fail closed. The caller
must incorporate `native_change_ranges`, refresh the native hash and repeat
the final signable-layout/signature-model checks after saving the returned
bytes. The released EH space is not unlimited metadata capacity.

## Validation and limits

With the existing Capstone environment on `PYTHONPATH`, run
`python -B -m unittest -v test_link_layout` from this directory. Tests exercise
mapping, metadata offset updates, header/chained-fixup rejection, compact
unwind lookups, LSDA retention, original-code overlap rejection, switch-bound
counterexamples, EH pointer relocation, section/symbol remapping, relocation
rejection and large synthetic deltas. Use the external background runner for
the complete command on Windows, consistent with the client pipeline.

This is offline linking and packaging evidence. ARM64 execution, exception
unwinding on an iOS device, actual asset loading, gameplay and installation are
separate acceptance surfaces. No save schema, inventory ID or server data is
changed by these tools.

The compact unwind representation and folding restrictions follow LLVM's
[format definition](https://github.com/llvm/llvm-project/blob/main/libunwind/include/mach-o/compact_unwind_encoding.h)
and [Mach-O linker implementation](https://github.com/llvm/llvm-project/blob/main/lld/MachO/UnwindInfoSection.cpp).
Existing sparse-link, SWF-digest and signing-layout helpers retain their source
and license documentation under `../pr43-ios/support/` and
`../ios-cumulative-login/`.
