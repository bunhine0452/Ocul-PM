// ↑ 로 **보냈던 지시를 되부르는** 규칙 (순수 함수).
//
// CLI 의 히스토리 리콜과 같은 기대다: 빈 입력창에서 ↑ 를 치면 방금 보낸 말이
// 돌아오고, 더 치면 더 옛날로 간다. ↓ 는 반대로 — 끝까지 내려오면 recall 에
// 들어가기 전에 쓰다 만 글이 복원된다 (버리면 안 된다: 반쯤 쓴 지시문이
// ↑ 한 번에 사라지는 것이 최악의 결말이다).

export interface RecallState {
  /** 지금 보고 있는 프롬프트의 인덱스 (prompts 기준). */
  index: number;
  /** recall 에 들어오기 전에 쓰고 있던 초안 — ↓ 로 끝까지 내려오면 돌아온다. */
  stash: string;
}

export interface RecallStep {
  state: RecallState | null;
  /** 입력창에 넣을 값. */
  text: string;
}

/**
 * ↑ — 한 단계 과거로. 갈 곳이 없으면 `null` (입력창을 건드리지 않는다).
 *
 * recall 중이 아니면 가장 최근 프롬프트부터 시작하고, 그 순간의 초안을
 * `stash` 에 담아 둔다.
 */
export function recallBack(
  prompts: readonly string[],
  state: RecallState | null,
  draft: string,
): RecallStep | null {
  if (state === null) {
    if (!prompts.length) return null;
    const index = prompts.length - 1;
    return { state: { index, stash: draft }, text: prompts[index] };
  }
  if (state.index <= 0) return null;
  const index = state.index - 1;
  return { state: { ...state, index }, text: prompts[index] };
}

/**
 * ↓ — 한 단계 현재로. 가장 최근을 지나치면 recall 이 끝나고 초안이 돌아온다.
 * recall 중이 아니면 `null`.
 */
export function recallForward(
  prompts: readonly string[],
  state: RecallState | null,
): RecallStep | null {
  if (state === null) return null;
  const index = state.index + 1;
  if (index >= prompts.length) return { state: null, text: state.stash };
  return { state: { ...state, index }, text: prompts[index] };
}
