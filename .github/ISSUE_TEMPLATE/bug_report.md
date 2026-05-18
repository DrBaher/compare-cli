---
name: Bug report
about: A reproducible defect in the CLI or its output
title: "bug: "
labels: bug
---

## What happened

<!-- One sentence. What did the tool do that was wrong? -->

## What you expected

<!-- One sentence. What should it have done instead? -->

## Reproduction

<!-- Smallest possible inputs that surface the bug. Include actual files
where possible (paste content or attach). For binary inputs, base64 a
small sample. -->

```sh
compare path/to/base.docx path/to/cand.pdf --json --why
```

```text
<paste the output, both stdout and stderr>
```

## Environment

- compare-cli version: <!-- compare --version -->
- Node version: <!-- node --version -->
- OS: <!-- macOS / Ubuntu / etc. -->
- Install method: <!-- npm install -g | npx | other -->

## Exit code

<!-- What exit code did you get? What did you expect? -->

## Additional context

<!-- Anything else relevant. If you have a `--why` block, paste it. -->
