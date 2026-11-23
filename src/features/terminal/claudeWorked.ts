/**
 * 이 창의 터미널에서 Claude 가 처음 일한 때 — 프로젝트마다 (love-round #no-journal-diagnosis, 11-23).
 *
 * Claude Code 는 OSC 7501 로 `working` 을 알린다(플러그인과 상관없이 Claude 자신이). 그런데 플러그인 훅은
 * 세션을 열 때(SessionStart) · 프롬프트를 받는 순간(UserPromptSubmit) 인박스에 한 줄을 쓴다 — 그러니 Claude 가
 * 처음 일한 때보다 한참 전에 멈춘 인박스는 플러그인이 꺼졌거나 다른 프로젝트에만 켜졌다는 증거다. 마지막 때가
 * 아니라 처음 때를 견준다: 권한을 묻다가(Notification) 한참 뒤 다시 일하는 경우를 침묵으로 오판하지 않게.
 * 설정의 「일지가 안 와요」 진단이 이 둘을 견준다.
 * 창 안 기억이다(앱을 다시 켜면 비어 있다) — 본 적 없는 것으로 경고하지 않는다.
 */
import type { TermInfo } from "@/api/terminal";
import { createStore } from "@/lib/createStore";
import { isClaudeApp } from "./status";

const workedAt = createStore<ReadonlyMap<number, number>>(new Map());

/** 상태가 `working` 으로 바뀐 세션 — Claude 면 그 프로젝트의 첫 시각을 남긴다(이미 있으면 그대로). */
export function noteWorked(info: TermInfo, at: number = Date.now()): void {
  if (info.status?.state !== "working" || !isClaudeApp(info)) return;
  workedAt.update((prev) => (prev.has(info.project_id) ? prev : new Map(prev).set(info.project_id, at)));
}

export function useClaudeWorkedAt(projectId: number | null): number | null {
  const all = workedAt.useValue();
  return projectId == null ? null : (all.get(projectId) ?? null);
}

/** 시험용 — 모듈 범위 기억을 비운다. */
export function __resetClaudeWorkedForTests(): void {
  workedAt.update(() => new Map());
}
