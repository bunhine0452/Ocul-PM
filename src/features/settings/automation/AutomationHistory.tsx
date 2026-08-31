// 실행 기록 — `automation_runs` 를 시각 역순으로.
//
// **드롭·스킵도 보인다.** 안 돈 이유를 모르는 것이 자동화 디버깅에서 가장
// 나쁜 상태이고, 그래서 러너가 모든 결말을 원장에 남긴다.

import { useT } from "@/i18n";
import type { AutomationRunDto } from "@/lib/bindings";
import { NAV_BUS, type OpenEntityDetail } from "@/lib/navRegistry";
import { formatAt } from "./automationModel";

/** 상태별 칩 색. 성공/실패만 색을 쓰고 나머지는 중립이다. */
function chipClass(status: string): string {
  if (status === "ok") return "chip ok";
  if (status === "failed") return "chip warn";
  return "chip";
}

export function AutomationHistory({
  runs,
  loading,
}: {
  runs: AutomationRunDto[];
  loading: boolean;
}) {
  const { t } = useT();

  if (loading) return <p className="empty-hint">{t("common.loading")}</p>;
  if (runs.length === 0) return <p className="empty-hint">{t("automation.history.empty")}</p>;

  const openJournal = (path: string) => {
    const detail: OpenEntityDetail = { kind: "journal", id: path };
    window.dispatchEvent(new CustomEvent(NAV_BUS.openEntity, { detail }));
  };

  return (
    <ul className="space-y-2">
      {runs.map((run) => (
        <li key={run.id} className="rounded-md border border-border/60 px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={chipClass(run.status)}>
              {t(`automation.status.${run.status}` as never)}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatAt(run.started_at) ?? run.started_at}
            </span>
            <span className="text-[11px] text-muted-foreground/70 font-mono">
              {run.automation_id}
            </span>
            {run.journal_path && (
              <button
                className="text-[11px] text-primary hover:underline cursor-pointer ml-auto"
                onClick={() => openJournal(run.journal_path as string)}
              >
                {t("automation.history.openJournal")}
              </button>
            )}
          </div>
          {run.note && (
            <p className="text-[11px] text-muted-foreground mt-1 whitespace-pre-wrap">
              {run.note}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
