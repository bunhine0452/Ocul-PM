import hljs from "highlight.js/lib/common";
import {
  classifyDiffLines,
  groupIntoHunks,
  pairDiffLines,
  type DiffLine,
} from "./diffParse";
import type { DiffMode } from "@/contexts/WorkspaceContext";

// Final UI Update (ui_v2) — shared unified-diff renderer. Extracted from
// DiffScreenV2's DiffBody so the 변경 diff 화면 AND the 작업 일지 항목 디테일 뷰
// (EntryDetailView) render patches identically. The pure parsers
// (classifyDiffLines/groupIntoHunks/pairDiffLines) stay in diffParse so the
// Lite-W6 safety-net tests keep covering them — this file only owns the markup.
//
// Dogfooding 2026-06-07: each line's code (sans the +/-/space marker) is syntax-
// highlighted with highlight.js when a language is known (langFromPath), so the
// diff reads like an editor. Token colors come from the .hljs-* rules in
// screens.css (theme-aware); the marker keeps its own column.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Split a diff line into its marker (+/-/space) and syntax-highlighted code. */
function renderLine(text: string, lang: string | null): { marker: string; html: string } {
  const first = text.charAt(0);
  const hasMarker = first === "+" || first === "-" || first === " ";
  const marker = hasMarker ? first : "";
  const code = hasMarker ? text.slice(1) : text;
  let html: string;
  if (code && lang && hljs.getLanguage(lang)) {
    try {
      html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      html = escapeHtml(code);
    }
  } else {
    html = escapeHtml(code);
  }
  return { marker, html };
}

/** Inner of a code cell: a fixed marker column + the highlighted code. */
function CodeInner({ text, lang }: { text: string; lang: string | null }) {
  const { marker, html } = renderLine(text, lang);
  return (
    <>
      <span className="dl-mark">{marker || " "}</span>
      <span className="dl-code" dangerouslySetInnerHTML={{ __html: html || " " }} />
    </>
  );
}

/** Render a raw unified-diff `patch` as hunks (.dl rows). `mode` toggles the
 *  single-gutter unified view vs the side-by-side split. `lang` (highlight.js
 *  id) enables syntax coloring. */
export function PatchView({
  patch,
  mode,
  lang = null,
}: {
  patch: string;
  mode: DiffMode;
  lang?: string | null;
}) {
  const hunks = groupIntoHunks(classifyDiffLines(patch));
  // `diff-content` sizes to the widest line (min-width: max-content) so long
  // lines render on ONE line and `.diff-code` scrolls horizontally instead of
  // wrapping — and so every row's highlight spans the full scroll width.
  return (
    <div className="diff-content">
      {hunks.map((h, hi) => (
        <Hunk key={hi} header={h.header?.text ?? null} lines={h.lines} mode={mode} lang={lang} />
      ))}
    </div>
  );
}

export function Hunk({
  header,
  lines,
  mode,
  lang = null,
}: {
  header: string | null;
  lines: DiffLine[];
  mode: DiffMode;
  lang?: string | null;
}) {
  // The hunk's leading line is the @@ header itself (groupIntoHunks keeps it
  // in `lines`); render the body lines after it. Skip header/hunk-kind lines
  // in the row grid since the .hunk-head shows the @@ context.
  const body = lines.filter((l) => l.kind !== "hunk" && l.kind !== "header");
  return (
    <div>
      {header ? <div className="hunk-head">{header}</div> : null}
      {mode === "split" ? <SplitRows lines={body} lang={lang} /> : <UnifiedRows lines={body} lang={lang} />}
    </div>
  );
}

function UnifiedRows({ lines, lang }: { lines: DiffLine[]; lang: string | null }) {
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
              <span className="dl-x">
                <CodeInner text={l.text} lang={lang} />
              </span>
            </div>
          );
        }
        if (l.kind === "deletion") {
          oldNo++;
          return (
            <div className="dl del" key={i}>
              <span className="dl-gut">{oldNo}</span>
              <span className="dl-x">
                <CodeInner text={l.text} lang={lang} />
              </span>
            </div>
          );
        }
        oldNo++;
        newNo++;
        return (
          <div className="dl" key={i}>
            <span className="dl-gut">{newNo}</span>
            <span className="dl-x">
              <CodeInner text={l.text} lang={lang} />
            </span>
          </div>
        );
      })}
    </>
  );
}

function SplitRows({ lines, lang }: { lines: DiffLine[]; lang: string | null }) {
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
            {row.left ? <CodeInner text={row.left.text} lang={lang} /> : ""}
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
            {row.right ? <CodeInner text={row.right.text} lang={lang} /> : ""}
          </span>
        </div>
      ))}
    </>
  );
}
