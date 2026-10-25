# Staged iOS R11 candidate integration

This directory joins the equipment-only candidate to three cumulative feature
ports: content operations/time, personal history, and login-scoped town themes.
The iOS carrier is its own registered PR43 full ABC/native/SWF; Android R11 is
the functional donor. All outputs are unsigned local candidates. Neither
accepted registry, admission configuration, source main, server nor CDN changes.

`link_stage.py` keeps the PR43 linker symbol, activation, field-layout,
relocation, runtime-pool and old-byte guards. It supplies the previous pinned
candidate as input and grows its last RX segment while moving LINKEDIT and
updating advertised metadata offsets. Existing function addresses remain fixed.
New function and activation pointers stay inside the existing writable method
tables with explicit dyld rebases. The first report written by the underlying
linker is intercepted as `linked_pending_unwind_finalization` so interruption
cannot falsely expose a finalized stage.

Run the linker with explicit `--prepared`, `--compiled`, `--previous-link`,
`--previous-package`, `--runtime-stubs`, `--dependencies`, `--output` and
`--libraries`. Use `--finalize --output ... --libraries ...` afterward. The
finalizer binds complete object functions, distinguishes code from guarded
inline switch tables, preserves old unwind semantics, and updates function
starts. Its EH relocation and section-index guards are documented in
[equipment-ios-repair](../equipment-ios-repair/README.md). Every outer client
pipeline command on Windows uses the workspace background runner.

`package_stage.py --linked ... --output ...` requires both finalized status and
`unwind_finalized=true`. It replaces only native and SWF in a fresh IPA, preserves
all other members and metadata, and reads back CRC and application identity.
It refuses to overwrite inputs, an existing IPA or an existing receipt.

`verify_equipment.py` independently reads the equipment carrier, its exact sparse
plan, old code ranges, full/runtime identity, unwind rows and package contents.
`verify_stages.py --package-report ... --equipment-link ... --libraries ...
--output ... --detail-output ...` checks each subsequent actual package and
its object/native/ABC lineage. `test_stage_boundaries.py --libraries ...
--equipment-native ...` exercises real-carrier allocation and fail-closed
packaging, including incomplete unwind finalization and retained outputs.

The final cumulative code has the equipment repair and R11 native behavior.
Source snapshots and normalized per-method instructions belong to the private
candidate reference, separately from the original registered-client snapshot.
An offline candidate does not establish installation, actual ARM64 execution,
asset loading, GC, exception behavior or in-game/device acceptance.
