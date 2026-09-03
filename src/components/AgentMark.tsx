import type { SVGProps } from "react";
import { ClaudeMark } from "./ClaudeMark";
import { CodexMark } from "./CodexMark";
import { Cpu } from "./Icons";

// 에이전트 글리프 (2026-09-02).
//
// 예전엔 어디서나 lucide `Bot`(로봇 얼굴)이었다. "에이전트 = 로봇" 은 직역이고,
// 이 제품의 에이전트는 Claude Code · Cursor · Gemini CLI 같은 **이름 있는 도구**다.
// 그래서 마크가 있는 에이전트는 그 마크로 그리고, 모르는 것은 중립 글리프(Cpu)
// 로 둔다 — 은유 대신 정체를 보여 준다.
//
// 이름표(agentLabel)가 옆에 붙는 자리(일지 카드·상세)에서는 아이콘을 아예 쓰지
// 않는다 — 글자가 이미 답이고, 아이콘은 장식이 된다. 이 컴포넌트는 아이콘만
// 놓을 수 있는 좁은 자리(터미널 레일·상태 필)를 위한 것이다.
export function AgentMark({
  agentId,
  size = 14,
  ...rest
}: { agentId?: string | null; size?: number | string } & Omit<SVGProps<SVGSVGElement>, "size">) {
  const id = (agentId ?? "").toLowerCase();
  if (id.startsWith("claude")) return <ClaudeMark size={size} {...rest} />;
  // Codex 도 마크가 있는데 여기서만 빠져 있었다 — 터미널 레일·상태 필에서
  // 혼자 중립 글리프(Cpu)로 떨어져, 같은 자리에서 Claude 는 자기 로고이고
  // Codex 는 "모르는 무엇"이 됐다.
  if (id.startsWith("codex")) return <CodexMark size={size} {...rest} />;
  return <Cpu size={size} {...rest} />;
}
