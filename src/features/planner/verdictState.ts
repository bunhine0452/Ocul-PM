/**
 * 판정의 네 모습 — 통과 · 실패 · 통과 뒤 바뀜 · 여기선 아직 (11-15). React 없음.
 *
 * 오늘 화면(`todayModel` 의 verdict · stale · elsewhere 줄)과 계획 화면(레일 · 판정 카드)이 같은 계획을
 * 다른 상태로 그리지 않게 한 규칙을 둔다. 재료도 같다: 백엔드가 `today_digest` 와 `plan_list` · `plan_get`
 * 에 같은 계산(`digest::mark_stale`)으로 `stale_files` · `verdict_from` 을 싣는다. 예전 계획 화면은 이 둘을
 * 몰라, 오늘이 호박색 ✓ 로 짚는 계획을 회색 통과로 그렸다.
 */

import type { VerdictState } from "@/components/VerdictLine";
import { osLabel } from "@/features/today/todayModel";
import { t } from "@/i18n";
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

/** 「통과 뒤 바뀜」 · 「여기선 아직」 의 아래 줄 — 그릴 문장과 그 안의 기계 글씨 하나, 툴팁의 전문. */
export interface VerdictSub {
  text: string;
  /** 문장 안의 첫 파일 경로 — 고정폭으로 그린다(영수증 규칙 2). 없으면 `null`. */
  mono: string | null;
  /** 바뀐 파일을 「외 N」 으로 줄이지 않은 전문. */
  full: string;
}

/**
 * 아래 줄 한 벌 (11-15 RC-17) — 오늘 행과 계획 판정 카드가 같은 문장을 쓴다. 오늘은 「그 뒤 바뀜 {파일}」 ·
 * 「이 기기에선 아직」, 계획은 「통과 뒤 바뀐 파일 {수}」 · 「여기선 아직」 이라 같은 상태가 두 화면에서 다른
 * 말이었다. 바뀐 파일은 첫 파일 + 「외 N」 — 수만으로는 무엇이 바뀌었는지 모른다.
 */
export function verdictSub(state: VerdictState | null, p: VerdictInput): VerdictSub | null {
  if (state === "stale") {
    const files = p.stale_files ?? [];
    const [first = "", ...rest] = files;
    const shown = rest.length > 0 ? t("today.check.moreFiles", { first, n: rest.length }) : first;
    return {
      text: t("state.verdict.staleSub", { files: shown }),
      mono: first || null,
      full: t("state.verdict.staleSub", { files: files.join(", ") }),
    };
  }
  if (state === "away" && p.verdict_from) {
    const text = t("state.verdict.awaySub", { os: osLabel(p.verdict_from) });
    return { text, mono: null, full: text };
  }
  return null;
}

/**
 * 레일 한 줄에 서는 결과 — 끝 줄의 「N passed」 · 「N failed」. 계획 넷이 모두 「✓ pnpm test …」 로 같았다:
 * 명령 이름은 계획마다 같고, 다른 것은 통과 · 실패 수다. 그 꼴이 없으면 끝 줄 그대로(칸 끝에서 말줄임되고
 * 전부는 툴팁에). 끝 줄 전체는 판정 카드에 늘 있다. 예전의 「첫 숫자 + 다음 낱말」 은 실제 끝 줄에서
 * 「77 files」 · 「116 CI」 · 「0 (1146」 · 「40818745181 completed」 같은 뜻 없는 조각을 세웠다.
 */
export function railSummary(summary: string): string {
  const m = /\d[\d,]*\s+(?:passed|failed)\b/iu.exec(summary);
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
