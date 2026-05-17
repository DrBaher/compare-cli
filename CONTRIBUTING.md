# Contributing to compare-cli

Thanks for your interest. compare-cli is part of the
[contract-operations suite](https://cli.drbaher.com) and shares posture
with its siblings:
[draft-cli](https://github.com/DrBaher/draft-cli),
[nda-review-cli](https://github.com/DrBaher/nda-review-cli),
[docx2pdf-cli](https://github.com/DrBaher/docx2pdf-cli), and
[sign-cli](https://github.com/DrBaher/sign-cli).

## Scope

compare-cli does one thing: **clause-aware drift detection between two
contract versions**. The exit code is the contract. Out of scope:

- Generating redlines (that's nda-review-cli's job)
- Filling templates (that's draft-cli's job)
- Verifying `negotiation.json` hash chains (that's nda-review-cli's job)
- Signing (that's sign-cli's job)
- Format conversion (that's docx2pdf-cli's job)

If you're proposing a feature, check that it falls inside this scope.

## Technical constraints

Four locked invariants:

1. **Single-file `compare-cli.mjs`.** No `src/` directory, no build step.
2. **Two runtime deps only**: `jszip` and `pdfjs-dist`. Adding a third
   requires a justification in the PR description and reviewer approval.
3. **Deterministic by default.** No LLM tier, no telemetry, no network
   calls in the default path. If a semantic mode lands in v2, it must be
   env-gated (opt-in) the same way draft-cli's T5 is.
4. **Local-first.** Inputs are read from disk or stdin; outputs go to
   stdout, stderr, or `--output PATH`. No external service calls.

## Testing

- **Coverage gate**: ≥ 80% line on `compare-cli.mjs`. CI enforces it.
- **One concern per file** under `tests/`. Mirror the existing layout
  (test_args, test_clauses, test_normalize, test_classify,
  test_align_moves, test_exit, test_extract, test_negotiation,
  test_output, test_modes).
- **Mock all I/O** — no real network, no real PDFs from disk beyond the
  hand-built fixtures from `tests/_helpers.mjs`.
- **Shared utilities** live in `tests/_helpers.mjs`: `CaptureStream`,
  `runMain`, `tmp`, `makeFile`, `makeDocx` (via jszip), `makePdf`
  (hand-built minimal PDF).

Run:

```sh
make test               # full suite
make test-quick         # quick subset
make coverage           # with --experimental-test-coverage
```

## Commit style

- Imperative subject under 72 characters
- Body paragraphs explaining the *why*, not the *what*
- Reference the locked schema (COMPARE_SCHEMA.md §<n>) when applicable
- No "WIP" commits on `main`

Squash to clean history before merging.

## Pull-request flow

1. Branch from `main` as `<your-handle>/<short-description>`.
2. Make the change. Update tests. Update CHANGELOG.md under an
   "Unreleased" heading if the change is user-visible.
3. If you're touching the locked schema (exit codes, `--json` shape,
   class boundary, clause detection rules), update
   [COMPARE_SCHEMA.md](./COMPARE_SCHEMA.md) **first** and call out the
   bump in the PR description.
4. Open the PR. The CI matrix (Ubuntu × macOS × Node 18 / 20 / 22) +
   coverage gate + smoke build must all pass.

## Release process

Releases are tagged after merging to `main`:

```sh
# Bump version in package.json
# Update CHANGELOG.md with the release entry
git tag v0.x.y
git push origin v0.x.y
```

The tag push triggers `publish.yml`, which:

1. Re-runs the test suite.
2. Verifies the tag matches `package.json` version.
3. Publishes to npm via Trusted Publishing OIDC (with a bootstrap
   `NPM_TOKEN` fallback while the upstream OIDC issue tracked in
   draft-cli's CHANGELOG 0.3.2 is unresolved).
4. Generates a provenance attestation (`--provenance`).

Trusted Publisher must be configured on npmjs.com under
`DrBaher/compare-cli` → `publish.yml` → `npm` environment. Once that's
in place, no npm token is needed in repo secrets (modulo the bootstrap
fallback above).

Tagging is irreversible — once a version is on npm it cannot be replaced.
Don't tag until the PR is merged and you're sure.
