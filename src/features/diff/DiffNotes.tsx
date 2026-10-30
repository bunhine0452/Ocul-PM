/**
 * 변경 줄 메모의 화면 조각 — 거터의 「+」 와 줄 아래 칸(메모 카드 · 편집기). 상태는 `diffNoteStore.ts`.
 *
 * 줄마다 구독하지 않는다 — diff 한 장이 수천 줄이다. `PatchView` 가 한 번 읽어 줄에 내려 준다.
 */
import { useState, type KeyboardEvent } from "react";

import { Plus, X } from "@/components/Icons";
import { useT } from "@/i18n";
import { kbd } from "@/lib/kbd";
import { cancelNote, removeNote, saveNote, startNote, type DiffNote, type NoteAnchor } from "./diffNoteStore";

/** 거터의 「+」 — 줄에 올리면 보인다. 이미 메모가 있으면 늘 보인다(점). */
export function NoteAddButton({ projectId, anchor, has }: { projectId: number; anchor: NoteAnchor; has: boolean }) {
  const { t } = useT();
  return (
    <button
      type="button"
      className={"dl-note-add" + (has ? " has" : "")}
      aria-label={t("diff.notes.add", { line: anchor.line })}
      title={t("diff.notes.add", { line: anchor.line })}
      onClick={(e) => {
        e.stopPropagation();
        startNote(projectId, anchor);
      }}
    >
      {has ? null : <Plus size={11} aria-hidden="true" />}
    </button>
  );
}

/** 줄 아래 칸 — 그 줄의 메모 카드, 또는 편집 중이면 편집기. 둘 다 없으면 아무것도 그리지 않는다. */
export function NoteSlot({
  projectId,
  anchor,
  note,
  editing,
}: {
  projectId: number;
  anchor: NoteAnchor;
  note: DiffNote | undefined;
  editing: boolean;
}) {
  const { t } = useT();
  if (editing) return <NoteEditor projectId={projectId} initial={note?.text ?? ""} />;
  if (!note) return null;
  return (
    <div className={"dl-note" + (note.sent ? (note.fixed ? " is-fixed" : " is-sent") : "")}>
      {note.sent ? (
        <span
          className={"chip sm " + (note.fixed ? "ok" : "warn")}
          title={note.side === "old" ? t("diff.notes.oldSideTitle") : undefined}
        >
          {note.fixed ? t("diff.notes.fixed") : note.side === "old" ? t("diff.notes.sent") : t("diff.notes.open")}
        </span>
      ) : null}
      <button
        type="button"
        className="dl-note-text"
        onClick={() => startNote(projectId, anchor)}
        title={t("diff.notes.edit")}
      >
        {note.text}
      </button>
      <button
        type="button"
        className="iconbtn sm"
        aria-label={t("diff.notes.remove")}
        title={t("diff.notes.remove")}
        onClick={() => removeNote(projectId, anchor)}
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  );
}

function NoteEditor({ projectId, initial }: { projectId: number; initial: string }) {
  const { t } = useT();
  const [text, setText] = useState(initial);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelNote(projectId);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveNote(projectId, text);
    }
  };
  return (
    <div className="dl-note is-editing">
      <textarea
        className="dl-note-input"
        autoFocus
        rows={2}
        value={text}
        placeholder={t("diff.notes.placeholder")}
        aria-label={t("diff.notes.placeholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="dl-note-actions">
        <button type="button" className="btn ghost sm" onClick={() => cancelNote(projectId)}>
          {t("diff.notes.cancel")}
        </button>
        <button type="button" className="btn primary sm" onClick={() => saveNote(projectId, text)}>
          {t("diff.notes.save")}
          <kbd className="kbd">{kbd("⌘↩")}</kbd>
        </button>
      </div>
    </div>
  );
}
