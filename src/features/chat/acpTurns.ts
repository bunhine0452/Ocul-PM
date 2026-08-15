import type { AcpEvent, AcpPlanEntry, AcpToolDiff } from "@/lib/bindings";

export type { AcpPlanEntry, AcpToolDiff };

// PR-ACP2/3 — ACP 스트리밍 이벤트를 화면 턴 목록에 누적하는 순수 리듀서.
//
// 컴포넌트에서 떼어낸 이유: 청크가 **어느 턴에 붙는가**는 조용히 틀리기 쉬운
// 자리다. 취소·오류로 턴이 끝난 뒤 늦게 도착한 청크가 다음 사용자 메시지에
// 달라붙으면 대화가 뒤섞이는데, 화면만 보고는 원인을 못 찾는다.

/** 화면에 그리는 도구 호출 하나. */
export interface AcpToolCall {
  id: string;
  title: string;
  /** 도구 이름 (`Bash` · `Read` …). 어댑터가 `_meta` 로만 준다 — 없을 수 있다. */
  name?: string;
  /** 한 줄 설명 — Bash 는 모델이 적어 준 `description`. */
  subtitle?: string;
  /** `read` · `edit` · `execute` … (아이콘 선택용). */
  kind: string;
  /** `pending` · `in_progress` · `completed` · `failed`. */
  status: string;
  locations: string[];
  /** 도구에 들어간 것 (명령줄·인자). */
  input?: string;
  /** 도구가 내놓은 것. 진행 중에는 없다가 갱신으로 채워진다. */
  output?: string;
  /** 편집 도구의 파일 변경 — 있으면 카드가 diff 뷰를 그린다. */
  diffs?: AcpToolDiff[];
  /** 호출이 시작된 시각(ms) — "실행 중 · 12s" 의 근거. 재생에는 없다. */
  startedAt?: number;
}

/** 사용자가 함께 보낸 이미지 한 장 — 화면에 그리는 데 필요한 것만. */
export interface AcpTurnImage {
  /** `data:` URL. 원본을 그대로 들고 있어야 확대해서 볼 때 다시 못 만드는 일이 없다. */
  src: string;
  name: string;
  /** 원본 픽셀 크기 — 붙여넣은 순간 재서 넣는다. */
  width: number;
  height: number;
}

/**
 * 에이전트 턴의 조각 하나 — **일어난 순서 그대로**.
 *
 * 예전에는 글은 `text` 한 덩어리로, 도구는 `tools` 배열로 따로 모았다. 그러면
 * 화면이 "도구 전부 → 글 전부"로 그려져 **순서가 무너진다**: 도구 사이사이에
 * 한 줄씩 하던 설명이 맨 아래에 줄줄이 붙어, 서로 다른 대목의 문장이 한 문단인
 * 것처럼 이어져 보였다. 조각을 순서대로 들면 그대로 그리기만 하면 된다.
 */
export type AcpBlock =
  | { kind: "text"; text: string }
  | { kind: "tool"; call: AcpToolCall }
  /**
   * 세션에 일어난 일 (한도 초과·인증 실패·모델 폴백 …).
   *
   * 조각으로 두는 이유: **일어난 자리**가 정보다. 한도가 어느 도구 호출 뒤에
   * 걸렸는지, 폴백이 어느 대목에서 났는지가 순서로 읽힌다. 맨 위나 맨 아래로
   * 모으면 그게 사라진다.
   */
  | { kind: "failure"; id: string; category: string; severity: string; title: string; details?: string };

