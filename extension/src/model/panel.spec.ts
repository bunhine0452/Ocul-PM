import { describe, expect, it } from "vitest";
import type { Journal } from "./journal";
import type { Overview } from "./overview";
import { arrivals, attentionCount, panelSections } from "./panel";
import type { Plan } from "./plan";
import type { Question, Waiting } from "./waiting";

const journal = (path: string, createdAt: string, evidence = 2): Journal => ({
  path,
  title: path,
  type: "feature",
  createdAt,
  files: [],
  evidence: evidence as Journal["evidence"],
  proof: null,
});
const plan = (id: string, next: string | null, ts = "", status = "active"): Plan => ({
  file: `${id}.md`,
  id,
  title: id,
  status,
  check: null,
  updates: ts ? [{ ts, item: "x", journal: null, note: null }] : [],
  verdict: null,
  next: next ? { id: next, title: next, glyph: " ", indent: 0 } : null,
});
const empty: Overview = { latest: null, failing: [], unrecorded: [], unproven: [] };
const w: Waiting = { sessionId: "s1", kind: "permission", message: "Bash?", since: "2026-11-03T09:00:00Z" };
const q: Question = { id: "q-1", question: "어느 쪽?", options: [], askedAt: "2026-11-03T09:01:00Z" };

describe("panel sections", () => {
  it("shows an all-clear line when nothing needs eyes, and hides the Claude section when nobody waits", () => {
    const s = panelSections({ overview: empty, waiting: [], questions: [], plans: [], journals: [] });
    expect(s.map((x) => x.key)).toEqual(["eyes"]);
    expect(s[0].rows).toEqual([{ kind: "allClear", latest: null }]);
  });

  it("orders Claude first, then exceptions, next items (recently touched plan first) and recent journals", () => {
    const s = panelSections(
      {
        overview: { ...empty, unrecorded: ["a.ts"] },
        waiting: [w],
        questions: [q],
        plans: [plan("old", "o1", "2026-11-01T00:00:00Z"), plan("new", "n1", "2026-11-03T00:00:00Z"), plan("none", null), plan("done", "d", "", "done")],
        journals: [journal("1", "2026-11-01T00:00:00Z"), journal("2", "2026-11-03T00:00:00Z")],
      },
      1,
    );
    expect(s.map((x) => x.key)).toEqual(["claude", "eyes", "next", "recent"]);
    expect(s[0].rows.map((r) => r.kind)).toEqual(["question", "waiting"]);
    expect(s[1].rows).toEqual([{ kind: "unrecorded", path: "a.ts" }]);
    expect(s[2].rows.map((r) => (r.kind === "next" ? r.plan.id : ""))).toEqual(["new", "old"]);
    expect(s[3].rows.map((r) => (r.kind === "journal" ? r.j.path : ""))).toEqual(["2"]);
  });

  it("counts what a person must act on", () => {
    expect(attentionCount({ overview: empty, waiting: [w], questions: [q] })).toBe(2);
  });
});

describe("arrivals", () => {
  it("never rings on the first look, then rings once per new wait", () => {
    const first = arrivals(null, [w], []);
    expect(first.fresh).toEqual([]);
    const again = arrivals(first.seen, [w], [q]);
    expect(again.fresh).toEqual([{ kind: "question", q }]);
    expect(arrivals(again.seen, [w], [q]).fresh).toEqual([]);
    // 같은 세션이 다시 기다리면 새 기다림이다.
    const later = { ...w, since: "2026-11-03T09:30:00Z" };
    expect(arrivals(again.seen, [later], [q]).fresh).toEqual([{ kind: "waiting", w: later }]);
  });
});
