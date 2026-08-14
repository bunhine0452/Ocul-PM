import type { AcpEvent } from "@/lib/bindings";

// PR-ACP2/3 — ACP 스트리밍 이벤트를 화면 턴 목록에 누적하는 순수 리듀서.
//
// 컴포넌트에서 떼어낸 이유: 청크가 **어느 턴에 붙는가**는 조용히 틀리기 쉬운
// 자리다. 취소·오류로 턴이 끝난 뒤 늦게 도착한 청크가 다음 사용자 메시지에
// 달라붙으면 대화가 뒤섞이는데, 화면만 보고는 원인을 못 찾는다.

/** 화면에 그리는 도구 호출 하나. */
export interface AcpToolCall {
  id: string;
  title: string;
  /** `read` · `edit` · `execute` … (아이콘 선택용). */
  kind: string;
  /** `pending` · `in_progress` · `completed` · `failed`. */
  status: string;
  locations: string[];
}

export interface AcpTurn {
  role: "user" | "agent";
  text: string;
  /** 내부 추론(thought) 누적 — UI 는 기본 접어 둔다. */
  thought?: string;
  /** 이 턴에서 일어난 도구 호출 (도착 순). */
  tools?: AcpToolCall[];
  /** 턴이 닫혔는지 (done/failed 이후 도착한 이벤트를 거절하는 근거). */
  closed?: boolean;
}

/** 사용자 발화 + 응답을 받을 빈 에이전트 턴을 함께 연다. */
export function openTurn(turns: readonly AcpTurn[], text: string): AcpTurn[] {
  return [...turns, { role: "user", text }, { role: "agent", text: "" }];
}

/**
 * 이벤트 하나를 반영한 **새 배열**을 돌려준다 (입력은 변경하지 않는다).
 *
 * 열려 있는 마지막 에이전트 턴에만 붙인다 — 없으면 그대로 둔다. 늦게 온
 * 이벤트를 버리는 쪽이 엉뚱한 턴에 섞어 넣는 것보다 낫다.
 */
export function applyAcpEvent(turns: readonly AcpTurn[], event: AcpEvent): AcpTurn[] {
  const handled =
    event.kind === "chunk" ||
    event.kind === "thought" ||
    event.kind === "done" ||
    event.kind === "tool_call" ||
    event.kind === "tool_update";
  if (!handled) return [...turns];

  const index = turns.length - 1;
  const last = turns[index];
  if (!last || last.role !== "agent" || last.closed) return [...turns];

  const next = [...turns];
  switch (event.kind) {
    case "chunk":
      next[index] = { ...last, text: last.text + event.text };
      break;
    case "thought":
      next[index] = { ...last, thought: (last.thought ?? "") + event.text };
      break;
    case "tool_call":
      next[index] = {
        ...last,
        tools: [
          ...(last.tools ?? []),
          {
            id: event.id,
            title: event.title,
            kind: event.tool_kind,
            status: event.status,
            locations: event.locations,
          },
        ],
      };
      break;
    case "tool_update":
      next[index] = { ...last, tools: patchTool(last.tools, event) };
      break;
    default:
      next[index] = { ...last, closed: true };
  }
  return next;
}

/**
 * 도구 호출 하나를 id 로 찾아 **온 필드만** 덮어쓴다.
 *
 * 부분 갱신에서 안 온 필드를 기본값으로 채우면 멀쩡한 제목이 빈 문자열로
 * 지워진다. 모르는 id 면 아무 것도 하지 않는다 — 유령 카드를 만들지 않는다.
 */
function patchTool(
  tools: readonly AcpToolCall[] | undefined,
  event: Extract<AcpEvent, { kind: "tool_update" }>,
): AcpToolCall[] {
  if (!tools) return [];
  return tools.map((tool) =>
    tool.id === event.id
      ? {
          ...tool,
          title: event.title ?? tool.title,
          status: event.status ?? tool.status,
        }
      : tool,
  );
}

/** 턴을 강제로 닫는다 (커맨드가 오류로 끝났을 때). */
export function closeTurn(turns: readonly AcpTurn[]): AcpTurn[] {
  const index = turns.length - 1;
  const last = turns[index];
  if (!last || last.role !== "agent") return [...turns];
  const next = [...turns];
  next[index] = { ...last, closed: true };
  return next;
}
