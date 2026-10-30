/**
 * 변경 줄 메모 (2026-10-30, Orca 「Annotate AI Diffs」 벤치마킹) — 창 하나에 하나, 모듈 범위.
 *
 * 변경 화면의 줄마다 메모를 달고, 다 달면 **한 번에 묶어** Claude 세션에 보낸다. 하나씩 보내면
 * 에이전트가 오락가락한다 — 묶어야 한 번에 고친다(Orca 문서의 이유 그대로). 한 줄에 메모 하나,
 * 보내면 비운다(고친 뒤에는 줄 번호가 달라져 남은 메모가 엉뚱한 줄을 가리킨다).
 */
import { useSyncExternalStore } from "react";

import type { I18nKey, TVars } from "@/i18n";

export interface NoteAnchor {
  /** 프로젝트 루트 기준 경로. */
  file: string;
  /** 새 파일의 줄(추가 · 문맥)인지 지운 줄인지. */
  side: "new" | "old";
  line: number;
  /** 그 줄의 코드 — 보낼 때 한 줄 맥락으로 붙인다. */
  code: string;
}

export interface DiffNote extends NoteAnchor {
  text: string;
}

export interface NotesState {
  notes: DiffNote[];
  editing: NoteAnchor | null;
}

const EMPTY: NotesState = { notes: [], editing: null };
const byProject = new Map<number, NotesState>();
const subs = new Set<() => void>();

export const anchorKey = (a: Pick<NoteAnchor, "file" | "side" | "line">) => `${a.side}:${a.line}:${a.file}`;

function update(projectId: number, fn: (s: NotesState) => NotesState) {
  byProject.set(projectId, fn(byProject.get(projectId) ?? EMPTY));
  for (const f of subs) f();
}

export function startNote(projectId: number, anchor: NoteAnchor): void {
  update(projectId, (s) => ({ ...s, editing: anchor }));
}

export function cancelNote(projectId: number): void {
  update(projectId, (s) => ({ ...s, editing: null }));
}

/** 편집 중인 줄의 메모를 남긴다(같은 줄이면 바꾼다). 빈 글이면 그 줄의 메모를 지운다. */
export function saveNote(projectId: number, text: string): void {
  update(projectId, (s) => {
    if (!s.editing) return s;
    const key = anchorKey(s.editing);
    const rest = s.notes.filter((n) => anchorKey(n) !== key);
    const body = text.trim();
    return { editing: null, notes: body ? [...rest, { ...s.editing, text: body }] : rest };
  });
}

export function removeNote(projectId: number, anchor: Pick<NoteAnchor, "file" | "side" | "line">): void {
  const key = anchorKey(anchor);
  update(projectId, (s) => ({ ...s, notes: s.notes.filter((n) => anchorKey(n) !== key) }));
}

export function clearNotes(projectId: number): void {
  update(projectId, () => EMPTY);
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useDiffNotes(projectId: number | null): NotesState {
  return useSyncExternalStore(
    subscribe,
    () => (projectId == null ? EMPTY : byProject.get(projectId) ?? EMPTY),
    () => EMPTY,
  );
}

type Tr = (key: I18nKey, vars?: TVars) => string;

/** 코드 한 줄 맥락 — 길면 자른다. */
function snippet(code: string): string {
  const one = code.trim().replace(/\s+/g, " ");
  return one.length > 80 ? `${one.slice(0, 79)}…` : one;
}

/**
 * 보낼 글 — 파일별로 묶고 줄 순서로. 메모가 여러 줄이면 들여 쓴다.
 *
 *   src/foo.ts
 *   - 42행 `const x = 1;` — 이름이 모호해요
 */
export function composeNotes(notes: readonly DiffNote[], tr: Tr): string {
  const files = [...new Set(notes.map((n) => n.file))].sort();
  return files
    .map((file) => {
      const lines = notes
        .filter((n) => n.file === file)
        .sort((a, b) => a.line - b.line || a.side.localeCompare(b.side))
        .map((n) => {
          const where = tr(n.side === "old" ? "diff.notes.lineOld" : "diff.notes.lineNew", { line: n.line });
          const code = snippet(n.code);
          const head = code ? `- ${where} \`${code}\`` : `- ${where}`;
          return `${head} — ${n.text.replace(/\n/g, "\n  ")}`;
        });
      return [file, ...lines].join("\n");
    })
    .join("\n\n");
}
