/**
 * 계획의 「끝까지」를 Claude Code 의 `/goal <조건>` 으로 (ocul-next #goal). 조건은 계획 파일의
 * 완료 조건과 확인 명령 그대로다 — Claude Code 가 턴마다 그 조건이 참인지 따로 판정한다.
 * 둘 다 없으면 판정할 것이 없어 `null`(부른 쪽은 예전처럼 「이어 가라」는 문장을 붙인다).
 */
import type { I18nKey, TVars } from "@/i18n";

type Tr = (key: I18nKey, vars?: TVars) => string;

/** `/goal` 조건의 한도(Claude Code 문서: 4000자). */
export const GOAL_MAX_CHARS = 4000;

export function goalCommand(tr: Tr, planId: string, doneWhen: string | null, check: string | null): string | null {
  const plan = `.oculpm/planner/${planId}.md`;
  const clean = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
  let when = clean(doneWhen);
  const cmd = clean(check);
  if (!when && !cmd) return null;
  const build = () =>
    when && cmd
      ? tr("plan.goal.both", { plan, doneWhen: when, check: cmd })
      : when
        ? tr("plan.goal.doneWhen", { plan, doneWhen: when })
        : tr("plan.goal.check", { plan, check: cmd });
  const full = build();
  if (full.length <= GOAL_MAX_CHARS) return `/goal ${full}`;
  // 완료 조건부터 줄인다 — 확인 명령은 판정의 근거라 자르지 않는다.
  when = `${when.slice(0, Math.max(0, when.length - (full.length - GOAL_MAX_CHARS) - 1))}…`;
  return `/goal ${build()}`;
}
