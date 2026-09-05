/**
 * `acpApi` — 앱 안 ACP 대화(Claude Code · Codex)의 커맨드 래퍼.
 *
 * 지금은 **기록 상태** 하나뿐이다 (플랜 `v3-record-integrity`
 * {#mcp-missing-visible}). 나머지 ACP 커맨드는 아직 `AcpConversation.tsx` 가
 * `bindings.ts` 를 직접 부르고 있고(`lint:bindings` 의 역방향 allowlist),
 * 이 라운드에서 그 화면을 통째로 옮기지는 않는다 — 새 코드만 래퍼를 지난다.
 */

import { call, type Envelope } from "@/api/invoke";
import { commands } from "@/lib/bindings";
import type { AcpObjection, AcpProvider, AcpRecordingStatus } from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const acpApi = {
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
