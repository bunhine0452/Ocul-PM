/**
 * 슬래시 결정적 주입 (Osaurus 라운드 Phase 5 `#slash-inject`).
 *
 * 매니페스트 + 온디맨드 로드는 **모델의 판단**에 기댄다. 모델이 안 꺼내면
 * 규칙 없이 답하고, 그 실패는 조용하다. 그래서 사용자가 **확정적으로** 밀어
 * 넣을 수 있는 경로가 하나 있어야 한다 — 검색이 유일한 경로면 안 된다(설계 §1.2).
 *
 * | 입력 | 주입 |
 * |---|---|
 * | `/rules` | AGENTS 마스터 **전문** |
 * | `/plan <id>` | 그 계획 전문 |
 * | `/journal <path>` | 그 일지 전문 |
 * | `/skill <name>` | 그 스킬 SKILL.md 전문 |
 *
 * 이번 턴에만 실리고 대화에 남지 않는다 — 매니페스트처럼 동결되는 것이 아니라
 * **한 번 쓰고 버리는** 블록이다.
 *
 * ACP 화면의 `acpSlash.ts` 와는 다른 표면이다 (그쪽은 어댑터가 광고하는 명령을
 * 어댑터에 넘긴다). 여기는 AI 패널이 직접 처리한다 — §0.1 대로 이 Phase 는
 * AI 패널만 대상으로 한다.
 */
import type { ContextRequest } from "./contextLoad";

/** 주입 명령 4종. 이름·인자 유무를 한 곳에 적는다. */
export const INJECT_COMMANDS = [
  { name: "rules", takesArg: false, labelKey: "ai.inject.rules" },
  { name: "plan", takesArg: true, labelKey: "ai.inject.plan" },
  { name: "journal", takesArg: true, labelKey: "ai.inject.journal" },
  { name: "skill", takesArg: true, labelKey: "ai.inject.skill" },
] as const;

export interface ParsedInject {
  /** `context_load` 로 넘길 요청. */
  request: Extract<ContextRequest, { type: "load" }>;
  /** 명령을 걷어낸 나머지 — 실제 질문. 비어 있을 수 있다. */
  question: string;
  /** 표시용 명령 이름. */
  name: string;
}

/**
 * 입력 **첫 줄**이 주입 명령인지. 아니면 `null`.
 *
 * 첫 줄만 보는 이유는 `acpSlash` 와 같다 — 문장 중간의 `and/or` 나 경로의
 * `src/lib` 를 명령으로 잡으면 안 된다. 명령 뒤의 나머지 줄은 질문으로 남는다.
 */
export function parseInject(draft: string): ParsedInject | null {
  if (!draft.startsWith("/")) return null;
  const newline = draft.indexOf("\n");
  const firstLine = (newline < 0 ? draft : draft.slice(0, newline)).trim();
  const rest = newline < 0 ? "" : draft.slice(newline + 1).trim();

  const space = firstLine.indexOf(" ");
  const name = (space < 0 ? firstLine.slice(1) : firstLine.slice(1, space)).toLowerCase();
  const arg = space < 0 ? "" : firstLine.slice(space + 1).trim();

  const spec = INJECT_COMMANDS.find((c) => c.name === name);
  if (!spec) return null;
  // 인자가 필요한데 없으면 명령으로 보지 않는다 — `/plan` 만 친 것은 아직
  // 타이핑 중이다 (목록이 떠 있어야 하는 상태).
  if (spec.takesArg && !arg) return null;

  const request: Extract<ContextRequest, { type: "load" }> =
    name === "rules"
      ? { type: "load", kind: "rules_master", id: "" }
      : name === "plan"
        ? { type: "load", kind: "plan", id: arg }
        : name === "journal"
          ? { type: "load", kind: "journal", id: arg }
          : { type: "load", kind: "skill", id: arg };

  return { request, question: rest, name };
}

/**
 * 명령만 치고 질문이 없을 때 대신 보낼 말.
 *
 * 빈 사용자 메시지를 보낼 수는 없고, "방금 넣은 것을 읽고 확인해 달라" 는 것이
 * 이 경우의 실제 의도다.
 */
export function defaultQuestionFor(name: string): string {
  // i18n-ignore-next-line -- LLM 프롬프트 본문 (03-i18n.md §4.5)
  return `방금 첨부한 ${name} 내용을 읽고, 지금 대화에 필요한 부분을 요약해 주세요.`;
}
