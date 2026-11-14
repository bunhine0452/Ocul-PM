/**
 * 계획 레일 — 진행 중인 계획과 그 판정, 끝난 계획은 접힌 한 줄(펼치면 달마다).
 *
 * 폭은 일지 목록 칸과 같은 `--panel-w` 다(11-15) — 탭을 바꿀 때 문서 제목이 옆으로 뛰지 않게.
 * 판정 줄은 오늘 화면과 같은 네 모습(`verdictStateOf`)이고, 끝 줄은 「N passed」 · 「N failed」 만(`railSummary`)
 * — 계획 넷이 모두 「✓ pnpm test …」 로 같은 줄을 세우던 것을 걷었다. 끝 줄 전체는 판정 카드에 있다.
 */

import { useEffect, useMemo, useState } from "react";
import { Disclosure } from "@/components/Disclosure";
import { VerdictLine } from "@/components/VerdictLine";
import { whenLabel } from "@/lib/whenLabel";
import { getLang, useT } from "@/i18n";
import type { PlanSummary } from "@/lib/bindings";
import { railOrder } from "./planList";
import { railSummary, verdictStateOf } from "./verdictState";

function RailRow({ plan, selected, onSelect }: { plan: PlanSummary; selected: boolean; onSelect: () => void }) {
  const { t } = useT();
  const v = plan.last_verdict;
  const state = verdictStateOf(plan);
  return (
    <li>
      <button type="button" className="plv-li" aria-current={selected ? "true" : undefined} onClick={onSelect}>
        <span className="plv-li-r1">
          {/* 제목은 두 줄까지 — 한 줄로 자르면 비슷한 계획 이름이 같은 앞머리로 섰다. 전부는 title 에. */}
          <span className="plv-li-title" title={plan.title}>
            {plan.title}
          </span>
          <span className="plv-meta mono">
            {plan.done_count}/{plan.item_count}
          </span>
        </span>
        {v && state ? (
          <VerdictLine compact state={state} summary={railSummary(v.summary)} when={whenLabel(v.ts)} />
        ) : (
          <span className="plv-meta">{t("plan.list.noVerdict")}</span>
        )}
      </button>
    </li>
  );
}

/**
 * 끝난 계획을 달마다 — 최신 달 먼저(레일 순서 그대로). 달은 frontmatter `updated` 다: 닫기가 그날로 다시
 * 쓰므로(planner/lifecycle.rs) 끝난 계획에서는 닫은 달이다.
 */
function byMonth(plans: readonly PlanSummary[]): Array<{ key: string; label: string; plans: PlanSummary[] }> {
  const fmt = new Intl.DateTimeFormat(getLang(), { year: "numeric", month: "long" });
  const groups: Array<{ key: string; label: string; plans: PlanSummary[] }> = [];
  for (const p of plans) {
    const key = p.updated_at.slice(0, 7);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const ms = Date.parse(`${key}-01T00:00:00`);
      g = { key, label: Number.isNaN(ms) ? key || "—" : fmt.format(new Date(ms)), plans: [] };
      groups.push(g);
    }
    g.plans.push(p);
  }
  return groups;
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
  const [closedOpen, setClosedOpen] = useState(closedHasSelection);
  // 끝난 계획이 골라지면(팔레트 · 오늘에서 건너옴) 접힘을 연다 — 고른 것이 목록에 없으면 길을 잃는다.
  useEffect(() => {
    if (closedHasSelection) setClosedOpen(true);
  }, [closedHasSelection]);
  const months = useMemo(() => byMonth(closed), [closed]);
  return (
    <nav className="plv-rail" aria-label={t("plan.list.aria")}>
      <div className="plv-rail-h">{t("plan.list.active", { n: active.length })}</div>
      <ul className="plv-rail-list">
        {active.map((p) => (
          <RailRow key={p.plan_id} plan={p} selected={p.plan_id === selectedId} onSelect={() => onSelect(p.plan_id)} />
        ))}
      </ul>
      {closed.length > 0 ? (
        <Disclosure
          className="plv-closed"
          label={t("plan.list.closed", { n: closed.length })}
          open={closedOpen}
          onToggle={setClosedOpen}
        >
          {months.map((g) => (
            <div key={g.key} className="plv-month">
              <div className="plv-month-h">
                <span>{g.label}</span>
                <span className="plv-sec-n">{g.plans.length}</span>
              </div>
              <ul className="plv-rail-list">
                {g.plans.map((p) => (
                  <RailRow key={p.plan_id} plan={p} selected={p.plan_id === selectedId} onSelect={() => onSelect(p.plan_id)} />
                ))}
              </ul>
            </div>
          ))}
        </Disclosure>
      ) : null}
    </nav>
  );
}
