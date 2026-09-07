/**
 * `acpApi` — 앱 안 ACP 대화(Claude Code · Codex)의 커맨드 래퍼.
 *
 * 화면 조각(`features/chat/conversation/*`)이 부르던 `bindings.ts` 를 전부
 * 여기로 모았다 (플랜 `v3-release` {#acp-api-wrapper}). 봉투를 푸는 자리가
 * 하나가 되면서 호출부의 `if (res.status === "error")` 는 `catch` 가 됐다 —
 * **어떤 실패가 화면에 닿고 어떤 실패가 조용한지는 그대로다.** 옮기며 바뀐 것은
 * 전송 실패(IPC reject)뿐이다: 예전에는 아무 데도 안 잡혀 unhandled rejection
 * 으로 샜고, 이제 봉투 오류와 같은 길로 접힌다.
 */

import { call, type Envelope } from "@/api/invoke";
import { commands, events } from "@/lib/bindings";
import type { Channel } from "@tauri-apps/api/core";
import type {
  AcpCommand,
  AcpConfigOption,
  AcpDiagnostics,
  AcpEvent,
  AcpImage,
  AcpObjection,
  AcpProvider,
  AcpRecordingStatus,
  AcpSession,
  AcpSessionChanged,
  AcpSessionSummary,
} from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

/**
 * 살아 있는 어댑터의 신원·능력 (죽었으면 `null`).
 *
 * `acp_status` 만 생성 파일에 이름 있는 타입이 없어 봉투에서 직접 꺼낸다 —
 * 여기서 손으로 베껴 두면 백엔드가 칸을 늘릴 때 조용히 어긋난다.
 */
export type AcpAdapterStatus = Extract<
  Awaited<ReturnType<typeof commands.acpStatus>>,
  { status: "ok" }
>["data"];

