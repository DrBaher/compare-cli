// --from-negotiation: minimum schema reader + clause_status fallback
import { test } from "node:test";
import assert from "node:assert/strict";
import { readNegotiation, main, EXIT } from "../compare-cli.mjs";
import { tmp, makeFile, runMain } from "./_helpers.mjs";

const AGREED_TEXT = "## 1. Purpose\n\nAgreed body.\n";

test("minimum schema: agreed: true on the last round wins", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [
      { round: 1, text: "earlier", agreed: false },
      { round: 2, text: AGREED_TEXT, agreed: true },
    ],
  }));
  const text = readNegotiation(path);
  assert.equal(text, AGREED_TEXT);
});

test("walks from last to first: takes the latest agreed round", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [
      { round: 1, text: "first agreed", agreed: true },
      { round: 2, text: "later not agreed", agreed: false },
      { round: 3, text: "latest agreed", agreed: true },
    ],
  }));
  const text = readNegotiation(path);
  assert.equal(text, "latest agreed");
});

test("clause_status fallback: round counts as agreed when all values are 'agreed'", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [
      {
        round: 1,
        text: AGREED_TEXT,
        clause_status: { "Purpose": "agreed", "Term": "agreed" },
      },
    ],
  }));
  const text = readNegotiation(path);
  assert.equal(text, AGREED_TEXT);
});

test("clause_status fallback: NOT agreed when any value is 'disputed'", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [
      {
        round: 1,
        text: AGREED_TEXT,
        clause_status: { "Purpose": "agreed", "Term": "disputed" },
      },
    ],
  }));
  assert.throws(
    () => readNegotiation(path),
    (e) => e.exit === EXIT.SUBSTANTIVE && /no agreed round/.test(e.message),
  );
});

test("explicit agreed: true beats clause_status fallback", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [
      { round: 1, text: "explicit", agreed: true, clause_status: { "Purpose": "disputed" } },
    ],
  }));
  // explicit agreed=true wins even when clause_status says disputed
  const text = readNegotiation(path);
  assert.equal(text, "explicit");
});

test("no agreed round → exit 2 with clear message", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [
      { round: 1, text: "x", agreed: false },
      { round: 2, text: "y", agreed: false },
    ],
  }));
  assert.throws(() => readNegotiation(path), (e) => {
    return e.exit === EXIT.SUBSTANTIVE && /no agreed round/.test(e.message);
  });
});

test("empty rounds array → exit 1 with clear message", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({ rounds: [] }));
  assert.throws(() => readNegotiation(path), (e) => {
    return e.exit === EXIT.IO && /non-empty 'rounds'/.test(e.message);
  });
});

test("missing rounds key → exit 1", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({ something: 1 }));
  assert.throws(() => readNegotiation(path), (e) => e.exit === EXIT.IO);
});

test("malformed JSON → exit 1", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", "this is not JSON");
  assert.throws(() => readNegotiation(path), (e) => e.exit === EXIT.IO);
});

test("missing file → exit 1", () => {
  assert.throws(() => readNegotiation("/no/such/neg.json"), (e) => e.exit === EXIT.IO);
});

test("rounds with non-string text are skipped, not crashed", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [
      { round: 1, text: null, agreed: true },
      { round: 2, text: AGREED_TEXT, agreed: true },
    ],
  }));
  assert.equal(readNegotiation(path), AGREED_TEXT);
});

test("end-to-end: --from-negotiation feeds base text into the comparison", async () => {
  const dir = tmp();
  const neg = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [{ round: 1, text: "## A\nbody\n", agreed: true }],
  }));
  const cand = makeFile(dir, "cand.md", "## A\nbody changed.\n");
  const { code, out } = await runMain(main, ["--from-negotiation", neg, cand, "--json"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  const r = JSON.parse(out);
  assert.equal(r.differences.length, 1);
  assert.equal(r.differences[0].class, "substantive");
});

test("end-to-end: --from-negotiation with no agreed round → exit 2 with clear error", async () => {
  const dir = tmp();
  const neg = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [{ round: 1, text: "x", agreed: false }],
  }));
  const cand = makeFile(dir, "cand.md", "x");
  const { code, err } = await runMain(main, ["--from-negotiation", neg, cand]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  assert.match(err, /no agreed round/);
});
