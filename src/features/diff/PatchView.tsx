import { Fragment, useMemo } from "react";

import { useHljs, type Hljs } from "@/lib/hljs";
import { NoteAddButton, NoteSlot } from "./DiffNotes";
import { anchorKey, useDiffNotes, type DiffNote, type NoteAnchor } from "./diffNoteStore";
import {
  classifyDiffLines,
  groupIntoHunks,
  pairDiffLines,
  parseHunkHeader,
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

/** Split a diff line into its marker (+/-/space) and syntax-highlighted code.
 *  `hljs` 가 아직 null 이면(지연 로드 중) 평문으로 escape 해 그린다 — 색은
 *  로드가 끝난 뒤 리렌더에서 입혀진다. */
function renderLine(
  text: string,
  lang: string | null,
  hljs: Hljs | null,
): { marker: string; html: string } {
  const first = text.charAt(0);
  const hasMarker = first === "+" || first === "-" || first === " ";
  const marker = hasMarker ? first : "";
  const code = hasMarker ? text.slice(1) : text;
  let html: string;
  if (code && lang && hljs?.getLanguage(lang)) {
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
function CodeInner({
  text,
  lang,
  hljs,
}: {
  text: string;
  lang: string | null;
  hljs: Hljs | null;
}) {
  const { marker, html } = renderLine(text, lang, hljs);
  return (
    <>
      <span className="dl-mark">{marker || " "}</span>
      <span className="dl-code" dangerouslySetInnerHTML={{ __html: html || " " }} />
    </>
  );
}

/** 줄 메모를 켠 diff — 변경 화면만 준다(일지 상세는 읽기만). */
export interface PatchNotes {
  projectId: number;
  /** 프로젝트 루트 기준 경로 — 메모의 자리. */
  file: string;
}

/** 줄들이 받는 메모 맥락 — `PatchView` 가 한 번 읽어 내려 준다(줄마다 구독하지 않는다). */
interface NoteCtx {
  projectId: number;
  file: string;
  byKey: Map<string, DiffNote>;
  editingKey: string | null;
}

/** 그 줄의 「+」 와 아래 칸. 메모를 끈 diff 면 둘 다 없다. */
function noteBits(ctx: NoteCtx | null, side: NoteAnchor["side"], line: number, text: string) {
  if (!ctx) return { add: null, slot: null };
  const first = text.charAt(0);
  const code = first === "+" || first === "-" || first === " " ? text.slice(1) : text;
  const anchor: NoteAnchor = { file: ctx.file, side, line, code };
  const key = anchorKey(anchor);
  const note = ctx.byKey.get(key);
  return {
    add: <NoteAddButton projectId={ctx.projectId} anchor={anchor} has={note != null} />,
    slot: <NoteSlot projectId={ctx.projectId} anchor={anchor} note={note} editing={ctx.editingKey === key} />,
  };
}

/** Render a raw unified-diff `patch` as hunks (.dl rows). `mode` toggles the
 *  single-gutter unified view vs the side-by-side split. `lang` (highlight.js
 *  id) enables syntax coloring. `notes` turns on line notes (변경 화면). */
export function PatchView({
  patch,
  mode,
  lang = null,
  notes = null,
}: {
  patch: string;
  mode: DiffMode;
  lang?: string | null;
  notes?: PatchNotes | null;
}) {
  const hunks = groupIntoHunks(classifyDiffLines(patch));
  // 하이라이터는 여기 한 번만 구독한다. 줄마다 useHljs() 를 부르면 diff 한 장에
  // 훅 수천 개가 붙고 로드 완료 시 setState 가 그만큼 터진다. 메모도 같은 이유로 한 번.
  const hljs = useHljs();
  const state = useDiffNotes(notes?.projectId ?? null);
  const ctx = useMemo<NoteCtx | null>(() => {
    if (!notes) return null;
    const mine = state.notes.filter((n) => n.file === notes.file);
    const editing = state.editing?.file === notes.file ? anchorKey(state.editing) : null;
    return { ...notes, byKey: new Map(mine.map((n) => [anchorKey(n), n])), editingKey: editing };
  }, [notes, state]);
  // Long lines wrap to the pane width (`.dl-x`/`.dl-code` are `pre-wrap` +
  // `overflow-wrap: anywhere`) so nothing is clipped off-screen — macOS overlay
  // scrollbars hid the horizontal scroll, so wrapping reads better than scroll.
  return (
    <div className={"diff-content" + (ctx ? " has-notes" : "")}>
      {hunks.map((h, hi) => (
        <Hunk
          key={hi}
          header={h.header?.text ?? null}
          lines={h.lines}
          mode={mode}
          lang={lang}
          hljs={hljs}
          notes={ctx}
        />
      ))}
    </div>
  );
}

export function Hunk({
  header,
  lines,
  mode,
  lang = null,
  hljs = null,
  notes = null,
}: {
  header: string | null;
  lines: DiffLine[];
  mode: DiffMode;
  lang?: string | null;
  hljs?: Hljs | null;
  notes?: NoteCtx | null;
}) {
  // The hunk's leading line is the @@ header itself (groupIntoHunks keeps it
  // in `lines`); render the body lines after it. Skip header/hunk-kind lines
  // in the row grid since the .hunk-head shows the @@ context.
  const body = lines.filter((l) => l.kind !== "hunk" && l.kind !== "header");
  // Real file line numbers from the @@ header; preamble/new-file patches
  // (no header) fall back to 1-based counting, which is correct for them.
  const start = header ? parseHunkHeader(header) : null;
  const startOld = start?.oldStart ?? 1;
  const startNew = start?.newStart ?? 1;
  const rows = { lines: body, lang, hljs, startOld, startNew, notes };
  return (
    <div>
      {header ? <div className="hunk-head">{header}</div> : null}
      {mode === "split" ? <SplitRows {...rows} /> : <UnifiedRows {...rows} />}
    </div>
  );
}

interface RowsProps {
  lines: DiffLine[];
  lang: string | null;
  hljs: Hljs | null;
  startOld: number;
  startNew: number;
  notes: NoteCtx | null;
}

function UnifiedRows({ lines, lang, hljs, startOld, startNew, notes }: RowsProps) {
  // Single gutter: additions show the new-side number, deletions the old-side,
  // context advances both and shows the new number. Offsets come from the @@
  // hunk header so the numbers match the actual file.
  let oldNo = startOld - 1;
  let newNo = startNew - 1;
  return (
    <>
      {lines.map((l, i) => {
        let cls = "dl";
        let no: number;
        if (l.kind === "addition") {
          cls += " add";
          no = ++newNo;
        } else if (l.kind === "deletion") {
          cls += " del";
          no = ++oldNo;
        } else {
          oldNo++;
          no = ++newNo;
        }
        const bits = noteBits(notes, l.kind === "deletion" ? "old" : "new", no, l.text);
        return (
          <Fragment key={i}>
            <div className={cls}>
              <span className="dl-gut">
                {bits.add}
                {no}
              </span>
              <span className="dl-x">
                <CodeInner text={l.text} lang={lang} hljs={hljs} />
              </span>
            </div>
            {bits.slot}
          </Fragment>
        );
      })}
    </>
  );
}

function SplitRows({ lines, lang, hljs, startOld, startNew, notes }: RowsProps) {
  const rows = pairDiffLines(lines);
  // Per-side line numbers: the left gutter counts the old file (context +
  // deletions), the right counts the new (context + additions). Context rows
  // advance both. Same @@ offsets as the unified view.
  let oldNo = startOld - 1;
  let newNo = startNew - 1;
  return (
    <>
      {rows.map((row, i) => {
        let leftGut = "";
        let rightGut = "";
        if (row.left) {
          oldNo++;
          leftGut = String(oldNo);
        }
        if (row.right) {
          // A context/header row is the SAME DiffLine object on both sides —
          // it advances the new counter too; paired del/add rows each advance
          // only their own side.
          newNo++;
          rightGut = String(newNo);
        }
        // 메모는 새 쪽 줄에, 새 쪽이 비었으면(지운 줄만) 옛 쪽에.
        const bits = row.right
          ? noteBits(notes, "new", newNo, row.right.text)
          : row.left
            ? noteBits(notes, "old", oldNo, row.left.text)
            : { add: null, slot: null };
        return (
          <Fragment key={i}>
            <div className="dl split">
              <span className="dl-gut">
                {row.right ? null : bits.add}
                {leftGut}
              </span>
              <span
                className={"dl-x" + (row.left ? "" : " empty")}
                style={
                  row.left?.kind === "deletion"
                    ? { background: "var(--diff-del-bg)", color: "var(--diff-del-text)" }
                    : undefined
                }
              >
                {row.left ? <CodeInner text={row.left.text} lang={lang} hljs={hljs} /> : ""}
              </span>
              <span className="dl-gut">
                {row.right ? bits.add : null}
                {rightGut}
              </span>
              <span
                className={"dl-x" + (row.right ? "" : " empty")}
                style={
                  row.right?.kind === "addition"
                    ? { background: "var(--diff-add-bg)", color: "var(--diff-add-text)" }
                    : undefined
                }
              >
                {row.right ? <CodeInner text={row.right.text} lang={lang} hljs={hljs} /> : ""}
              </span>
            </div>
            {bits.slot}
          </Fragment>
        );
      })}
    </>
  );
}
