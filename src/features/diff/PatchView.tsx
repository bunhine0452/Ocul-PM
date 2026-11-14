import { Fragment, memo, useMemo, type CSSProperties, type MouseEvent } from "react";

import type { DiffMode } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";
import { formatBytes } from "@/lib/format";
import { useHljs } from "@/lib/hljs";
import { isModKey } from "@/lib/kbd";
import { NoteAddButton, NoteSlot } from "./DiffNotes";
import { anchorKey, useDiffNotes, type DiffNote, type NoteAnchor } from "./diffNoteStore";
import { isNoNewlineMarker, pairDiffLines, type PatchCut } from "./diffParse";
import { buildPatchModel, type ModelHunk, type ModelLine } from "./patchModel";

// Final UI Update (ui_v2) — shared unified-diff renderer. 변경 화면 · 작업 일지 상세 · 레인 비교가
// 같은 패치를 같은 모양으로 그린다. 순수 파서는 `diffParse`, 줄 모양(번호 · 강조 · 바뀐 단어)은
// `patchModel` 이 갖고 — 이 파일은 마크업만.
//
// 줄 한 칸은 표식(+/−) 칸과 코드 칸 두 칸의 격자다(11-15 #diff-exact): 꺾인 긴 줄이 표식 밑이 아니라
// 코드 칸에서, 그 줄의 들여쓰기만큼 들어가 다시 시작한다. 강조 색은 screens.css 의 .hljs-* 규칙.

/** 줄 메모를 켠 diff — 변경 화면만 준다(일지 상세는 읽기만). */
export interface PatchNotes {
  projectId: number;
  /** 프로젝트 루트 기준 경로 — 메모의 자리. */
  file: string;
}

/** 줄들이 받는 메모 맥락 — `PatchView` 가 한 번 읽어 줄마다 그 줄의 것만 내려 준다. */
interface NoteCtx {
  projectId: number;
  file: string;
  byKey: Map<string, DiffNote>;
  editingKey: string | null;
}

interface RowNote {
  projectId: number;
  anchor: NoteAnchor;
  note: DiffNote | undefined;
  editing: boolean;
}

function rowNote(ctx: NoteCtx | null, side: NoteAnchor["side"], line: number | null, code: string): RowNote | null {
  if (!ctx || line == null) return null;
  const anchor: NoteAnchor = { file: ctx.file, side, line, code };
  const key = anchorKey(anchor);
  return { projectId: ctx.projectId, anchor, note: ctx.byKey.get(key), editing: ctx.editingKey === key };
}

/** 새 쪽 번호의 ⌘클릭 — 편집기에서 그 줄을 연다. 메모 단추는 자기 클릭을 먼저 먹는다. */
type OpenLine = ((line: number) => void) | undefined;

function gutterClick(open: OpenLine, line: number | null) {
  if (!open || line == null) return undefined;
  return (e: MouseEvent) => {
    if (!isModKey(e)) return;
    e.preventDefault();
    open(line);
  };
}

/** Render a raw unified-diff `patch` as hunks (.dl rows). `mode` toggles the
 *  single-gutter unified view vs the side-by-side split. `lang` (highlight.js
 *  id) enables syntax coloring. `notes` turns on line notes (변경 화면). */
