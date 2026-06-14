import { describe, it, expect } from "vitest";
import { computeGitGraph } from "@/features/today/gitGraph";
import type { GitGraphCommit } from "@/lib/bindings";

// Unit coverage for the Today git-graph lane assignment (dogfooding 2026-06-15).
// The lane algorithm is the only non-trivial new logic; these pin its shape so a
// regression (off-by-one lane, lost merge edge) is caught without the GUI.

function c(sha: string, parents: string[], refs: string[] = []): GitGraphCommit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    parents,
    author_name: "tester",
    timestamp: 0,
    subject: `commit ${sha}`,
    refs,
  };
}

describe("computeGitGraph", () => {
  it("places a linear history in a single lane", () => {
    const { rows, laneCount } = computeGitGraph([
      c("a", ["b"]),
      c("b", ["c"]),
      c("c", []),
    ]);
    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.nodeLane)).toEqual([0, 0, 0]);
    // First parent of each (except the root) leaves the node downward.
    expect(rows[0].downs).toHaveLength(1);
    expect(rows[2].downs).toHaveLength(0); // root has no parents
  });

  it("opens a lane for a branch and collapses it at the merge base", () => {
    // m = merge of a + b; a and b both descend from c.
    const { rows, laneCount } = computeGitGraph([
      c("m", ["a", "b"]),
      c("a", ["c"]),
      c("b", ["c"]),
      c("c", []),
    ]);
    expect(laneCount).toBeGreaterThanOrEqual(2);

    const m = rows.find((r) => r.commit.sha === "m")!;
    // A merge commit feeds two parent lanes.
    expect(m.downs).toHaveLength(2);
    expect(new Set(m.downs.map((d) => d.lane)).size).toBe(2);

    // The two branch tips sit in different lanes...
    const a = rows.find((r) => r.commit.sha === "a")!;
    const b = rows.find((r) => r.commit.sha === "b")!;
    expect(a.nodeLane).not.toBe(b.nodeLane);

    // ...and both converge into c (two incoming edges on the merge base).
    const cc = rows.find((r) => r.commit.sha === "c")!;
    expect(cc.ups.length).toBeGreaterThanOrEqual(2);
  });

  it("every lane index stays within laneCount", () => {
    const { rows, laneCount } = computeGitGraph([
      c("m", ["a", "b"]),
      c("a", ["c"]),
      c("b", ["d"]),
      c("c", ["e"]),
      c("d", ["e"]),
      c("e", []),
    ]);
    for (const r of rows) {
      const lanes = [r.nodeLane, ...r.through.map((t) => t.lane), ...r.ups.map((u) => u.lane), ...r.downs.map((d) => d.lane)];
      for (const l of lanes) {
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThan(laneCount);
      }
    }
  });
});
