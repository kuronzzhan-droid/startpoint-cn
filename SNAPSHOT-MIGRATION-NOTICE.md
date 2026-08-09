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
