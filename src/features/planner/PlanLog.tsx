import { useEffect, useState } from "react";

import { planApi } from "@/api/plan";
import { ChevronRight } from "@/components/Icons";
import { agentLabel } from "@/features/today/agentColor";
import { useT } from "@/i18n";
import type { PlanDecisionDto, PlanItemUpdateDto } from "@/lib/bindings";

/**
 * 「이력 N줄 · 결정 M」 — 계획 문서 끝의 plan-log 와 결정, 한 줄로 접힌 채 시작한다.
 * 0 인 쪽은 쓰지 않고, 둘 다 0 이면(또는 아직 읽는 중이면) 줄 자체를 세우지 않는다 (화면 검사 {#hide-zero}).
 *
 * 행은 항목별 이력과 같은 투영(`oculpm_plan_item_updates`)이고 계획 단위로 한 번
 * 읽는다 (`plan_log`). 못 읽으면 「모름」 — 0줄과 같은 얼굴을 하지 않는다.
 */
export function PlanLog({
  projectId,
  planId,
  revision,
  decisions,
}: {
  projectId: number;
  planId: string;
  /** 계획이 바뀐 신호 — 다시 읽는다. */
  revision: string;
  decisions: PlanDecisionDto[];
}) {
  const { t } = useT();
  const [rows, setRows] = useState<PlanItemUpdateDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void Promise.resolve()
      .then(() => planApi.log(projectId, planId))
      .then((res) => {
        if (!cancelled) setRows(res ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, planId, revision]);

  const parts = [
    rows && rows.length > 0 ? t("plan.log.rows", { n: rows.length }) : null,
    decisions.length > 0 ? t("plan.log.decisionCount", { n: decisions.length }) : null,
  ].filter(Boolean);
  if (!failed && parts.length === 0) return null;

  return (
    <details className="plv-log">
      <summary>
        <ChevronRight size={11} className="plv-log-chev" aria-hidden="true" />
        {failed ? t("plan.log.unknown") : parts.join(" · ")}
      </summary>
      {decisions.length > 0 ? (
        <section className="plv-log-sec" aria-label={t("plan.log.decisions")}>
          <h3>{t("plan.log.decisions")}</h3>
          <ul className="plv-decisions">
            {decisions.map((d) => (
              <li key={d.decision_id}>
                <b>{d.title}</b>
                {d.body ? <p>{d.body}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rows && rows.length > 0 ? (
        <table className="plv-log-table">
          <tbody>
            {rows
              .slice()
              .reverse()
              .map((r, i) => (
                <tr key={`${r.ts}-${r.item_id}-${i}`}>
                  <td className="mono">{r.ts.replace("T", " ").slice(0, 16)}</td>
                  <td className="mono">#{r.item_id}</td>
                  <td>{agentLabel(r.agent_id)}</td>
                  <td className="mono">
                    {r.from_status ?? "·"} → {r.to_status ?? "·"}
                  </td>
                  <td className="plv-log-note">{r.note ?? ""}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : rows ? (
        <p className="plv-log-empty">{t("plan.log.empty")}</p>
      ) : null}
    </details>
  );
}
