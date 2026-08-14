import { useCallback } from "react";
import { Toolbar } from "@/components/Toolbar";
import { PanelLeft } from "@/components/Icons";
import { useT } from "@/i18n";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { AcpConversation } from "./AcpConversation";
import { AcpUsageMeter } from "./AcpUsageMeter";

// PR-ACP6 — Claude Code 구동면.
//
// 프로바이더 채팅("에이전트" 화면)과 **화면을 나눈 이유**: 성격이 다르다.
// 저쪽은 물어보는 곳이고 여기는 시키는 곳이다 — 한 화면에서 토글로 오가면
// 사용자가 "지금 어느 쪽에 말하고 있는가"를 매번 확인해야 한다.
//
// 대화 상태는 전부 AcpConversation 이 들고 있고, 이 파일은 툴바만 얹는다
// (각 화면이 자기 Toolbar 를 그린다 — ui_v2 규약).

export function ClaudeCodeScreenV2({ projectId }: { projectId: number }) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  // 패널 토글은 **툴바에 고정**한다. 스레드 위에 띄우면 열림/닫힘에 따라 위치가
  // 달라져 같은 버튼으로 안 읽힌다.
  const togglePanel = useCallback(
    () => setState((prev) => ({ ...prev, acpPanelOpen: !prev.acpPanelOpen })),
    [setState],
  );

  return (
    <>
      <Toolbar title={t("nav.claudecode")} sub={t("acp.toolbarSub")}>
        <AcpUsageMeter projectId={projectId} />
        <button
          type="button"
          className={"btn icon ghost acp-panel-toggle" + (state.acpPanelOpen ? " active" : "")}
          onClick={togglePanel}
          aria-pressed={state.acpPanelOpen}
          aria-label={t("acp.history")}
          title={t("acp.history")}
        >
          <PanelLeft size={15} />
        </button>
      </Toolbar>
      <AcpConversation projectId={projectId} />
    </>
  );
}
