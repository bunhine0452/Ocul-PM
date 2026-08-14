import { Toolbar } from "@/components/Toolbar";
import { useT } from "@/i18n";
import { AcpConversation } from "./AcpConversation";

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
  return (
    <>
      <Toolbar title={t("nav.claudecode")} sub={t("acp.toolbarSub")} />
      <AcpConversation projectId={projectId} />
    </>
  );
}
