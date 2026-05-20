# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | ✓         |

While the project is in `0.x`, only the latest minor receives fixes. Once
the project leaves `0.x`, this policy will update.

## Reporting a vulnerability

If you find a security issue in `compare-cli`, please **do not file a
public GitHub issue**. Instead, open a private security advisory:

- https://github.com/DrBaher/compare-cli/security/advisories/new

Include:

- A description of the issue and where it lives in the code
- Steps to reproduce, ideally a minimal failing input
- Your assessment of the severity and impact

I'll acknowledge within a few business days and propose a coordinated
disclosure timeline.

## Security posture

`compare-cli` is designed for local, deterministic operation:

- **No network calls.** The CLI does not phone home, does not check for
  updates, and does not transmit any input to a third party. There is no
  LLM tier in v1.
- **No telemetry.** Nothing is logged, sent, or stored beyond the report
  the CLI writes to stdout (or `--output PATH`).
- **No filesystem writes outside `--output`** and the temp directory used
  by `jszip` while extracting `.docx` files.
- **Two runtime dependencies only**: `jszip` and `pdfjs-dist`. Both are
  reused from sibling CLIs in the suite. The lockfile pins exact versions.

## Known input-handling risks

- **Malformed `.docx`** is rejected with exit 1 before any text is read.
  jszip's `loadAsync` rejects non-zip input; we don't fall back to a
  permissive parser.
- **Malformed `.pdf`** is rejected with exit 1. pdfjs-dist's `getDocument`
  rejects on structural errors; we don't fall back to OCR or any other
  text-recovery path.
- **Scanned PDFs with no OCR layer** exit 1 with an explicit "may be a
  scanned image" message. The CLI **never silently reports zero drift**
  on a PDF it couldn't read — that's the most important safety property
  of a pre-signature gate.
- **Untrusted XML / PDF inputs.** Both parsers are sandboxed JS libraries
  with no shell-out or eval surface. The XML regex in
  `extractDocxText` matches only `<w:p>` and `<w:t>` content; we don't
  resolve entities beyond the five named ones (`&amp;`, `&lt;`, `&gt;`,
  `&quot;`, `&apos;`).

## What the CLI is *not* designed to defend against

- **Adversarially crafted `.docx` zip bombs.** jszip will refuse files
  with unusual compression ratios, but the CLI doesn't enforce a hard
  decompressed-size cap. For untrusted inputs, run compare-cli inside a
  resource-limited sandbox.
- **Adversarially crafted PDFs.** pdfjs-dist has its own threat model;
  the CLI inherits whatever guarantees pdfjs-dist offers. For especially
  untrusted PDFs, prefer running in a sandbox.
- **Side-channel timing.** Comparison timing leaks information about how
  similar two inputs are. Don't use compare-cli as part of a constant-time
  comparison flow.
