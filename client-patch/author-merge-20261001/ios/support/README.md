# Equipment verification support

These are handwritten verification and binary-reader definitions, not exported
original game sources. The fixture strings are isolated recording substitutes.
`equipment_core.py` and `equipment_preload.py` preserve the reviewed fixture
functions and constants; historical executable entry points are omitted.
`equipment_fixture_common.py` uses the repository ABC parser and SWF helpers.
`object_reader.py` retains the equipment symbol-boundary routine and shares
`FunctionRecord`, text conversion and relocation parsing with
`pr43-ios/support/aot_helpers.py`. `native_reader.py` only reads an explicit
ARM64 native input; it has no implicit current-registry lookup or file writer.

The compiler entries require `--source`, `--out`, `--sdk`, `--dependencies`,
`--runtime-map`, `--libraries` and `--background`. Corrected-helper extraction
also requires `--native` and `--native-sha256`. Supply the fixed historical full
ABC/native image and runtime-helper map that belong to the equipment plan.
The existing compiler and 284 dependency identities are still enforced.
Use the existing environment containing LIEF and Capstone; do not install a
separate global environment. The output must be outside the source checkout.

`test_repaired_equipment.py` requires explicit `--sdk` and `--java` in addition
to the candidate/hash, output and reference root. The reference root is data:
retain stage-05 `inputs.json` and its original full ABC, stage-09 core/preload
reports, compile receipts, fixture sources, saved SWFs, observations and their
executed source snapshots, and stage-10 `transform/generated-bodies.json`.
If a stage-09 executed snapshot was identical to its original source and no
separate snapshot exists, retain `tools/test_equipment_core.py` or
`tools/test_equipment_preload.py` as provenance data. Those old scripts are
never imported or executed: their original hashes and the retained definition
ASTs are checked before reusing the saved evidence. Changing fixture behavior
requires new evidence; moving its import/configuration entry does not rewrite
historical reports. Run the full AIR command through the external workspace
background runner. Native compilation and AIR execution are separate checks
from import, static equivalence or saved-evidence readback.
