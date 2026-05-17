// Alignment + move detection (LCS on clause titles)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignClauses, detectMoves, compareDocuments,
} from "../compare-cli.mjs";

function clauses(...titles) {
  return titles.map((t) => ({ title: t, body: `body of ${t}` }));
}

test("alignClauses pairs same-titled clauses by normalized title", () => {
  const base = clauses("Purpose", "Term", "Notices");
  const cand = clauses("Purpose", "Term", "Notices");
  const { pairs, added, removed } = alignClauses(base, cand);
  assert.equal(pairs.length, 3);
  assert.equal(added.length, 0);
  assert.equal(removed.length, 0);
});

test("alignClauses reports added/removed when titles differ", () => {
  const base = clauses("Purpose", "Term");
  const cand = clauses("Purpose", "Notices");
  const { pairs, added, removed } = alignClauses(base, cand);
  assert.equal(pairs.length, 1);
  assert.deepEqual(added, [1]);   // candidate index 1 = "Notices"
  assert.deepEqual(removed, [1]); // base index 1 = "Term"
});

test("alignClauses handles duplicate titles by pairing in order", () => {
  const base = clauses("Definition", "Definition", "Term");
  const cand = clauses("Definition", "Term", "Definition");
  const { pairs } = alignClauses(base, cand);
  assert.equal(pairs.length, 3);
  // First Definition pairs first Definition; second Definition pairs second
  // Definition. Term pairs Term.
  const def = pairs.filter((p) => base[p.baseIdx].title === "Definition");
  assert.equal(def.length, 2);
});

test("detectMoves marks pairs not in the LIS of candidate indices", () => {
  // base: A B C → cand: B A C  (A moved past B)
  const pairs = [
    { baseIdx: 0, candIdx: 1 }, // A in base @ 0, in cand @ 1
    { baseIdx: 1, candIdx: 0 }, // B in base @ 1, in cand @ 0
    { baseIdx: 2, candIdx: 2 }, // C in base @ 2, in cand @ 2
  ];
  const moved = detectMoves(pairs);
  // LIS of [1, 0, 2] is [1, 2] or [0, 2]; one of A/B is "moved", C is not.
  assert.equal(moved.size, 1);
  assert.equal(moved.has(2), false); // C is never moved
});

test("detectMoves returns empty when every pair is in order", () => {
  const pairs = [
    { baseIdx: 0, candIdx: 0 },
    { baseIdx: 1, candIdx: 1 },
    { baseIdx: 2, candIdx: 2 },
  ];
  assert.equal(detectMoves(pairs).size, 0);
});

test("compareDocuments: same-titled clean clauses in same order → no differences", () => {
  const base = { text: "## A\nbody A.\n\n## B\nbody B.\n" };
  const cand = { text: "## A\nbody A.\n\n## B\nbody B.\n" };
  const { differences } = compareDocuments(base, cand);
  assert.equal(differences.length, 0);
});

test("compareDocuments: same titles, content changed → substantive", () => {
  const base = { text: "## A\nbody A.\n\n## B\nbody B.\n" };
  const cand = { text: "## A\nbody A.\n\n## B\nbody B changed.\n" };
  const { differences } = compareDocuments(base, cand);
  assert.equal(differences.length, 1);
  assert.equal(differences[0].class, "substantive");
  assert.equal(differences[0].clause_title, "B");
});

test("compareDocuments: clause added in candidate → 'added'", () => {
  const base = { text: "## A\nbody A.\n" };
  const cand = { text: "## A\nbody A.\n\n## B\nbody B.\n" };
  const { differences } = compareDocuments(base, cand);
  assert.equal(differences.length, 1);
  assert.equal(differences[0].class, "added");
  assert.equal(differences[0].clause_title, "B");
  assert.equal(differences[0].clause_index_base, null);
  assert.equal(differences[0].clause_index_candidate, 2);
});

test("compareDocuments: clause removed in candidate → 'removed'", () => {
  const base = { text: "## A\nbody A.\n\n## B\nbody B.\n" };
  const cand = { text: "## A\nbody A.\n" };
  const { differences } = compareDocuments(base, cand);
  assert.equal(differences.length, 1);
  assert.equal(differences[0].class, "removed");
  assert.equal(differences[0].clause_title, "B");
  assert.equal(differences[0].clause_index_candidate, null);
});

test("compareDocuments: clause moved with identical content → 'moved'", () => {
  // Two clauses swap order, both bodies identical
  const base = { text: "## A\nbody A.\n\n## B\nbody B.\n" };
  const cand = { text: "## B\nbody B.\n\n## A\nbody A.\n" };
  const { differences } = compareDocuments(base, cand);
  // One pair is moved (whichever isn't in the LIS); the other is clean and
  // therefore not reported.
  assert.equal(differences.length, 1);
  assert.equal(differences[0].class, "moved");
});

test("compareDocuments: clause moved AND content changed → substantive, not moved", () => {
  const base = { text: "## A\nbody A.\n\n## B\nbody B.\n" };
  const cand = { text: "## B\nbody B changed.\n\n## A\nbody A.\n" };
  const { differences } = compareDocuments(base, cand);
  // B's content changed: it's substantive, not moved.
  const b = differences.find((d) => d.clause_title === "B");
  assert.equal(b.class, "substantive");
  // The remaining clause-A pair has identical content but moved: it's "moved"
  // (per §8.3, move detection only runs on clean pairs).
  const a = differences.find((d) => d.clause_title === "A");
  assert.equal(a.class, "moved");
});

test("compareDocuments: differences sorted by clause_index_base ascending, nulls last", () => {
  const base = { text: "## A\nbody A.\n\n## B\nbody B.\n" };
  const cand = { text: "## C\nbody C.\n\n## A\nbody A2.\n" };
  const { differences } = compareDocuments(base, cand);
  // Expect: substantive A (index 1), removed B (index 2), added C (null)
  const idxs = differences.map((d) => d.clause_index_base);
  assert.deepEqual(idxs, [1, 2, null]);
});
