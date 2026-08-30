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

export function useTabRunningWork(tabId: number, projectId: number): void {
  const sessions = useTerminalSessions();
  const stateRef = useRef(sessions);
  stateRef.current = sessions;

  useEffect(
    () =>
      registerTabCloseGuard(tabId, async (): Promise<TabRunningWork> => {
        const sids = stateRef.current.terminalTabs.flatMap((tab) => collectSids(panesOfTab(tab)));
        const names = await Promise.all(
          sids.map((sid) =>
            commands
              .ptyForegroundCommand(sid)
              .then((r) => (r.status === "ok" ? r.data : null))
              .catch(() => null),
          ),
        );
        return {
          foreground: names.filter((n): n is string => typeof n === "string" && n.length > 0),
          agents: countAcpWorkingFor(projectId),
        };
      }),
    [tabId, projectId],
  );
}