export const PatchView = memo(function PatchView({
  patch,
  mode,
  lang = null,
  notes = null,
  cut = null,
  onOpenLine,
  onOpenEditor,
}: {
  patch: string;
  mode: DiffMode;
  lang?: string | null;
  notes?: PatchNotes | null;
  /** 잘린 패치 — 백엔드가 숫자로 준 것(변경 화면). 없으면 옛 표지 문장을 읽는다(일지 사이드카). */
  cut?: PatchCut | null;
  /** 새 쪽 줄 번호 ⌘클릭 — 변경 화면만 준다. */
  onOpenLine?: (line: number) => void;
  /** 잘렸다는 영수증 줄의 「편집기에서 열기」. */
  onOpenEditor?: () => void;
}) {
  // 하이라이터 · 메모는 여기 한 번만 구독한다 — 줄마다 훅을 붙이면 diff 한 장에 수천 개가 된다.
  const hljs = useHljs();
  const model = useMemo(() => buildPatchModel(patch, lang, hljs), [patch, lang, hljs]);
  const state = useDiffNotes(notes?.projectId ?? null);
  const ctx = useMemo<NoteCtx | null>(() => {
    if (!notes) return null;
    const mine = state.notes.filter((n) => n.file === notes.file);
    const editing = state.editing?.file === notes.file ? anchorKey(state.editing) : null;
    return { ...notes, byKey: new Map(mine.map((n) => [anchorKey(n), n])), editingKey: editing };
  }, [notes, state]);
  const shownCut = cut ?? model.cut;
  return (
    <div className={"diff-content" + (ctx ? " has-notes" : "")}>
      {model.hunks.map((h, hi) => (
        <Hunk key={hi} hunk={h} mode={mode} notes={ctx} onOpenLine={onOpenLine} />
      ))}
      {shownCut ? <CutLine cut={shownCut} onOpenEditor={onOpenEditor} /> : null}
    </div>
  );
});

function Hunk({ hunk, mode, notes, onOpenLine }: { hunk: ModelHunk; mode: DiffMode; notes: NoteCtx | null; onOpenLine: OpenLine }) {
  const { t } = useT();
  const metaLabel = (l: ModelLine) => (isNoNewlineMarker(l.code) ? t("diff.noNewline") : l.code);
  const openTitle = onOpenLine ? t("diff.openLineTitle") : undefined;
  return (
    <div className="dl-hunk">
      {hunk.header ? <div className="hunk-head">{hunk.header}</div> : null}
      {mode === "split"
        ? pairDiffLines(hunk.lines).map((row, i) => (
            <SplitRow key={i} row={row} notes={notes} onOpenLine={onOpenLine} openTitle={openTitle} metaLabel={metaLabel} />
          ))
        : hunk.lines.map((l, i) =>
            l.kind === "meta" ? (
              <MetaRow key={i} label={metaLabel(l)} split={false} />
            ) : (
              <UnifiedRow
                key={i}
                line={l}
                note={rowNote(notes, l.kind === "deletion" ? "old" : "new", l.kind === "deletion" ? l.oldNo : l.newNo, l.code)}
                onOpenLine={l.kind === "deletion" ? undefined : onOpenLine}
                openTitle={l.kind === "deletion" ? undefined : openTitle}
              />
            ),
          )}
    </div>
  );
}

const MARK = { addition: "+", deletion: "-", context: " ", meta: " " } as const;

/** 표식 칸 + 코드 칸. 꺾인 줄은 `--ind` 칸만큼 들어가 매달린다. */
function Code({ line, html }: { line: ModelLine; html: string }) {
  const style = line.indent > 0 ? ({ "--ind": `${line.indent}ch` } as CSSProperties) : undefined;
  return (
    <>
      <span className="dl-mark" aria-hidden="true">
        {MARK[line.kind]}
      </span>
      <span className="dl-code" style={style} dangerouslySetInnerHTML={{ __html: html || " " }} />
    </>
  );
}

function MetaRow({ label, split }: { label: string; split: boolean }) {
  return (
    <div className={"dl meta" + (split ? " split" : "")}>
      <span className="dl-gut" />
      <span className="dl-x">
        <span className="dl-mark" />
        <span className="dl-code">{label}</span>
      </span>
      {split ? (
        <>
          <span className="dl-gut" />
          <span className="dl-x" />
        </>
      ) : null}
    </div>
  );
}

function NoteBits({ note }: { note: RowNote | null }) {
  return note ? <NoteAddButton projectId={note.projectId} anchor={note.anchor} has={note.note != null} /> : null;
}

function NoteRow({ note }: { note: RowNote | null }) {
  return note ? <NoteSlot projectId={note.projectId} anchor={note.anchor} note={note.note} editing={note.editing} /> : null;
}

