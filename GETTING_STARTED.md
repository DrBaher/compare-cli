# Getting started

A 10-minute walkthrough of `compare-cli`. Assumes you've installed it
(`npm install -g compare-cli`) or are using `npx`.

## 1. Install (or try without installing)

```sh
npm install -g compare-cli
compare --version
```

Or run without installing:

```sh
npx -p compare-cli@latest -- compare --demo
```

The package name (`compare-cli`) differs from the bin name (`compare`),
so `npx` needs `-p <package> -- <bin>` to disambiguate.

Requires Node ≥ 20.

## 2. The 30-second demo

```sh
compare --demo
```

Runs against two bundled fixtures — a negotiated NDA and a candidate
where the Term clause silently shifted from "two (2) years" to "three (3)
years". You'll see a substantive-drift report on stdout and the CLI
exits **2**.

```sh
compare --demo --json
```

Same comparison, structured JSON output to stdout. The exit code is
still 2.

`--demo` is the contract demonstration: same exit-code spectrum, same
report shape, no file authoring required.

## 3. Your first real comparison

Author two files:

```sh
cat > negotiated.md <<'EOF'
## 1. Purpose

This agreement governs information exchange between Acme and Globex.

## 2. Term

The term is two (2) years from the Effective Date.

## 3. Notices

All notices shall be delivered to the cover-page addresses.
EOF

cp negotiated.md ready-to-sign.md

# Edit the term clause in one of them:
sed -i.bak 's/two (2) years/three (3) years/' ready-to-sign.md
rm ready-to-sign.md.bak
```

Now compare:

```sh
compare negotiated.md ready-to-sign.md
```

You should see a substantive-drift report on the Term clause, exit 2.

## 4. The exit-code contract

The exit code is the contract:

| Code | Action                                                       |
|------|--------------------------------------------------------------|
| 0    | Safe to sign — every clause matches                          |
| 1    | I/O error — investigate the file                             |
| 2    | Substantive drift — DO NOT sign without review               |
| 3    | Cosmetic or typographic drift only — informational           |
| 4    | Clauses moved but content identical                          |

Wrap it in a shell condition for CI gating:

```sh
compare negotiated.docx ready-to-sign.pdf
status=$?
[ $status -eq 0 ] && echo "✓ safe to sign"
[ $status -eq 2 ] && echo "✗ do not sign"
exit $status
```

## 5. The `--why` block

```sh
compare negotiated.md ready-to-sign.md --why 2>&1 | grep ^why:
```

Prints a structured key=value block to stderr describing detection tiers,
alignment method, class counts, and the exit decision. Same posture as
draft-cli's `--why`.

## 6. The `--json` mode

```sh
compare negotiated.md ready-to-sign.md --json | jq '.differences[0]'
```

Stable JSON shape across v1.x. Top-level keys: `ok`, `exit_class`,
`exit_code`, `base`, `candidate`, `summary`, `differences`, `warnings`.
See [COMPARE_SCHEMA.md §10](./COMPARE_SCHEMA.md) for the full shape.

## 7. The three difference classes

- **cosmetic** — whitespace, curly quotes, em-dashes (presentation noise)
- **typographic** — case-only, `$1,000` vs `$1000`, Oxford comma (formatting)
- **substantive** — actual word changes, additions, removals, negations

By default, cosmetic and typographic are exit 3 (informational, don't
block). Use `--strict` to upgrade typographic to substantive, or
`--strict-cosmetic` to upgrade cosmetic. The two flags are independent;
pass both to upgrade both.

```sh
# Cosmetic drift only — informational:
echo "Term:   two  years" > a.md
echo "Term: two years"    > b.md
compare a.md b.md
echo "exit: $?"
# → 3

# Upgrade cosmetic to substantive:
compare a.md b.md --strict-cosmetic
echo "exit: $?"
# → 2
```

## 8. Cross-format comparison

`.docx` vs `.pdf` works directly:

```sh
compare negotiated.docx ready-to-sign.pdf
```

When either side is a PDF, the report surfaces a warning that
layout-sensitive differences may surface as false positives. This is
honest about pdfjs-dist's text-extraction lossiness.

If the PDF is a scanned image with no OCR layer, the CLI exits 1 with
an explicit message — never silent zero-drift.

## 9. `--from-negotiation`

If you're driving compare-cli from an `nda-review-cli` pipeline:

