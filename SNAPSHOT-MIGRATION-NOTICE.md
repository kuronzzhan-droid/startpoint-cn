# Custom server snapshot migration

This branch is a review snapshot of the locally deployed CN server and is based on
`release/modes-20260714` at `76223aa63dba61a8a959c1a4672815d4d6c172e8`.

It is intended for inspection, diffing, and selective cherry-picking. Do not merge
the branch wholesale into `release/modes-20260714` or `main`.

Included areas:

- accumulated server fixes and admin-panel changes;
- the `mode15` fantasy-gauntlet implementation and its optional loader;
- multiplayer room integration for mode 15;
- fantasy-gauntlet tooling, boss-trial templates, segmented-HP audits, and related tests;
- required master-data/configuration changes used by the local deployment.

Intentionally excluded:

- `.database`, `.cdn`, `.env`, account/save data, and local secrets;
- runtime logs, backups, caches, generated build outputs, and `node_modules`;
- local reverse-engineering workspaces and large raw CDN archives;
- generated client release bundles that are not required to review the server logic.

The target repository's own workflows, agent instructions, client-patch tools,
asset-patch history, and top-level `mod-tools` tree are preserved unchanged to keep
the review diff focused and non-destructive.

## Continuation: 2026-08-10

This continuation selectively ports the following locally deployed fixes without
replacing the target repository's existing mode-15 implementation:

- persist multiplayer host ownership for active quests so stale fantasy-gauntlet
  recovery only resets the host or a true single-player battle;
- retain the actual played party in mode-15 boundary records and repair legacy
  all-null records with the current valid party;
- accept both legacy and current continue-request methods and `play_id` spellings,
  while charging free beads before paid beads;
- make bulk shop purchase compatible with JSON and flattened query payloads, skip
  invalid or unavailable products, cap purchases by stock and currency, and settle
  the feasible purchase atomically.

The locally published 1.4.71 to 1.4.72 binary client resource bundle is intentionally
not copied into this branch. It belongs to a separate local release chain and would
otherwise overwrite the target repository's client asset publication workflow.
