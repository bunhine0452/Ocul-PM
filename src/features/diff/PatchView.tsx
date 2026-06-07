import {
  classifyDiffLines,
  groupIntoHunks,
  pairDiffLines,
  type DiffLine,
} from "./diffParse";
import type { DiffMode } from "@/contexts/WorkspaceContext";

// Final UI Update (ui_v2) — shared unified-diff renderer. Extracted from
// DiffScreenV2's DiffBody so the 변경 diff 화면 AND the 작업 일지 "그 시점 변경"
// modal (EntryDiffModal) render patches identically. The pure parsers
// (classifyDiffLines/groupIntoHunks/pairDiffLines) stay in diffParse so the
// Lite-W6 safety-net tests keep covering them — this file only owns the markup.

/** Render a raw unified-diff `patch` as hunks (.dl rows). `mode` toggles the
 *  single-gutter unified view vs the side-by-side split. */
export function PatchView({ patch, mode }: { patch: string; mode: DiffMode }) {
  const hunks = groupIntoHunks(classifyDiffLines(patch));
  // `diff-content` sizes to the widest line (min-width: max-content) so long
  // lines render on ONE line and `.diff-code` scrolls horizontally instead of
  // wrapping — and so every row's highlight spans the full scroll width.
  return (
    <div className="diff-content">
      {hunks.map((h, hi) => (
        <Hunk key={hi} header={h.header?.text ?? null} lines={h.lines} mode={mode} />
      ))}
    </div>
  );
}

export function Hunk({
  header,
  lines,
  mode,
}: {
  header: string | null;
  lines: DiffLine[];
  mode: DiffMode;
}) {
  // The hunk's leading line is the @@ header itself (groupIntoHunks keeps it
  // in `lines`); render the body lines after it. Skip header/hunk-kind lines
  // in the row grid since the .hunk-head shows the @@ context.
  const body = lines.filter((l) => l.kind !== "hunk" && l.kind !== "header");
  return (
    <div>
      {header ? <div className="hunk-head">{header}</div> : null}
      {mode === "split" ? <SplitRows lines={body} /> : <UnifiedRows lines={body} />}
    </div>
  );
}

function UnifiedRows({ lines }: { lines: DiffLine[] }) {
  // Single gutter: additions show the new-side number, deletions the old-side,
  // context advances both and shows the new number. The actual base offsets
  // come from the @@ header, which we don't parse here — these are 1-based
  // within the hunk, matching the mockup's per-hunk numbering.
  let oldNo = 0;
  let newNo = 0;
  return (
    <>
      {lines.map((l, i) => {
        if (l.kind === "addition") {
          newNo++;
          return (
            <div className="dl add" key={i}>
              <span className="dl-gut">{newNo}</span>
              <span className="dl-x">{l.text || " "}</span>
            </div>
          );
        }
        if (l.kind === "deletion") {
          oldNo++;
          return (
            <div className="dl del" key={i}>
              <span className="dl-gut">{oldNo}</span>
              <span className="dl-x">{l.text || " "}</span>
            </div>
          );
        }
        oldNo++;
        newNo++;
        return (
          <div className="dl" key={i}>
            <span className="dl-gut">{newNo}</span>
            <span className="dl-x">{l.text || " "}</span>
          </div>
        );
      })}
    </>
  );
}

function SplitRows({ lines }: { lines: DiffLine[] }) {
  const rows = pairDiffLines(lines);
  return (
    <>
      {rows.map((row, i) => (
        <div className="dl split" key={i}>
          <span className="dl-gut">{row.left ? "·" : ""}</span>
          <span
            className={"dl-x" + (row.left ? "" : " empty")}
            style={
              row.left?.kind === "deletion"
                ? { background: "var(--diff-del-bg)", color: "var(--diff-del-text)" }
                : undefined
            }
          >
            {row.left ? row.left.text || " " : ""}
          </span>
          <span className="dl-gut">{row.right ? "·" : ""}</span>
          <span
            className={"dl-x" + (row.right ? "" : " empty")}
            style={
              row.right?.kind === "addition"
                ? { background: "var(--diff-add-bg)", color: "var(--diff-add-text)" }
                : undefined
            }
          >
            {row.right ? row.right.text || " " : ""}
          </span>
        </div>
      ))}
    </>
  );
}
