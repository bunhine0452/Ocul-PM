/**
 * 변경 줄 메모 (2026-10-30, Orca 「Annotate AI Diffs」 벤치마킹) — 창 하나에 하나, 모듈 범위.
 *
 * 변경 화면의 줄마다 메모를 달고, 다 달면 **한 번에 묶어** Claude 세션에 보낸다. 하나씩 보내면
 * 에이전트가 오락가락한다 — 묶어야 한 번에 고친다(Orca 문서의 이유 그대로). 한 줄에 메모 하나.
 *
 * 보낸 메모는 남는다(10-30 #notes-track, Orca 를 넘어서): 파일의 지금 내용과 견줘 그 줄의 코드가
 * 사라졌으면 「고쳐짐」, 그대로면 「아직」 — Orca 는 사람이 Resolve 를 누른다. 줄이 옮겨 갔으면 메모도
 * 따라간다. 상태는 WorkspaceContext 가 영속한다(`diffNotes`) — 여기는 창 안의 런타임 사본이다.
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
  /** Claude 에게 보냈다 — 이제 고쳐졌는지를 본다. */
  sent?: boolean;
  /** 보낸 뒤 그 줄의 코드가 파일에서 사라졌다. 지운 줄(old)의 메모는 판정하지 않는다. */
  fixed?: boolean;
  /** 가릴 수 없다 — 흔한 줄(`}` · `</div>` · 빈 줄)이 제자리를 떠났다. 「보냄」 으로 둔다. */
  unsure?: boolean;
}

/** 줄을 알아볼 만큼 글자가 있는가 — 글자 · 숫자 6개부터. `}` · `</div>` · `);` 는 파일에 여럿이라 따라가면 엉뚱한 줄로 간다. */
export function isTelling(code: string): boolean {
  return (code.match(/[\p{L}\p{N}]/gu) ?? []).length >= 6;
}

/** 판정할 수 있는 메모인가 — 보낸, 새 쪽 줄의, 아직 「가릴 수 없음」 이 아닌 것. */
export function isJudged(n: DiffNote): boolean {
  return !!n.sent && n.side === "new" && !n.unsure;
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

/** 보낼 것(아직 안 보낸 메모)을 보냄으로 — 「Claude 에게 보내기」 가 성공한 뒤. */
export function markSent(projectId: number): void {
  update(projectId, (s) => ({ ...s, notes: s.notes.map((n) => (n.sent ? n : { ...n, sent: true, fixed: false })) }));
}

const hydrated = new Set<number>();
/** 영속된 메모를 한 번 싣는다(창이 열린 뒤 처음). */
export function hydrateNotes(projectId: number, notes: readonly DiffNote[]): void {
  if (hydrated.has(projectId)) return;
  hydrated.add(projectId);
  if (notes.length > 0) update(projectId, (s) => ({ ...s, notes: [...notes] }));
}

/**
 * 보낸 메모의 판정 — 파일의 지금 내용(`null` = 읽지 못함 · 지워짐)과 견준다. 순수 함수.
 * 그 줄에 같은 코드가 있으면 아직. 제자리를 떠났을 때, 알아볼 만한 줄이면 가장 가까운 같은 줄로 따라가고
 * 아직 · 어디에도 없으면 고쳐짐. 흔한 줄(`}` · `</div>` · 빈 줄)은 따라가지 않고 「가릴 수 없음」 —
 * 따라가던 때는 지워진 `</div>` 의 메모가 다른 `</div>` 로 옮겨 「아직」 에 남았다(레드팀 10-31).
 */
export function resolveNotes(notes: readonly DiffNote[], files: ReadonlyMap<string, string | null>): DiffNote[] {
  return notes.map((n) => {
    if (!n.sent || n.side !== "new" || !files.has(n.file)) return n;
    const text = files.get(n.file);
    if (text == null) return n.fixed ? n : { ...n, fixed: true };
    const want = n.code.trim();
    const lines = text.split("\n");
    if (want && lines[n.line - 1]?.trim() === want) return n.fixed || n.unsure ? { ...n, fixed: false, unsure: false } : n;
    if (!isTelling(want)) return n.unsure ? n : { ...n, fixed: false, unsure: true };
    let best = -1;
    lines.forEach((l, i) => {
      if (l.trim() === want && (best < 0 || Math.abs(i + 1 - n.line) < Math.abs(best + 1 - n.line))) best = i;
    });
    if (best >= 0) return { ...n, line: best + 1, fixed: false, unsure: false };
    return n.fixed && !n.unsure ? n : { ...n, fixed: true, unsure: false };
  });
}

/** 판정을 저장소에 — 바뀐 것이 있을 때만(구독자를 헛되이 깨우지 않게). */
export function applyResolution(projectId: number, files: ReadonlyMap<string, string | null>): void {
  const cur = byProject.get(projectId) ?? EMPTY;
  const next = resolveNotes(cur.notes, files);
  if (next.some((n, i) => n !== cur.notes[i])) update(projectId, (s) => ({ ...s, notes: next }));
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
