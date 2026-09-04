import { useEffect, useRef } from "react";
import { commands } from "@/lib/bindings";
import { useTerminalSessions } from "@/contexts/WorkspaceContext";
import { registerTabCloseGuard, type TabRunningWork } from "@/lib/closeIntent";
import { collectSids } from "@/lib/termPanes";
import { panesOfTab } from "@/features/terminal/activePane";
import { countAcpWorkingFor } from "@/features/chat/acpBusyBus";

// 탭 닫기 문지기의 **프로젝트 쪽 절반** (완성도 라운드 Phase 2, 2026-08-30).
//
// "이 탭에 지금 돌아가는 일이 있는가" 는 워크스페이스(터미널 탭 목록)와
// ACP 버스가 안다 — 둘 다 프로젝트 탭 안에서만 읽힌다. 그래서 탭이 자기
// 사정을 창에 **알리는** 함수만 등록하고, 묻는 다이얼로그는 창(`TabbedWindow`)
// 이 띄운다: 숨은 탭 안에 그린 다이얼로그는 보이지 않기 때문이다.
//
// 프롬프트에 멈춰 있는 셸은 세지 않는다 — `pty_foreground_command` 가 이름을
// 돌려주는 페인(dev 서버, 돌고 있는 에이전트)만 "실행 중" 이다. 늘 뜨는 확인은
// 곧 읽지 않고 누르는 확인이 된다.

/**
 * 이 PTY 세션들에서 **지금 돌고 있는** 명령 이름 (없으면 빈 배열).
 *
 * 판정은 하나여야 한다. 2026-09-04 까지 이 로직은 탭 층에만 있었고, 같은 ⌘W 가
 * **페인** 층에 닿으면 아무것도 묻지 않고 `kill_pty_session` 을 쐈다 — 돌던
 * 에이전트의 턴이 확인 없이 사라졌다. 그래서 여기서 내보내 `TerminalSurface`
 * 의 페인·탭 닫기가 **같은 함수**를 쓴다.
 *
 * 조회 실패는 `null` 로 접는다 — "물어봤는데 모르겠다" 를 "돌고 있다" 로 읽으면
 * 늘 뜨는 확인이 되고, 늘 뜨는 확인은 읽지 않고 누르는 확인이 된다.
 */
export async function foregroundCommands(sids: string[]): Promise<string[]> {
  const names = await Promise.all(
    sids.map((sid) =>
      commands
        .ptyForegroundCommand(sid)
        .then((r) => (r.status === "ok" ? r.data : null))
        .catch(() => null),
    ),
  );
  return names.filter((n): n is string => typeof n === "string" && n.length > 0);
}

export function useTabRunningWork(tabId: number, projectId: number): void {
  const sessions = useTerminalSessions();
  const stateRef = useRef(sessions);
  stateRef.current = sessions;

  useEffect(
    () =>
      registerTabCloseGuard(tabId, async (): Promise<TabRunningWork> => {
        const sids = stateRef.current.terminalTabs.flatMap((tab) => collectSids(panesOfTab(tab)));
        return {
          foreground: await foregroundCommands(sids),
          agents: countAcpWorkingFor(projectId),
        };
      }),
    [tabId, projectId],
  );
}