export const acpApi = {
  // ─── 어댑터 붙이기 ───

  /** 어댑터를 띄운다 (멱등 — 이미 떠 있으면 그대로 그 세션). */
  start: (projectId: number, provider: AcpProvider | null = null) =>
    unwrap<AcpSession>("acp_start", commands.acpStart(projectId, provider)),

  /** 어댑터 패키지를 깐다. Codex 는 플랫폼 바이너리까지 받으므로 화면이 먼저 묻는다. */
  installAdapter: (provider: AcpProvider | null = null) =>
    unwrap<AcpDiagnostics>("acp_install_adapter", commands.acpInstallAdapter(provider)),

  /** 어댑터 프로세스가 살아 있는가 — 죽었으면 `null`. */
  status: (projectId: number, provider: AcpProvider | null = null) =>
    unwrap<AcpAdapterStatus>("acp_status", commands.acpStatus(projectId, provider)),

  /**
   * 어댑터를 내린다 (플랜 `v3-release` {#acp-stop-ui}).
   *
   * 이 프로젝트×provider 의 어댑터 프로세스 하나를 끈다 — **그 프로세스를
   * 나눠 쓰는 다른 대화 탭도 함께 끊긴다.** 떠 있지 않았으면 `false`.
   */
  stop: (projectId: number, provider: AcpProvider | null = null) =>
    unwrap<boolean>("acp_stop", commands.acpStop(projectId, provider)),

  // ─── 설정 ───

  /** 이 대화의 모델·Effort·권한 모드 목록. */
  options: (projectId: number, provider: AcpProvider | null = null) =>
    unwrap<AcpConfigOption[]>("acp_options", commands.acpOptions(projectId, provider)),

  /** 설정 하나를 바꾸고 **바뀐 목록 전체**를 돌려받는다. */
  setConfigOption: (
    projectId: number,
    provider: AcpProvider | null,
    configId: string,
    value: string,
  ) =>
    unwrap<AcpConfigOption[]>(
      "acp_set_config_option",
      commands.acpSetConfigOption(projectId, provider, configId, value),
    ),

  // ─── 대화 ───

  /** 새 대화를 연다. */
  newSession: (projectId: number, provider: AcpProvider | null = null) =>
    unwrap<AcpSession>("acp_new_session", commands.acpNewSession(projectId, provider)),

  /** 지난 대화 목록 (어댑터로 나가는 진짜 왕복이다 — 아무 알림에나 달지 말 것). */
  listSessions: (projectId: number, provider: AcpProvider | null = null) =>
    unwrap<AcpSessionSummary[]>(
      "acp_list_sessions",
      commands.acpListSessions(projectId, provider),
    ),

  /** 이미 우리 화면에 기록이 있는 대화로 **장부만** 옮긴다 (재생 없음). */
  selectSession: (
    projectId: number,
    provider: AcpProvider | null,
    sessionId: string,
    title: string | null,
  ) =>
    unwrap<AcpSession>(
      "acp_select_session",
      commands.acpSelectSession(projectId, provider, sessionId, title),
    ),

  /** 지난 대화를 어댑터에 다시 싣는다 — 내용은 `onEvent` 로 되흘러온다. */
  loadSession: (
    projectId: number,
    provider: AcpProvider | null,
    sessionId: string,
    onEvent: Channel<AcpEvent>,
  ) =>
    unwrap<AcpSession>(
      "acp_load_session",
      commands.acpLoadSession(projectId, provider, sessionId, onEvent),
    ),

  /** 어댑터가 대화를 보고 나중에 붙인 제목 (아직 없으면 `null`). */
  sessionTitle: (projectId: number, provider: AcpProvider | null = null) =>
    unwrap<string | null>(
      "acp_session_title",
      commands.acpSessionTitle(projectId, provider),
    ),

  /** 프롬프트를 보내고 턴이 끝날 때까지 `onEvent` 로 흘린다. */
  prompt: (
    projectId: number,
    provider: AcpProvider | null,
    sessionId: string | null,
    text: string,
    attachments: string[],
    images: AcpImage[],
    onEvent: Channel<AcpEvent>,
  ) =>
    unwrap<string>(
      "acp_prompt",
      commands.acpPrompt(
        projectId,
        provider,
        sessionId,
        text,
        attachments,
        images,
        onEvent,
      ),
    ),

  // ─── 컴포저 ───

  /** OS 파일 고르기 대화상자 (취소하면 빈 배열). */
  pickFiles: (projectId: number) =>
    unwrap<string[]>("acp_pick_files", commands.acpPickFiles(projectId)),

  /** `@` 자동완성 후보 — 키 하나마다 디스크를 걷는 조회다. */
  listFiles: (projectId: number, query: string, limit: number) =>
    unwrap<string[]>("acp_list_files", commands.acpListFiles(projectId, query, limit)),

  /**
   * 어댑터가 광고하는 `/` 커맨드 목록.
   *
   * 이름이 `commands` 가 아닌 이유는 이 모듈이 생성 파일의 `commands` 를 이미
   * 들고 있어서다 — 자리 이름이 겹치면 읽는 사람이 어느 쪽인지 매번 되짚는다.
   */
  slashCommands: (projectId: number, provider: AcpProvider | null = null) =>
    unwrap<AcpCommand[]>("acp_commands", commands.acpCommands(projectId, provider)),

  // ─── 알림 ───

  /**
   * 어댑터 생사·제목·설정·대화 목록이 바뀌었다. 구독 해제 함수를 돌려준다.
   *
   * 구독 자체의 실패는 삼킨다 — 붙은 것이 없으면 뗄 것도 없고, 화면이 죽어서는
   * 안 된다 (라이브 갱신만 없는 상태로 둔다).
   */
  onSessionChanged: (cb: (payload: AcpSessionChanged) => void): Promise<() => void> => {
    try {
      return events.acpSessionChanged.listen(({ payload }) => cb(payload)).catch(() => () => {});
    } catch {
      return Promise.resolve(() => {});
    }
  },

  // ─── 기록 상태 (플랜 `v3-record-integrity` {#mcp-missing-visible}) ───

  /**
   * 이 프로젝트×provider 에서 **마지막으로 연 대화**에 기록 도구가 붙었는지.
   *
   * 아직 대화를 연 적이 없으면 `null` — 모르는 것을 "붙었다"로도 "없다"로도
   * 말하지 않는다.
   */
  recordingStatus: (projectId: number, provider: AcpProvider | null = null) =>
    unwrap<AcpRecordingStatus | null>(
      "acp_recording_status",
      commands.acpRecordingStatus(projectId, provider),
    ),

  /**
   * 이 대화에 걸려 있는 기록 이의 (없으면 `null`).
   *
   * 판정은 **턴이 끝난 그 순간** 백엔드가 내렸다. 화면은 다시 재지 않는다 —
   * 몇 초 뒤의 워킹트리는 이미 다른 상태다 ({#gate-beyond-cc}).
   */
  journalObjection: (sessionId: string) =>
    unwrap<AcpObjection | null>("acp_journal_objection", commands.acpJournalObjection(sessionId)),

  /** 배너를 닫았다 — 이 대화에서는 다시 띄우지 않는다. */
  dismissJournalObjection: (sessionId: string) =>
    unwrap<boolean>(
      "acp_journal_objection_dismiss",
      commands.acpJournalObjectionDismiss(sessionId),
    ),
};
