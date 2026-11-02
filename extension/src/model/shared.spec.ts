// 앱(Rust)과 같은 사례표 — `src-tauri/src/git/receipt_cases.json`. Rust 쪽은 `git/receipt_cases_tests.rs`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evidenceLevel, proofLine, verificationSection } from "./evidence";
import { journalTitle } from "./journal";
import { checkCommand, parseNote } from "./plan";

const cases = JSON.parse(
  readFileSync(new URL("../../../src-tauri/src/git/receipt_cases.json", import.meta.url), "utf8"),
) as {
  evidence: { body: string; level: number; proof: string | null }[];
  title: { body: string; title: string }[];
  verdict: { note: string; passed: boolean | null; summary: string | null }[];
  check: { md: string; check: string | null }[];
};

describe("shared cases with the app", () => {
  it.each(cases.evidence)("evidence $body", (c) => {
    expect(evidenceLevel(c.body)).toBe(c.level);
    const s = verificationSection(c.body);
    expect(s === null ? null : proofLine(s)).toBe(c.proof);
  });
  it.each(cases.title)("title $body", (c) => expect(journalTitle(c.body)).toBe(c.title));
  it.each(cases.verdict)("verdict $note", (c) =>
    expect(parseNote(c.note)).toEqual(c.passed === null ? null : { passed: c.passed, summary: c.summary }),
  );
  it.each(cases.check)("check $md", (c) => expect(checkCommand(c.md)).toBe(c.check));
});
