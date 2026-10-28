import { useEffect, useState } from "react";

import { ChevronRight } from "@/components/Icons";
import { agentLabel } from "@/features/today/agentColor";
import { useDensity } from "@/hooks/useDensity";
import { useT } from "@/i18n";
import type { PlanItemUpdateDto } from "@/lib/bindings";
import { planApi } from "@/api/plan";

/**
 * 「변경 로그 N행」 — 플랜 문서 끝의 plan-log 표 (시안 Planner).
 *
 * 간단 밀도에선 한 줄로 접힌 채 시작하고 전문은 표로 펼쳐진다. 행은 항목별 이력과 같은
 * 투영(`oculpm_plan_item_updates`)이고 플랜 단위로 한 번 읽는다 (`plan_log`).
 * 못 읽으면 「모름」 — 0행과 같은 얼굴을 하지 않는다.
 */
export function PlanLog({ projectId, planId, revision }: { projectId: number; planId: string; revision: string }) {
  const { t } = useT();
  const { density } = useDensity();
  const [rows, setRows] = useState<PlanItemUpdateDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void Promise.resolve()
      .then(() => planApi.log(projectId, planId))
      .then((res) => {
        if (!cancelled) setRows(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, planId, revision]);

  const count = rows?.length ?? 0;
  return (
    <details className="pln-log" open={density === "pro" || open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <ChevronRight size={11} className="nav-section-chev" aria-hidden="true" />
        <b>{failed ? t("plan.log.unknown") : t("plan.log.title", { n: count })}</b>
        <span>{t("plan.log.cols")}</span>
        <span className="hint">{t("plan.log.hint")}</span>
      </summary>
      {rows && rows.length > 0 ? (
        <table className="pln-log-table">
          <tbody>
            {rows.slice().reverse().map((r, i) => (
              <tr key={`${r.ts}-${r.item_id}-${i}`}>
                <td className="mono">{r.ts.replace("T", " ").slice(0, 16)}</td>
                <td className="mono">#{r.item_id}</td>
                <td>{agentLabel(r.agent_id)}</td>
                <td className="mono">{r.from_status ?? "·"} → {r.to_status ?? "·"}</td>
                <td className="pln-log-note">{r.note ?? ""}</td>
                <td className="mono">{r.journal_ref ? r.journal_ref.split("/").pop() : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : rows ? (
        <p className="pln-log-empty">{t("plan.log.empty")}</p>
      ) : null}
    </details>
  );
}
