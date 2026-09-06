// 턴의 조각들 → 활동 줄 (플랜 `v3-surface` `{#activity-types}`).
//
// 순수 함수만 둔다 — 이 변환은 조용히 틀리기 쉬운 자리라(무엇이 접히고 무엇이
// 안 접히는가) 화면 없이 단언할 수 있어야 한다.

import type { AcpBlock, AcpToolCall } from "../acpTurns";
import type { ActivityStatus } from "./activityTypes";
import { classifyToolCall } from "./classify";
import { groupActivities, type Activity, type ActivityNode } from "./group";

export type FailureBlock = Extract<AcpBlock, { kind: "failure" }>;

/** 화면에 서는 활동 한 줄 — 묶기가 보는 성질 + 그리는 데 필요한 원본. */
export interface BlockActivity extends Activity {
  /** 줄에 적히는 한 줄 (도구 제목·실패 제목). */
  title: string;
  /** 도구 호출이면 그 몸통. `TraceRow` 가 그린다. */
  call: AcpToolCall | null;
  /** 실패 조각이면 그 원본. */
  failure: FailureBlock | null;
  /** 원본 이벤트 — 레일이 그대로 펼친다 (`{#raw-rail}`). */
  raw: unknown;
}

/**
 * 도구 상태 4종 → 화면 3상태.
 *
 * **모르는 상태는 `running` 으로 흘린다.** `done` 으로 흘리면 묶기가 접어
 * 버리는데, 끝났는지도 모르는 것을 접는 것은 안 끝난 일을 감추는 것이다.
 */
function statusOf(status: string): ActivityStatus {
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  return "running";
}

export function activityFromTool(call: AcpToolCall): BlockActivity {
  const { kind, verb } = classifyToolCall(call);
  return {
    id: call.id,
    kind,
    verb,
    status: statusOf(call.status),
    title: call.subtitle || call.title,
    call,
    failure: null,
    raw: call,
  };
}

export function activityFromFailure(block: FailureBlock): BlockActivity {
  return {
    id: block.id,
    kind: "error",
    verb: block.category,
    status: "failed",
    title: block.title,
    call: null,
    failure: block,
    raw: block,
  };
}

/** 흐름의 한 마디 — 산문 한 덩어리이거나, 활동 낱줄/묶음이거나. */
export type StreamNode =
  | { node: "text"; key: string; text: string; last: boolean }
  | ActivityNode<BlockActivity>;

/**
 * 조각들을 **온 순서 그대로** 마디로 나눈다.
 *
 * 산문이 끼면 묶음이 거기서 끊긴다 — 도구 사이에 에이전트가 한 말이 있었다는
 * 것 자체가 정보이고, 그 앞뒤를 한 묶음으로 접으면 "다섯 번 읽었다" 안에
 * 설명 한 문단이 사라진다.
 */
export function streamNodes(blocks: readonly AcpBlock[]): StreamNode[] {
  const out: StreamNode[] = [];
  let pending: BlockActivity[] = [];
  const flush = () => {
    if (!pending.length) return;
    out.push(...groupActivities(pending));
    pending = [];
  };
  blocks.forEach((block, i) => {
    if (block.kind === "text") {
      flush();
      out.push({ node: "text", key: `t${i}`, text: block.text, last: i === blocks.length - 1 });
      return;
    }
    pending.push(
      block.kind === "tool" ? activityFromTool(block.call) : activityFromFailure(block),
    );
  });
  flush();
  return out;
}
