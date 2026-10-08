/**
 * `sessionApi` — 지금 열린 세션을 묻고, 열림·닫힘을 구독한다 (review-2026-10-09 {#seeded-event}).
 *
 * 창이 열릴 때 「현재 세션」·탭의 바쁜 점을 이벤트가 아니라 물음으로 세우는 데 쓴다
 * (`useSeededEvent`). `oculpmApi` 와 따로 둔 이유: 모든 프로젝트 창(WorkspaceProvider)이
 * 이 셋을 부르는데, `oculpmApi` 는 화면 테스트마다 부분 목으로 흉내 내므로 거기 두면
 * 그 목들이 전부 이 셋을 알아야 한다.
 */

import { call, subscribe } from "@/api/invoke";
import {
  commands,
  events,
  type OculpmSessionEnded,
  type OculpmSessionStarted,
  type Session,
} from "@/lib/bindings";

export const sessionApi = {
  /** 지금 열려 있는 세션 (없으면 `null`). */
  current: (projectId: number) =>
    call<Session | null>("oculpm_current_session", commands.oculpmCurrentSession(projectId)),
  /** 붙으면 풀리는 Promise — 붙은 뒤에 묻는 화면용. */
  onStarted: (cb: (payload: OculpmSessionStarted) => void) =>
    subscribe(events.oculpmSessionStarted, cb),
  onEnded: (cb: (payload: OculpmSessionEnded) => void) => subscribe(events.oculpmSessionEnded, cb),
};
