/**
 * `claudeSurface` — Claude Code 표면(훅 신호·기다림·질문·설치 상태) 커맨드의
 * 단일 래퍼.
 *
 * 새 파일들이 `bindings.ts` 를 직접 부르지 않도록 여기로 모았다 (완성도 라운드
 * Phase 4 의 `call` 규약 — `lint:bindings` 가 게이트). 봉투(`{status}`)를 풀어
 * 값을 돌려주고, 실패는 `ApiError` 하나로 접는다: 화면은 `catch (e)` 하나에
 * `tError(toAppError(e))`.
 *
 * 스킬·규칙·승격 후보·발동 원장·스택 감지 래퍼는 4.0 에서 스킬·규칙 화면과 함께 걷었다.
 */

import { commands, events } from "@/lib/bindings";
import { call, subscribe, type Envelope } from "@/api/invoke";
import type {
  ClaudeQuestion,
  ClaudeWaiting,
  JournalMissingSignal,
  ClaudePluginStatus,
} from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

/**
 * SessionEnd 훅이 남긴 "일지 없이 끝난 세션" 신호 ({#card-unhide} ·
 * {#retro-standing-line}). 무엇을 해소로 볼지의 **판정은 백엔드 소유**라
 * (mtime 근사 → 세션 귀속으로 교체 예정) 화면은 행 수만 읽는다.
 */
export const hooksApi = {
  journalMissing: (projectId: number, days: number) =>
    unwrap<JournalMissingSignal[]>(
      "journal_missing_signals",
      commands.journalMissingSignals(projectId, days),
    ),

  /**
   * 바깥(앱 밖) 터미널의 Claude 가 사람을 기다린다 — 플러그인 Notification 훅이 인박스에 남긴 것을
   * 워처가 세션별로 든다 (#notify-hook). 봉투 없이 배열을 준다 — 배열이 아니면 빈 목록으로 접는다.
   */
  waiting: async (projectId: number): Promise<ClaudeWaiting[]> => {
    const list: unknown = await commands.claudeWaiting(projectId);
    return Array.isArray(list) ? (list as ClaudeWaiting[]) : [];
  },
  /** 「알았어요」 — 그 기다림을 지운다 (바깥 터미널이라 앱 안에서 갈 곳이 없다). */
  dismissWaiting: (projectId: number, sessionId: string): Promise<void> => commands.claudeWaitingDismiss(projectId, sessionId),
  /** 어느 프로젝트의 기다림이 바뀌었다. */
  onWaitingChanged: (cb: (projectId: number) => void) => subscribe(events.claudeWaitingChanged, (p) => cb(p.project_id)),

  /** Claude 가 앱에 물은 질문들 (MCP ask_user, #ask-user) — 오래된 것부터. */
  questions: (projectId: number) =>
    unwrap<ClaudeQuestion[]>("claude_questions", commands.claudeQuestions(projectId)),
  /** 답한다 — 기다리던 ask_user 가 그 답을 Claude 에게 돌려준다. */
  answerQuestion: (projectId: number, id: string, answer: string) =>
    unwrap<null>("claude_question_answer", commands.claudeQuestionAnswer(projectId, id, answer)),
  /** 어느 프로젝트의 질문이 바뀌었다(물음 · 답함 · 거둠). */
  onQuestionsChanged: (cb: (projectId: number) => void) => subscribe(events.claudeQuestionsChanged, (p) => cb(p.project_id)),
};

/**
 * Claude Code 플러그인의 설치 상태 (v3-surface {#plugin-onboarding}). 설계상 **놓칠 수는
 * 있어도 오탐은 없다** — 그래서 거짓을 "미설치" 가 아니라 "못 찾음" 으로 읽어야 한다
 * (commands/mcp.rs).
 *
 * `claude_plugin_status` 는 2026-10-27 부터 봉투를 쓴다(프로젝트 루트를 DB 에서 읽어
 * 판 드리프트를 판정하므로). 실패는 미설치가 아니라 「모름」이다.
 */
export const claudeInstallApi = {
  /**
   * `projectId` 를 주면 **그 프로젝트에 적용되는** 플러그인 판(프로젝트 스코프 →
   * 사용자 스코프)과 앱이 든 판의 차이(`behind`)까지 온다. 실패는 「모름」(null).
   */
  pluginStatus: (projectId: number | null = null): Promise<ClaudePluginStatus | null> =>
    Promise.resolve()
      .then(() => unwrap<ClaudePluginStatus>("claude_plugin_status", commands.claudePluginStatus(projectId)))
      .catch(() => null),

};
