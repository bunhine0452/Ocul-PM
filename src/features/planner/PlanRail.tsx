/**
 * 계획 레일 (260px) — 진행 중인 계획과 그 판정, 끝난 계획은 한 줄로 접힌다.
 */

import { ChevronRight } from "@/components/Icons";
import { whenLabel } from "@/lib/whenLabel";
import { useT } from "@/i18n";
import type { PlanSummary } from "@/lib/bindings";
import { railOrder } from "./planList";

function RailRow({ plan, selected, onSelect }: { plan: PlanSummary; selected: boolean; onSelect: () => void }) {
  const { t } = useT();
  const pct = plan.item_count > 0 ? Math.round((plan.done_count / plan.item_count) * 100) : 0;
  const v = plan.last_verdict;
  return (
    <li>
      <button type="button" className="plv-li" aria-current={selected ? "true" : undefined} onClick={onSelect}>
        <span className="plv-li-r1">
          <span className="plv-li-title">{plan.title}</span>
          <span className="plv-meta mono">
            {plan.done_count}/{plan.item_count}
          </span>
        </span>
        <span className="plv-bar" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="plv-meta">
          {v ? (
            <>
              {t("plan.list.verdict")} <span className={v.passed ? "plv-ok" : "plv-bad"}>{v.passed ? "✓" : "✗"}</span>
              {" · "}
              {whenLabel(v.ts)}
            </>
          ) : (
            t("plan.list.noVerdict")
          )}
        </span>
      </button>
    </li>
  );
}

export function PlanRail({
  plans,
  selectedId,
  onSelect,
}: {
  plans: PlanSummary[];
  selectedId: string | null;
  onSelect: (planId: string) => void;
}) {
  const { t } = useT();
  const { active, closed } = railOrder(plans);
  const closedHasSelection = closed.some((p) => p.plan_id === selectedId);
  return (
    <nav className="plv-rail" aria-label={t("plan.list.aria")}>
      <div className="plv-rail-h">{t("plan.list.active", { n: active.length })}</div>
      <ul className="plv-rail-list">
        {active.map((p) => (
          <RailRow key={p.plan_id} plan={p} selected={p.plan_id === selectedId} onSelect={() => onSelect(p.plan_id)} />
        ))}
      </ul>
      {closed.length > 0 ? (
        <details className="plv-closed" open={closedHasSelection || undefined}>
          <summary className="plv-rail-h">
            <ChevronRight size={11} className="plv-closed-chev" aria-hidden="true" />
            {t("plan.list.closed", { n: closed.length })}
          </summary>
          <ul className="plv-rail-list">
            {closed.map((p) => (
              <RailRow key={p.plan_id} plan={p} selected={p.plan_id === selectedId} onSelect={() => onSelect(p.plan_id)} />
            ))}
          </ul>
        </details>
      ) : null}
    </nav>
  );
}