export interface AcpTurn {
  /**
   * `notice` 는 대화가 아니라 **대화에 일어난 일**이다 (모델 교체 같은).
   * 사람도 에이전트도 한 말이 아니므로 말풍선·카드가 아니라 구분선으로 그린다.
   */
  role: "user" | "agent" | "notice";
  /**
   * 사용자 발화의 본문. 에이전트 턴에서는 `blocks` 가 진짜이고 이 값은 전체를
   * 이어 붙인 것 — 복사·길이 계산처럼 순서가 필요 없는 곳에서만 쓴다.
   */
  text: string;
  /** 에이전트 턴의 조각들 (글·도구가 섞여 온 순서 그대로). */
  blocks?: AcpBlock[];
  /**
   * 에이전트의 할 일 목록.
   *
   * 조각(`blocks`)이 아니라 턴에 **하나만** 둔다 — 매번 전체가 새로 오고
   * 클라이언트가 통째로 갈아 끼우는 값이라(스펙), 순서대로 쌓으면 같은 목록이
   * 갱신될 때마다 화면에 여러 벌 쌓인다.
   */
  plan?: AcpPlanEntry[];
  /** 이 발화에 딸려 보낸 파일 경로 (사용자 턴에서만). */
  attachments?: string[];
  /** 이 발화에 딸려 보낸 이미지 (사용자 턴에서만). */
  images?: AcpTurnImage[];
  /** 내부 추론(thought) 누적 — UI 는 기본 접어 둔다. */
  thought?: string;
  /** 이 턴에서 일어난 도구 호출 (도착 순). */
  tools?: AcpToolCall[];
  /** 턴이 닫혔는지 (done/failed 이후 도착한 이벤트를 거절하는 근거). */
  closed?: boolean;
  /** 첫 생각 조각이 온 시각(ms). 생각이 없었으면 없다. */
  thoughtStart?: number;
  /** 생각이 끝난 시각(ms) — 첫 답변 조각이 온 순간. 아직이면 없다. */
  thoughtEnd?: number;
  /** 이 턴이 열린 시각(ms). 사용자 턴에서는 "언제 시켰나", 에이전트 턴에서는
      영수증의 소요 시간 계산에 쓴다. 재생으로 복원한 턴에는 없다. */
  at?: number;
  /** 에이전트 턴이 닫힌 시각(ms) — 영수증의 소요 시간의 끝. */
  endedAt?: number;
}

/** 턴 영수증 — 끝난 턴의 "무엇을 얼마나 했나" 한 줄. */
export interface TurnReceipt {
  /** 도구 호출 수. */
  tools: number;
  /** 손댄 파일 수 (편집·삭제·이동의 경로, 중복 제거). */
  files: number;
  /** 실행한 명령 수. */
  commands: number;
  /** 걸린 시간(초). 시각이 없으면(재생) `null`. */
  seconds: number | null;
}

/** 파일을 실제로 바꾸는 도구 종류 — 읽기·검색은 "손댄 파일"이 아니다. */
const MUTATING_KINDS = new Set(["edit", "delete", "move"]);

/**
 * 끝난 에이전트 턴의 영수증. **도구를 쓴 턴에만** 있다 — 말로만 답한 턴에
 * "도구 0" 영수증을 붙이면 정보가 아니라 소음이다.
 */
export function turnReceipt(turn: AcpTurn): TurnReceipt | null {
  if (turn.role !== "agent" || !turn.closed || !turn.tools?.length) return null;
  const files = new Set<string>();
  let commands = 0;
  for (const tool of turn.tools) {
    if (MUTATING_KINDS.has(tool.kind)) {
      for (const location of tool.locations) files.add(location);
    }
    if (tool.kind === "execute") commands += 1;
  }
  const seconds =
    turn.at != null && turn.endedAt != null && turn.endedAt > turn.at
      ? Math.round((turn.endedAt - turn.at) / 1000)
      : null;
  return { tools: turn.tools.length, files: files.size, commands, seconds };
}

/**
 * 사용자 발화 + 응답을 받을 빈 에이전트 턴을 함께 연다.
 *
 * 딸려 보낸 것(파일·이미지)도 사용자 턴에 얹는다 — 컴포저의 칩은 보내는 순간
 * 사라지므로, 여기 남기지 않으면 "무엇을 같이 보냈더라"를 되짚을 방법이 없다.
 * 빈 배열은 넣지 않는다: 있는 것과 없는 것을 화면이 구분해야 한다.
 */