```sh
compare --from-negotiation negotiation.json ready-to-sign.pdf
```

Reads the latest agreed text from `negotiation.json` and uses it as the
base. Works with both the minimum schema (per-round `agreed: true`) and
the de-facto nda-review-cli release (`clause_status` with all values
`"agreed"`).

No agreed round in the file → exit 2 with a clear message.

## 10. Tab completion (optional)

```sh
# bash
compare --completion bash > /usr/local/etc/bash_completion.d/compare

# zsh
compare --completion zsh > /usr/local/share/zsh/site-functions/_compare
```

Completes top-level flags, the `--completion` shell name, and file paths
for `--from-negotiation` and `--output`.

## 11. Compose with the rest of the suite

`compare-cli` lives in the middle of a contract-operations pipeline:

```sh
# Fill the template
draft template.docx --party-a Acme --party-b Globex --output draft.docx

# Convert to PDF for the signing envelope
docx2pdf draft.docx --output draft.pdf

# Negotiate (rounds happen here, producing negotiation.json)
nda-review negotiate ...

# Gate: does the final PDF match the agreed text?
compare --from-negotiation negotiation.json draft.pdf || exit $?

# Sign
sign draft.pdf --signer counsel@acme.com
```

Each tool reads stdin / writes stdout / exits with a documented code, so
they compose cleanly.

## Troubleshooting

### `npx compare-cli ... --demo` errors with `sh: compare: command not found`

The package is `compare-cli`; the installed bin is `compare`. npm 10.x's
`npx` doesn't auto-resolve a bin when the names differ. Use the explicit
form:

```sh
npx -p compare-cli@latest -- compare --demo
```

Or install globally (`npm install -g compare-cli`) and then `compare` is
on `$PATH` directly. Same behavior, less typing.

### `extracted zero characters from X.pdf`

The PDF has no text layer — it's a scanned image. compare-cli is
deliberately OCR-free (deterministic + zero-network is the contract;
OCR engines are neither). Run an OCR tool first:

```sh
ocrmypdf scanned.pdf scanned-ocr.pdf
compare base.docx scanned-ocr.pdf
```

`ocrmypdf` is a separate project; install it via your package manager.

### Exit code 2 from `--demo`, surprised by `--check` exiting non-zero

`compare --demo` runs against a deliberately-substantive-drift fixture
(the bundled Term clause changed from "two (2) years" to "three (3)
years"). Exit 2 is the contract — the demo demonstrates the gate, not
clean state. Use `compare --version` or `compare --help` if you just
want to confirm the bin runs.

### `compare-cli-mcp` install: `EPEERINVALID compare-cli@…`

`compare-cli-mcp@0.1.0` declared `peerDependencies.compare-cli: ^0.2.0`
which doesn't satisfy `compare-cli@0.3.0+`. The warning is cosmetic —
the server functions correctly because the `--json` shape is stable
across compare-cli's v1.x. Upgrading to `compare-cli-mcp@0.1.1+`
widens the peer-dep range and silences the warning.

### `--from-negotiation: no agreed round found`

The reader walks every round in `negotiation.json` looking for one of
three signals (in order):

1. Top-level `status: "converged" | "signed_off" | "finalized"`.
2. A round with `agreed: true`.
3. A round with `clause_status` whose every value is `"agreed"`.

If none of those is true, the negotiation hasn't converged yet — call
this from compare-cli prematurely and you'll get exit 2 with this
message. Run `nda-review-cli negotiate status` to confirm.

### CI shows a green `compare` step but my `npm publish` blocks

If you're using compare-cli inside a publish workflow as a pre-flight
sanity check, remember the exit codes:

- `0` = safe, publish.
- `2` = substantive drift — usually the right thing to **block** on.
- `3` / `4` = cosmetic / moved — usually safe to publish (the agreement
  didn't change), but if you want a strict gate, add `--strict` and
  `--strict-cosmetic`.

The default CI pattern from `AGENTS.md` "Pre-signature gate in a
pipeline" routes these correctly.

## Next steps

- **[COMPARE_SCHEMA.md](./COMPARE_SCHEMA.md)** for the locked v1 contract.
- **[AGENTS.md](./AGENTS.md)** for the stable agent-facing surface.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** for how the CLI is shaped.
- **[FAQ.md](./FAQ.md)** for common questions.
- **[mcp/README.md](./mcp/README.md)** if you're wiring it into an MCP client.
