# One-link cumulative R11 candidate

`build_cumulative.py` reuses the equipment repair carrier and the immutable
operations, profile and town object batches to link the final R11 implementation
once. It appends one final runtime ABC and method-flags array. It does not trim
arbitrary regions from the staged native image or remove application resources.
The original registered client and the four staged candidates remain inputs.

The recipe is pinned to this reviewed batch: 129 existing R11 methods, 102 new
methods and 101598 total methods. Method 52124 uses the final town definition;
its original comparison body comes from the first operations replacement.
Unsupported overlaps, aliases, generated initializers or changed inputs fail
closed. Object files are not edited. A selection view hides other batches'
temporary return stubs while preserving original symbol/relocation indices,
complete function boundaries and the owning LIEF binary lifetime.

Final declarations and pools come from the town compiler metadata. Each target
runtime body comes from its selected compiler batch; other bodies come from the
equipment carrier. This reproduces the staged body-retention rule, including
the profile class initializer's stack metadata. The assembled runtime, flags
and full ABC must equal the retained final town candidate before linking.

## Preparation and linking

Provide explicit paths for the equipment link/package reports, the three
ordered stage link reports, existing runtime stubs, the registered ABC dependency
directory and the existing LIEF/Capstone library directory. Use a fresh prepared
directory and a fresh linked directory. Run all outer client pipeline commands
through the workspace's background runner on Windows.

1. Run `build_cumulative.py --prepare --equipment-link ...
   --equipment-package ... --stage-link <operations> --stage-link <profile>
   --stage-link <town> --output <prepared> --libraries ...`.
2. Run `build_cumulative.py --prepared <prepared>/port.json
   --compiled <prepared>/compile-report.json --runtime-stubs ...
   --dependencies ... --output <linked> --libraries ...`.
3. Run `build_cumulative.py --finalize --output <linked> --libraries ...`.
4. Run `package_stage.py --linked <linked>/link-report.json --output <fresh.ipa>`.

Preparation freezes input hashes and per-method object ownership. Linking and
finalization check them again; the cumulative adapter and compiled receipt are
also frozen across those phases. The first linked report is pending, and the
packager rejects unfinished unwind/function-start integration. Existing outputs
are never overwritten by preparation, linking or packaging.

## Independent verification

Run `test_cumulative.py --libraries ... --input-root ...` and
`test_verify_cumulative.py --reference-root ...` for source-selection and fault
injection checks. The latter includes damaged body metadata, stale ownership,
branch reports and non-relocation native bytes.

Run `verify_cumulative.py --package-report <fresh.json> --reference-root ...
--libraries ... --output <verification.json> --detail-output <details.json>` on
the actual IPA. It derives method ownership independently from the retained
stage reports and objects. It checks each relocated function against its object
and staged implementation, the exact final runtime/full ABC/flags/SWF,
activation descriptors, old code and table pointers, dyld rebases, EH/unwind and
function starts, signing/ldid boundaries and unchanged compressed resource
members. It also verifies that intermediate runtime copies are absent from the
new append region and measures the native storage reduction.

These are unsigned offline candidates. Static equivalence and package readback
do not establish actual ARM64 execution, GC, exceptions, startup stability,
memory use or device acceptance. No registry promotion, admission change,
server/CDN update, signing, deployment or source commit is performed by this
recipe.
