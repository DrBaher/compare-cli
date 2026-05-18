<!--
Thanks for opening a PR. Keep this template's headings; agents and
reviewers both rely on the consistent shape. Delete the comment blocks
when you fill in your content.
-->

## Summary

<!-- 1–3 sentences. What does this PR do? Why? -->

## What changes

<!-- Bulleted list of user-visible / behavior-visible changes. Reference
files where useful (`compare-cli.mjs:123`, `COMPARE_SCHEMA.md §9.2`). -->

-

## Why this design

<!-- For non-trivial changes: what alternatives were considered? Why
not the obvious-other-option? Especially important when the change
touches the locked contract surfaces (exit codes, --json shape,
clause-detection rule). -->

## Test plan

- [ ] `npm test` passes locally
- [ ] `cd mcp && npm test` passes locally (if `mcp/` touched)
- [ ] Manual smoke: <!-- describe -->
- [ ] CI matrix (Ubuntu × macOS × Node 20/22) green

## Out of scope

<!-- Anything you noticed but deliberately didn't change. Useful for
reviewers so they don't ask "why didn't you also fix X?" -->

## Schema impact

<!-- If this changes the --json shape, AGENTS.md / COMPARE_SCHEMA.md
updates are required. Mark which ones. -->

- [ ] No `--json` shape change
- [ ] AGENTS.md updated
- [ ] COMPARE_SCHEMA.md updated
- [ ] CHANGELOG.md entry added

## Version impact

<!-- Patch / minor / major / no bump. Per the project's posture, the
JSON shape and exit codes are stable across v1.x — changes there force
a major bump (which we won't ship until the suite settles). -->

- [ ] No bump (infra / docs only)
- [ ] Patch
- [ ] Minor
- [ ] Major (locked-surface change)
