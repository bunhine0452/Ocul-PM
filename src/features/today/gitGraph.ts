import type { GitGraphCommit } from "@/lib/bindings";

// Lane assignment for a VSCode-style commit graph (Today git graph). Pure +
// deterministic so it can be unit-tested. Input: commits newest-first with
// parent SHAs (from `git log --all --date-order`). Output: per-row lane +
// the edge segments to draw (pass-through verticals, converging "ups" into the
// node, and "downs" from the node to each parent lane).

export interface GraphSeg {
  lane: number;
  color: number;
}

export interface GraphRow {
  commit: GitGraphCommit;
  nodeLane: number;
  color: number;
  /** Lanes crossing this row untouched (other branches in flight). */
  through: GraphSeg[];
  /** Lanes entering the node from the top (children/merge sources). */
  ups: GraphSeg[];
  /** Lanes leaving the node toward the bottom (this commit's parents). */
  downs: GraphSeg[];
}

export interface GraphLayout {
  rows: GraphRow[];
  laneCount: number;
}

export function computeGitGraph(commits: GitGraphCommit[]): GraphLayout {
  // lanes[i] = sha the lane is currently waiting to render next (or null/free).
  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  let nextColor = 0;

  const freeLane = (): number => {
    const i = lanes.indexOf(null);
    if (i !== -1) return i;
    lanes.push(null);
    laneColor.push(0);
    return lanes.length - 1;
  };

  const rows: GraphRow[] = commits.map((commit) => {
    const incoming = lanes.map((sha, i) => ({ i, sha, color: laneColor[i] }));
    const waiting = incoming.filter((l) => l.sha === commit.sha).map((l) => l.i);

    let nodeLane: number;
    let color: number;
    if (waiting.length > 0) {
      nodeLane = waiting[0];
      color = laneColor[nodeLane];
    } else {
      nodeLane = freeLane();
      color = nextColor++;
      laneColor[nodeLane] = color;
    }

    const ups: GraphSeg[] =
      waiting.length > 0
        ? waiting.map((i) => ({ lane: i, color: laneColor[i] }))
        : [{ lane: nodeLane, color }]; // tip — a short top stub

    const through: GraphSeg[] = incoming
      .filter((l) => l.sha != null && l.sha !== commit.sha)
      .map((l) => ({ lane: l.i, color: l.color }));

    // Extra lanes that merged into this commit collapse (free them).
    for (let k = 1; k < waiting.length; k++) lanes[waiting[k]] = null;

    const downs: GraphSeg[] = [];
    const parents = commit.parents;
    if (parents.length === 0) {
      lanes[nodeLane] = null;
    } else {
      lanes[nodeLane] = parents[0];
      laneColor[nodeLane] = color;
      downs.push({ lane: nodeLane, color });
      for (let p = 1; p < parents.length; p++) {
        let pl = lanes.indexOf(parents[p]);
        let pc: number;
        if (pl === -1) {
          pl = freeLane();
          lanes[pl] = parents[p];
          pc = nextColor++;
          laneColor[pl] = pc;
        } else {
          pc = laneColor[pl];
        }
        downs.push({ lane: pl, color: pc });
      }
    }

    return { commit, nodeLane, color, through, ups, downs };
  });

  let laneCount = 1;
  for (const r of rows) {
    laneCount = Math.max(
      laneCount,
      r.nodeLane + 1,
      ...r.through.map((t) => t.lane + 1),
      ...r.ups.map((u) => u.lane + 1),
      ...r.downs.map((d) => d.lane + 1),
    );
  }
  return { rows, laneCount };
}
