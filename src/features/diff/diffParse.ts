// PR-UI 8b — pure git-unified-diff parsers extracted from LocalDiffView.tsx so
// the live DiffScreenV2 (+ the Lite-W6 safety-net tests) can keep importing
// them while the LocalDiffView *component* (which carried the last Tailwind
// dark-variants) moves to src/legacy/. No JSX, no theming — just parsing.

export type DiffLineKind =
  | "header"
  | "hunk"
  | "addition"
  | "deletion"
  | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Classify each line of a git unified diff. Exported (pure) for unit
 * testing of the renderer's coloring rules.
 */
export function classifyDiffLines(patch: string): DiffLine[] {
  return patch.split("\n").map((text): DiffLine => {
    if (text.startsWith("diff --git ")) return { kind: "header", text };
    if (
      text.startsWith("index ") ||
      text.startsWith("--- ") ||
      text.startsWith("+++ ")
    ) {
      return { kind: "header", text };
    }
    if (text.startsWith("@@")) return { kind: "hunk", text };
    if (text.startsWith("+")) return { kind: "addition", text };
    if (text.startsWith("-")) return { kind: "deletion", text };
    return { kind: "context", text };
  });
}

/**
 * Lite-W6 PR6.5: split a classified line stream into hunks. Each `@@` line
 * starts a new hunk; lines before the first `@@` (file header) flow into a
 * sentinel "preamble" hunk with no header so the renderer can show them
 * once at the top. Exported for unit testing.
 */
export interface DiffHunk {
  header: DiffLine | null;
  lines: DiffLine[];
}

export function groupIntoHunks(lines: DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk = { header: null, lines: [] };
  for (const line of lines) {
    if (line.kind === "hunk") {
      if (current.lines.length > 0 || current.header) hunks.push(current);
      current = { header: line, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) hunks.push(current);
  return hunks;
}

/**
 * Lite-W6 PR6.5: pair `-`/`+` lines into rows for side-by-side rendering.
 * Consecutive deletions and the immediately following consecutive additions
 * are zipped index-by-index; longer side fills its remaining rows with
 * `null` on the opposite side. Context / header / hunk lines render
 * identically on both sides (truth-y on both). Exported for unit testing.
 */
export function pairDiffLines(
  lines: DiffLine[],
): Array<{ left: DiffLine | null; right: DiffLine | null }> {
  const rows: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === "deletion") {
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "deletion") {
        dels.push(lines[i]);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "addition") {
        adds.push(lines[i]);
        i++;
      }
      const max = Math.max(dels.length, adds.length);
      for (let k = 0; k < max; k++) {
        rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
    } else if (l.kind === "addition") {
      rows.push({ left: null, right: l });
      i++;
    } else {
      // header / hunk / context — same on both sides
      rows.push({ left: l, right: l });
      i++;
    }
  }
  return rows;
}