const UnifiedRow = memo(function UnifiedRow({ line, note, onOpenLine, openTitle }: RowProps) {
  const kind = line.kind === "addition" ? " add" : line.kind === "deletion" ? " del" : "";
  const no = line.kind === "deletion" ? line.oldNo : line.newNo;
  return (
    <Fragment>
      <div className={"dl" + kind}>
        <span className={"dl-gut" + kind} onClick={gutterClick(onOpenLine, no)} title={openTitle}>
          <NoteBits note={note} />
          {no}
        </span>
        <span className="dl-x">
          <Code line={line} html={line.html} />
        </span>
      </div>
      <NoteRow note={note} />
    </Fragment>
  );
}, sameRow);

type RowProps = { line: ModelLine; note: RowNote | null; onOpenLine: OpenLine; openTitle: string | undefined };

/** 메모 맥락은 줄마다 새 객체라 얕은 비교로는 늘 다르다 — 그 줄의 메모 · 편집 여부만 본다. */
function sameRow(a: RowProps, b: RowProps): boolean {
  if (a.line !== b.line || a.onOpenLine !== b.onOpenLine || a.openTitle !== b.openTitle) return false;
  const an = a.note;
  const bn = b.note;
  if (!an || !bn) return an === bn;
  return an.note === bn.note && an.editing === bn.editing && an.anchor.file === bn.anchor.file && an.projectId === bn.projectId;
}

function SplitRow({
  row,
  notes,
  onOpenLine,
  openTitle,
  metaLabel,
}: {
  row: { left: ModelLine | null; right: ModelLine | null };
  notes: NoteCtx | null;
  onOpenLine: OpenLine;
  openTitle: string | undefined;
  metaLabel: (l: ModelLine) => string;
}) {
  const { left, right } = row;
  if (left && left === right && left.kind === "meta") return <MetaRow label={metaLabel(left)} split />;
  // 메모는 새 쪽 줄에, 새 쪽이 비었으면(지운 줄만) 옛 쪽에.
  const note = right
    ? rowNote(notes, "new", right.newNo, right.code)
    : left
      ? rowNote(notes, "old", left.oldNo, left.code)
      : null;
  const leftKind = left?.kind === "deletion" ? " del" : "";
  const rightKind = right?.kind === "addition" ? " add" : "";
  return (
    <Fragment>
      <div className="dl split">
        <span className={"dl-gut" + leftKind}>
          {right ? null : <NoteBits note={note} />}
          {left?.oldNo ?? ""}
        </span>
        <span className={"dl-x" + leftKind + (left ? "" : " empty")}>
          {left ? <Code line={left} html={left.kind === "context" ? left.oldHtml : left.html} /> : null}
        </span>
        <span className={"dl-gut" + rightKind} onClick={gutterClick(onOpenLine, right?.newNo ?? null)} title={right ? openTitle : undefined}>
          {right ? <NoteBits note={note} /> : null}
          {right?.newNo ?? ""}
        </span>
        <span className={"dl-x" + rightKind + (right ? "" : " empty")}>
          {right ? <Code line={right} html={right.html} /> : null}
        </span>
      </div>
      <NoteRow note={note} />
    </Fragment>
  );
}

/** 잘린 diff 의 영수증 줄 — 「64 KB / 212 KB 만 보여요 · 편집기에서 열기」 (숫자는 mono). */
function CutLine({ cut, onOpenEditor }: { cut: PatchCut; onOpenEditor?: () => void }) {
  const { t } = useT();
  return (
    <div className="diff-cut" role="note">
      <span className="mono">
        {formatBytes(cut.shown)} / {formatBytes(cut.total)}
      </span>
      <span>{t("diff.cutShown")}</span>
      {onOpenEditor ? (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" className="diff-cut-open" onClick={onOpenEditor}>
            {t("diff.openEditor")}
          </button>
        </>
      ) : null}
    </div>
  );
}
