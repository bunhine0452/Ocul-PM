import { AcpConversation } from "./AcpConversation";

// PR-ACP6 — Claude Code 구동면.
//
// 프로바이더 채팅("에이전트" 화면)과 **화면을 나눈 이유**: 성격이 다르다.
// 저쪽은 물어보는 곳이고 여기는 시키는 곳이다 — 한 화면에서 토글로 오가면
// 사용자가 "지금 어느 쪽에 말하고 있는가"를 매번 확인해야 한다.
//
// 툴바까지 AcpConversation 이 그린다. 상단바가 **세션 탭 줄**이 되면서 필요한
// 것(대화 목록·현재 세션·열기·새로 만들기)이 전부 저쪽 상태가 됐고, 여기서
// 그리려면 그 상태를 통째로 끌어올리거나 신호선을 새로 놓아야 했다.

export function ClaudeCodeScreenV2({ projectId }: { projectId: number }) {
  return <AcpConversation projectId={projectId} />;
}
