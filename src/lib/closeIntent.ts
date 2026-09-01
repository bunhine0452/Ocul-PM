// ⌘W 의 "안쪽부터 닫기" 사슬.
//
// 브라우저에서 ⌘W 는 늘 **가장 안쪽에 열린 것**을 닫는다. 우리 창도 그렇게
// 겹쳐 있다: 창 → 프로젝트 탭 → (Claude Code 화면이면) 세션 탭. 어느 것이
// 열려 있는지는 화면만 알기 때문에, Rust 가 곧장 탭을 닫는 대신 이 사슬에
// 먼저 묻는다.
//
// 순서·포커스 우선권 규칙은 `lib/intentChain` 이 소유한다 (⌘T 와 공유) —
// 사용자가 터미널에 타이핑하다 ⌘W 를 누르면 터미널이 닫혀야지, 뒤에 있던
// 화면의 탭이 닫히면 안 된다.

import { createIntentChain, type IntentHandler, type IntentScope } from "@/lib/intentChain";

const chain = createIntentChain();

/** 사슬에 넣는다. 반환값을 부르면 빠진다 (effect cleanup 에 그대로 쓴다). */
export function registerCloseHandler(handler: IntentHandler, scope?: IntentScope): () => void {
  return chain.register(handler, scope);
}

/** 안쪽부터 물어본다. 아무도 안 받으면 `false` — 부르는 쪽이 탭을 닫는다. */
export function runCloseIntent(): boolean {
  return chain.run();
}

/**
 * 탭을 정말 닫기 전에 창이 묻는 **문지기** (완성도 라운드 Phase 2, 2026-08-30).
 *
 * 위의 사슬이 "무엇을 닫을지" 라면 이쪽은 "닫아도 되는지" 다. 프로젝트 탭이
 * 자기 안에서 돌고 있는 일(포그라운드 명령이 있는 터미널 · 작업 중인 Claude
 * Code 세션)을 **알리기만** 하고, 확인 다이얼로그는 창이 띄운다 — 숨은 탭
 * 안의 다이얼로그는 보이지 않으므로 탭 스트립의 × 로 배경 탭을 닫을 때도 창
 * 층에서 물어야 한다.
 */
export interface TabRunningWork {
  /** 포그라운드 명령 이름 (프롬프트에 멈춘 셸은 세지 않는다). */
  foreground: string[];
  /** 턴이 도는 중인 Claude Code 세션 수. */
  agents: number;
}

type TabCloseGuard = () => Promise<TabRunningWork>;

const tabGuards = new Map<number, TabCloseGuard>();

/** 탭 id 하나에 문지기 하나. 반환값은 해제 (effect cleanup). */
export function registerTabCloseGuard(tabId: number, guard: TabCloseGuard): () => void {
  tabGuards.set(tabId, guard);
  return () => {
    if (tabGuards.get(tabId) === guard) tabGuards.delete(tabId);
  };
}

/** 문지기가 없거나(시작 탭) 실패하면 `null` — 그냥 닫는다. */
export async function runTabCloseGuard(tabId: number): Promise<TabRunningWork | null> {
  const guard = tabGuards.get(tabId);
  if (!guard) return null;
  try {
    return await guard();
  } catch {
    return null;
  }
}

export function hasRunningWork(work: TabRunningWork | null): work is TabRunningWork {
  return work != null && (work.foreground.length > 0 || work.agents > 0);
}
