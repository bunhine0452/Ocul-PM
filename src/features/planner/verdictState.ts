/**
 * 판정의 네 모습 — 통과 · 실패 · 통과 뒤 바뀜 · 여기선 아직 (11-15). React 없음.
 *
 * 오늘 화면(`todayModel` 의 verdict · stale · elsewhere 줄)과 계획 화면(레일 · 판정 카드)이 같은 계획을
 * 다른 상태로 그리지 않게 한 규칙을 둔다. 재료도 같다: 백엔드가 `today_digest` 와 `plan_list` · `plan_get`
 * 에 같은 계산(`digest::mark_stale`)으로 `stale_files` · `verdict_from` 을 싣는다. 예전 계획 화면은 이 둘을
 * 몰라, 오늘이 호박색 ✓ 로 짚는 계획을 회색 통과로 그렸다.
 */

import type { VerdictState } from "@/components/VerdictLine";
import type { PlanVerdict } from "@/lib/bindings";

/** `DigestPlan` 과 `PlanSummary` 가 같이 가진 판정 칸 — 둘 다 그대로 넘기면 된다. */
export interface VerdictInput {
  last_verdict?: PlanVerdict | null;
  stale_files?: readonly string[] | null;
  verdict_from?: string | null;
}

/** 판정이 없으면 `null`. 백엔드는 「통과 뒤 바뀜」 과 「여기선 아직」 을 겹쳐 주지 않는다. */
export function verdictStateOf(p: VerdictInput): VerdictState | null {
  const v = p.last_verdict;
  if (!v) return null;
  if (!v.passed) return "fail";
  if ((p.stale_files?.length ?? 0) > 0) return "stale";
  if (p.verdict_from) return "away";
  return "pass";
}

/**
 * 결과 끝 줄의 첫 숫자 토큰 — 레일 한 줄에 서는 것. 계획 넷이 모두 「✓ pnpm test …」 로 같았다: 명령
 * 이름은 계획마다 같고, 다른 것은 숫자다. 숫자가 없으면 끝 줄 그대로.
 */
export function railSummary(summary: string): string {
  const m = /\d[\d,.]*(?:\s+[^\s·,;]+)?/u.exec(summary);
  return m ? m[0] : summary;
}

/**
 * 확인 명령을 보이는 줄로 — `&&` · `;` 뒤에서 나눈다(복사는 원문 그대로). 한 줄로 흘리면 칸 끝에서
 * 낱말 한가운데가 끊겼다(`car` / `go`).
 */
export function checkLines(check: string): string[] {
  return check
    .split(/(?<=&&|;)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
