// 디버거(DAP) 커맨드·이벤트 래퍼 (2026-10-01 `{#api-facades}`).
//
// 백엔드가 어댑터 프로세스·프로토콜·상태 기계를 다 맡는다. 화면은 이벤트를
// 구독하고 멈춘 순간에만 스택·스코프·변수를 묻는다 (`useDebug`).
import {
  commands,
  events,
  type DapAdapterInfo,
  type DapBreakpointsChanged,
  type DapFileBreakpoints,
  type DapFrame,
  type DapLaunchRequest,
  type DapOutputEmitted,
  type DapScope,
  type DapSessionChanged,
  type DapSessionInfo,
  type DapVariable,
} from "@/lib/bindings";
import { call, subscribe } from "./invoke";

export type DapControlAction = "continue" | "next" | "step_in" | "step_out" | "pause";

export const dapApi = {
  /** 설치된(쓸 수 있는) 디버그 어댑터. */
  adapters: (): Promise<DapAdapterInfo[]> => call("dap_adapters", commands.dapAdapters()),
  /** 지금 세션 — 없으면 `null`. */
  session: (projectId: number) => call("dap_session", commands.dapSession(projectId)),
  start: (projectId: number, request: DapLaunchRequest): Promise<DapSessionInfo> =>
    call("dap_start", commands.dapStart(projectId, request)),
  stop: (projectId: number): Promise<null> => call("dap_stop", commands.dapStop(projectId)),
  control: (projectId: number, action: DapControlAction): Promise<null> =>
    call("dap_control", commands.dapControl(projectId, action)),
  /** 켜고 끈 뒤 그 파일의 중단점 줄 전량 (1-based). */
  toggleBreakpoint: (projectId: number, relPath: string, line: number): Promise<number[]> =>
    call("dap_toggle_breakpoint", commands.dapToggleBreakpoint(projectId, relPath, line)),
  allBreakpoints: (projectId: number): Promise<DapFileBreakpoints[]> =>
    call("dap_all_breakpoints", commands.dapAllBreakpoints(projectId)),
  stack: (projectId: number): Promise<DapFrame[]> => call("dap_stack", commands.dapStack(projectId)),
  scopes: (projectId: number, frameId: number | null): Promise<DapScope[]> =>
    call("dap_scopes", commands.dapScopes(projectId, frameId)),
  variables: (projectId: number, variablesReference: number | null): Promise<DapVariable[]> =>
    call("dap_variables", commands.dapVariables(projectId, variablesReference)),

  onSessionChanged: (cb: (payload: DapSessionChanged) => void) => subscribe(events.dapSessionChanged, cb),
  onOutput: (cb: (payload: DapOutputEmitted) => void) => subscribe(events.dapOutputEmitted, cb),
  onBreakpointsChanged: (cb: (payload: DapBreakpointsChanged) => void) =>
    subscribe(events.dapBreakpointsChanged, cb),
};
