import type { I18nKey } from "@/i18n";

// PR-ACP13 — 작업 중 상태 단어.
//
// "응답 대기 중…" 한 줄은 정확하지만 죽어 있다. 에이전트가 도는 동안은 **뭔가
// 일어나고 있다는 감각**이 필요한데, 스피너는 그 감각을 시간이 아니라 초조함으로
// 준다. 말이 한 글자씩 찍히면 기다림이 진행으로 읽힌다.
//
// 단어를 무작위로 고르지 않는 이유: 같은 화면을 두 번 보는 사람에게 매번 다른
// 말이 뜨면 "무슨 뜻이 있나" 하고 읽게 된다. 순서대로 돌면 배경이 된다.

/** 돌아가며 쓰는 말들. 뜻보다 리듬이 중요해 어미를 맞춘다. */
export const AGENT_WORD_KEYS = [
  "acp.word.making",
  "acp.word.forging",
  "acp.word.weaving",
  "acp.word.pondering",
  "acp.word.shaping",
  "acp.word.tuning",
  "acp.word.gathering",
  "acp.word.stitching",
  "acp.word.polishing",
  "acp.word.brewing",
] as const satisfies readonly I18nKey[];

/** `tick` 번째로 보여 줄 말의 키. 순환하므로 어떤 수를 넣어도 안전하다. */
export function wordKeyAt(tick: number): I18nKey {
  const at = ((tick % AGENT_WORD_KEYS.length) + AGENT_WORD_KEYS.length) % AGENT_WORD_KEYS.length;
  return AGENT_WORD_KEYS[at];
}

/**
 * `elapsedMs` 시점까지 찍힌 글자 수.
 *
 * 한 글자씩 찍고, 다 찍으면 잠깐 머문 뒤 다음 말로 넘어간다 — 그 "머무는 구간"이
 * 없으면 완성된 단어를 읽을 새가 없다.
 */
export function typedLength(elapsedMs: number, total: number, perCharMs = 55): number {
  if (total <= 0) return 0;
  const typed = Math.floor(Math.max(0, elapsedMs) / perCharMs);
  return Math.min(total, typed);
}

/** 한 단어가 화면에 머무는 총 시간(ms) — 타이핑 + 읽을 틈. */
export function wordDurationMs(length: number, perCharMs = 55, holdMs = 1400): number {
  return length * perCharMs + holdMs;
}