export function openTurn(
  turns: readonly AcpTurn[],
  text: string,
  extras?: { attachments?: readonly string[]; images?: readonly AcpTurnImage[] },
  /** 지금 시각(ms). 안 넘기면 시각을 안 찍는다 (재생·테스트). */
  now?: number,
): AcpTurn[] {
  const user: AcpTurn = { role: "user", text };
  if (extras?.attachments?.length) user.attachments = [...extras.attachments];
  if (extras?.images?.length) user.images = [...extras.images];
  if (now != null) user.at = now;
  const agent: AcpTurn = { role: "agent", text: "" };
  if (now != null) agent.at = now;
  return [...turns, user, agent];
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
  /**
   * 지금 시각(ms). 생각에 걸린 시간을 재는 데만 쓴다 — 인자로 받는 이유는
   * 리듀서를 순수하게 두기 위해서다(테스트가 시계를 고정할 수 있다).
   *
   * **안 넘기면 아예 안 찍는다.** 기본값 0 을 찍으면 "0초 생각함"처럼 보여
   * 시계를 안 넘긴 호출부의 실수가 화면에서는 정상처럼 보인다.
   */
  now?: number,
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
    event.kind === "failure" ||
    event.kind === "plan" ||
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
      next[index] = {
        ...last,
        text: last.text + event.text,
        blocks: appendText(last.blocks, event.text),
        // 첫 답변 조각이 오는 순간 생각은 끝난 것이다. 이미 찍혔으면 둔다 —
        // 답변 중간에 다시 생각해도 처음 구간이 "생각한 시간"이다.
        thoughtEnd:
          now != null && last.thoughtStart != null
            ? (last.thoughtEnd ?? now)
            : last.thoughtEnd,
      };
      break;
    case "thought":
      next[index] = {
        ...last,
        thought: (last.thought ?? "") + event.text,
        thoughtStart: now != null ? (last.thoughtStart ?? now) : last.thoughtStart,
      };
      break;
    case "tool_call": {
      // 도구 호출 id 는 세션 안에서 유일하다 — 같은 id 가 또 오면 **새 카드가
      // 아니라 같은 카드**다. 그냥 밀어 넣으면 화면에 카드가 두 장 생기고,
      // React 가 "두 자식이 같은 key" 라며 하나를 지우거나 겹쳐 그린다.
      // (같은 세션을 두 번 재생하면 실제로 이렇게 됐다.)
      const fresh: AcpToolCall = {
        id: event.id,
        title: event.title,
        name: event.name ?? undefined,
        subtitle: event.subtitle ?? undefined,
        kind: event.tool_kind,
        status: event.status,
        locations: event.locations,
        input: event.input ?? undefined,
        output: event.output ?? undefined,
        diffs: event.diffs.length ? event.diffs : undefined,
      };
      if (now != null) fresh.startedAt = now;
      const tools = last.tools ?? [];
      const at = tools.findIndex((tool) => tool.id === event.id);
      next[index] = {
        ...last,
        tools:
          at === -1
            ? [...tools, fresh]
            : tools.map((tool, i) => (i === at ? fresh : tool)),
        blocks: putTool(last.blocks, fresh),
      };
      break;
    }
    case "tool_update": {
      const tools = patchTool(last.tools, event);
      const patched = tools.find((tool) => tool.id === event.id);
      next[index] = {
        ...last,
        tools,
        blocks: patched ? putTool(last.blocks, patched) : last.blocks,
      };
      break;
    }
    case "failure":
      next[index] = { ...last, blocks: putFailure(last.blocks, event) };
      break;
    case "plan":
      // 합치지 않고 **대체**한다 — 갱신은 언제나 전체 목록이다.
      next[index] = { ...last, plan: event.entries };
      break;
    default:
      next[index] =
        now != null ? { ...last, closed: true, endedAt: last.endedAt ?? now } : { ...last, closed: true };
  }
  return next;
}

/** 마지막 조각이 글이면 이어 붙이고, 아니면 새 글 조각을 연다. */
function appendText(blocks: readonly AcpBlock[] | undefined, text: string): AcpBlock[] {
  const list = blocks ?? [];
  const last = list[list.length - 1];
  if (last?.kind === "text") {
    return [...list.slice(0, -1), { kind: "text", text: last.text + text }];
  }
  return [...list, { kind: "text", text }];
}

/**
 * 같은 `id` 의 실패 조각이 있으면 **그 자리에서** 갱신한다.
 *
 * 스펙: 같은 id 의 더 높은 revision 은 "그 줄을 제자리에서 고치는 것"이지 새
 * 줄이 아니다. 밀어 넣으면 재시도가 진행될 때마다 같은 사고가 여러 줄 쌓인다.
 */
