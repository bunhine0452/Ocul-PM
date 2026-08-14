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
  /** 도구에 들어간 것 (명령줄·인자). */
  input?: string;
  /** 도구가 내놓은 것. 진행 중에는 없다가 갱신으로 채워진다. */
  output?: string;
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
 * 두 경로가 이 함수를 공유한다.
 *  - **라이브**: `openTurn` 이 이미 사용자/에이전트 턴 쌍을 열어 둔 상태.
 *  - **재생**(`session/load`): 빈 목록에서 시작해 이벤트만으로 대화를 복원한다.
 *    스펙상 load 는 지난 대화를 `session/update` 로 통째로 다시 흘려보낸다.
 *
 * 그래서 `replay` 를 켜면 필요한 턴을 **직접 연다**. 끄면 열려 있는 마지막
 * 에이전트 턴에만 붙이고 나머지는 버린다 — 턴이 끝난 뒤 늦게 도착한 청크를
 * 엉뚱한 곳에 섞는 것보다 버리는 편이 낫다.
 */
export function applyAcpEvent(
  turns: readonly AcpTurn[],
  event: AcpEvent,
  replay = false,
): AcpTurn[] {
  // 사용자 발화는 재생에서만 의미가 있다 — 라이브에서는 우리가 이미 그렸다.
  if (event.kind === "user_chunk") {
    if (!replay) return [...turns];
    const tail = turns[turns.length - 1];
    if (tail?.role === "user") {
      const merged = [...turns];
      merged[turns.length - 1] = { ...tail, text: tail.text + event.text };
      return merged;
    }
    return [...turns, { role: "user", text: event.text }];
  }

  const handled =
    event.kind === "chunk" ||
    event.kind === "thought" ||
    event.kind === "done" ||
    event.kind === "tool_call" ||
    event.kind === "tool_update";
  if (!handled) return [...turns];

  // 재생 중에 받을 턴이 없으면 연다 (사용자 발화 바로 뒤가 그 자리다).
  const base: readonly AcpTurn[] =
    replay &&
    event.kind !== "done" &&
    (() => {
      const tail = turns[turns.length - 1];
      return !tail || tail.role !== "agent" || tail.closed === true;
    })()
      ? [...turns, { role: "agent", text: "" }]
      : turns;

  const index = base.length - 1;
  const last = base[index];
  if (!last || last.role !== "agent" || last.closed) return [...base];

  const next = [...base];
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
            input: event.input ?? undefined,
            output: event.output ?? undefined,
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
          // `null` 은 "안 왔다"이지 "비었다"가 아니다 — 이미 받은 것을 지우면
          // 완료된 카드의 출력이 사라진다.
          input: event.input ?? tool.input,
          output: event.output ?? tool.output,
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
