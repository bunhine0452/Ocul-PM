/**
 * AD-4 — "에이전트 컨텍스트 화면을 열고 이걸 해라" 요청 버스
 * (docs/agent-discipline/00-master-plan.md D3).
 *
 * 규칙은 *에이전트가 또 같은 실수를 했을 때* 태어나고, 스킬은 *같은 절차를 또
 * 손으로 쳤을 때* 태어난다. 그 순간 사용자는 일지·diff·터미널에 있지 12번째
 * 화면에 없다 — 그래서 만드는 문을 사건 위로 분산시키고, 그 문들이 이 슬롯을
 * 통해 화면을 부른다.
 *
 * 규약은 `journalCompose` 와 같다: 이미 떠 있으면 이벤트로 즉시, 아직 lazy 로
 * 안 붙었으면 셸이 `hold` 해 두고 화면이 마운트되며 `consume` 으로 회수한다.
 */
import { createIntentSlot } from "@/lib/createStore";

/** 규칙 새로 만들기 씨앗 — 사건 화면이 아는 만큼만 채운다. */
export interface RuleSeed {
  /** 슬러그 후보 (`.claude/rules/<name>.md`). */
  name?: string;
  /** frontmatter `paths` 후보. */
  paths?: string[];
  /** 본문 앞머리 — "무엇을 보고 만들었는가" 의 증거. */
  body?: string;
}

/** 스킬 새로 만들기 씨앗. */
export interface SkillSeed {
  name?: string;
  /** 영문 `description` — 자동 발동 트리거라 비어 있으면 안 걸린다. */
  description?: string;
  /** 본문 앞머리 (예: 터미널에서 실제로 친 명령들). */
  body?: string;
}

export type AgentContextIntent =
  /** 존 3 제안 인박스로 데려간다 (승격 후보를 보러). */
  | { kind: "inbox" }
  | { kind: "createRule"; seed?: RuleSeed }
  | { kind: "createSkill"; seed?: SkillSeed };

const slot = createIntentSlot<AgentContextIntent>("oculpm:open-agent-context");

/** 화면을 열어달라고 요청한다. */
export function requestAgentContext(intent: AgentContextIntent): void {
  slot.request(intent);
}

/** 화면 마운트 시 한 번 — 대기 중인 요청을 회수한다. */
export function consumeAgentContextIntent(): AgentContextIntent | null {
  return slot.consume();
}

/** 셸이 화면을 옮기는 동안 요청을 이벤트 없이 다시 붙들어 둔다. */
export function holdAgentContextIntent(intent: AgentContextIntent): void {
  slot.hold(intent);
}

/** 이미 마운트된 화면·셸용 구독. */
export function onAgentContextRequest(fn: (intent: AgentContextIntent) => void): () => void {
  return slot.subscribe((intent) => {
    if (intent) fn(intent);
  });
}

/** 테스트 전용 — 모듈 스코프 플래그 초기화. */
export function _resetAgentContextIntent(): void {
  slot.reset();
}