function putFailure(
  blocks: readonly AcpBlock[] | undefined,
  event: Extract<AcpEvent, { kind: "failure" }>,
): AcpBlock[] {
  const fresh: AcpBlock = {
    kind: "failure",
    id: event.id,
    category: event.category,
    severity: event.severity,
    title: event.title,
    details: event.details ?? undefined,
  };
  const list = blocks ?? [];
  const at = list.findIndex((block) => block.kind === "failure" && block.id === event.id);
  if (at === -1) return [...list, fresh];
  return list.map((block, i) => (i === at ? fresh : block));
}

/** 같은 id 의 도구 조각이 있으면 **그 자리에서** 바꾸고, 없으면 뒤에 붙인다. */
function putTool(blocks: readonly AcpBlock[] | undefined, call: AcpToolCall): AcpBlock[] {
  const list = blocks ?? [];
  const at = list.findIndex((block) => block.kind === "tool" && block.call.id === call.id);
  if (at === -1) return [...list, { kind: "tool", call }];
  return list.map((block, i) => (i === at ? { kind: "tool", call } : block));
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
          name: event.name ?? tool.name,
          subtitle: event.subtitle ?? tool.subtitle,
          status: event.status ?? tool.status,
          // `null` 은 "안 왔다"이지 "비었다"가 아니다 — 이미 받은 것을 지우면
          // 완료된 카드의 출력이 사라진다.
          input: event.input ?? tool.input,
          output: event.output ?? tool.output,
          diffs: event.diffs?.length ? event.diffs : tool.diffs,
        }
      : tool,
  );
}

/** 턴을 강제로 닫는다 (커맨드가 오류로 끝났을 때). */
export function closeTurn(turns: readonly AcpTurn[], now?: number): AcpTurn[] {
  const index = turns.length - 1;
  const last = turns[index];
  if (!last || last.role !== "agent") return [...turns];
  const next = [...turns];
  next[index] =
    now != null && !last.closed
      ? { ...last, closed: true, endedAt: last.endedAt ?? now }
      : { ...last, closed: true };
  return next;
}

/**
 * 턴 목록을 **주고받은 묶음**(사용자 지시 + 그에 대한 답)으로 나눈다.
 *
 * 화면이 이 묶음을 실제 요소로 그려야 지시문 sticky 가 성립한다. 평평하게
 * 늘어놓으면 모든 사용자 카드의 컨테이닝 블록이 스레드 전체가 되어, 스크롤을
 * 내릴수록 카드가 **하나도 안 놓이고 top 에 겹겹이 쌓인다**(실제로 그랬다).
 * 묶음 안에 가두면 자기 답변이 끝나는 순간 자연히 자리를 비운다.
 *
 * 사용자 발화에서 새 묶음이 열린다. 재생으로 복원한 대화는 에이전트 턴이 먼저
 * 올 수 있어 첫 묶음은 사용자 없이 시작할 수도 있다.
 */
export function groupTurns(turns: readonly AcpTurn[]): AcpTurn[][] {
  const groups: AcpTurn[][] = [];
  for (const turn of turns) {
    if (turn.role === "user" || groups.length === 0) groups.push([turn]);
    else groups[groups.length - 1].push(turn);
  }
  return groups;
}

/**
 * "대화에 일어난 일" 한 줄을 끼운다 (모델을 바꿨다 …).
 *
 * **열려 있는 에이전트 턴 앞에** 넣는다. 리듀서는 "마지막 턴이 곧 받는 중인
 * 턴"이라는 규칙으로 도는데, 맨 뒤에 붙이면 그 규칙이 깨져 그 뒤 도착하는
 * 청크가 갈 곳을 잃는다(조용히 버려진다).
 */
export function insertNotice(turns: readonly AcpTurn[], text: string): AcpTurn[] {
  const notice: AcpTurn = { role: "notice", text };
  const last = turns[turns.length - 1];
  if (last?.role === "agent" && !last.closed) {
    return [...turns.slice(0, -1), notice, last];
  }
  return [...turns, notice];
}
