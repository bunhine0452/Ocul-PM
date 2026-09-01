// ⌘T 의 "안쪽부터 열기" 사슬 (2026-09-01).
//
// ⌘W 와 완전히 같은 사정이다: `⌘T` 는 앱 메뉴의 액셀러레이터라(menu.rs
// `ACC_NEW_TAB`) macOS 가 웹뷰보다 먼저 소비한다 — 터미널이 걸어 둔 keydown
// 분기는 한 번도 돌지 않았고, 셸에 타이핑하다 ⌘T 를 눌러도 **프로젝트 탭**이
// 새로 열렸다. 치트시트는 "⌘T = 터미널 새 탭" 이라고 적어 두고 있었으니
// 약속만 남고 동작이 없던 셈이다.
//
// 그래서 Rust 는 `NewTabIntent` 만 쏘고, 무엇이 열려 있는지 아는 프런트가
// 대상을 고른다: 포커스가 터미널 안이면 **터미널 탭**, 아니면 창이 평소대로
// 프로젝트 탭을 연다.

import { createIntentChain, type IntentHandler, type IntentScope } from "@/lib/intentChain";

const chain = createIntentChain();

/** 사슬에 넣는다. 반환값을 부르면 빠진다 (effect cleanup 에 그대로 쓴다). */
export function registerNewTabHandler(handler: IntentHandler, scope?: IntentScope): () => void {
  return chain.register(handler, scope);
}

/** 안쪽부터 물어본다. 아무도 안 받으면 `false` — 창이 프로젝트 탭을 연다. */
export function runNewTabIntent(): boolean {
  return chain.run();
}
