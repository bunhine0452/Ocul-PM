// 「다음」 · 「이어서 작업」 을 앱 안 터미널에서 실행한다 (4.0 터미널 복귀).
//
// 예전엔 프롬프트를 클립보드에 두고 사용자가 자기 터미널에 붙여 넣었다 — 터미널이 앱 안에
// 다시 들어오며 그 경로를 이것으로 바꿨다(범위 동결의 「대신 걷은 표면」). 새 세션의
// 로그인 셸에서 `claude "<프롬프트>"` 를 바로 치고 터미널 탭으로 간다.
//
// xterm 은 무겁다 — 오늘·계획 화면의 첫 청크에 싣지 않게 저장소를 여기서 지연 로드한다.

import { NAV_BUS } from "@/lib/navRegistry";

export async function runPromptInTerminal(projectId: number, prompt: string): Promise<void> {
  const { openTerm } = await import("./termStore");
  await openTerm(projectId, prompt);
  window.dispatchEvent(new CustomEvent(NAV_BUS.setView, { detail: "terminal" }));
}

/** 「끝까지」가 claude 의 입력 대기를 기다리는 한도 — 첫 실행(로그인 · 플러그인 로드)까지 넉넉히. */
export const GOAL_READY_MS = 60_000;

/**
 * 계획의 「끝까지」 — 새 세션에서 그냥 `claude` 를 띄우고, 입력 대기 신호(OSC 7501 idle)가 오면
 * `/goal <조건>` 을 넣는다. Claude Code 가 조건이 참이 될 때까지 턴마다 판정한다. 신호가 오지 않으면
 * (옛 Claude Code · 설치 안 됨) `false` — 부른 쪽이 그 문장을 사람에게 넘긴다.
 */
export async function runGoalInTerminal(projectId: number, goal: string): Promise<boolean> {
  const [{ openTerm, waitForTermStatus }, { deliverToSession }] = await Promise.all([
    import("./termStore"),
    import("./sendToClaude"),
  ]);
  const id = await openTerm(projectId, "");
  window.dispatchEvent(new CustomEvent(NAV_BUS.setView, { detail: "terminal" }));
  const ready = await waitForTermStatus(id, (s) => s?.state === "idle", GOAL_READY_MS);
  if (!ready) return false;
  await deliverToSession(id, goal);
  return true;
}
