/**
 * "프롬프트 복사" — 이 문제 해결 문서를 **바로 읽고 논의를 시작하라**는 지시문
 * 조립. 사용자가 복사해 외부 에이전트(Claude Code·Cursor·Gemini CLI)에 붙여
 * 넣는다.
 *
 * ## 왜 `tc()` 인가 (UI 언어가 아니라 작성 언어)
 *
 * 이 프롬프트를 읽은 에이전트가 그 언어로 문서를 이어 쓴다 — 즉 여기 언어가
 * 곧 `.oculpm/discussion/**` 에 남는 언어다. `plan_dispatch_prompt` 와 같은
 * 축이고, 03-i18n.md §4.5 가 "사용자가 복사해 외부 에이전트에 붙여넣는
 * 프롬프트는 본문도 번역 대상" 이라고 이름을 집어 지목한 예외다.
 *
 * ## 왜 문서 내용을 안 싣나
 *
 * 경로만 준다. 에이전트가 파일을 직접 읽으면 항상 최신이고, 붙여넣기 한 덩이가
 * 짧아 어떤 도구에서도 안전하다 (본문을 실으면 그 순간의 스냅샷이 굳는다).
 */
import { tc, type I18nKey } from "@/i18n";
import type { DiscussionDetail } from "@/lib/bindings";

/** 에이전트가 규격을 확인하는 on-demand 규격서 (AGENTS.md §5 가 가리킨다). */
export const DISCUSSION_SPEC_PATH = ".oculpm/agents/discussion-spec.md";

/** 문서의 지금 단계 — 붙여넣을 지시문이 달라진다. */
export type PromptKind = "draft" | "discuss" | "implement";

/**
 * 단계 판정: 아직 문제 정의가 비었으면 *같이 채우기*, 열려 있으면 *논의*,
 * 닫혔으면 *결론 실행*.
 */
export function promptKindFor(detail: DiscussionDetail): PromptKind {
  if (detail.discussion.status !== "open") return "implement";
  return detail.problem.trim() ? "discuss" : "draft";
}

const KEY: Record<PromptKind, I18nKey> = {
  draft: "disc.prompt.draft",
  discuss: "disc.prompt.discuss",
  implement: "disc.prompt.implement",
};

/** 클립보드에 담을 최종 지시문. */
export function buildDiscussionPrompt(detail: DiscussionDetail, kind = promptKindFor(detail)): string {
  return tc(KEY[kind], {
    path: detail.discussion.file_path,
    title: detail.discussion.title,
    spec: DISCUSSION_SPEC_PATH,
  }).trim();
}
