// 실행 기록 — `automation_runs` 를 시각 역순으로.
//
// **드롭·스킵도 보인다.** 안 돈 이유를 모르는 것이 자동화 디버깅에서 가장
// 나쁜 상태이고, 그래서 러너가 모든 결말을 원장에 남긴다.
//
// 조건 미충족은 스킵의 한 갈래인데 **성격이 다르다** ({#automation-step-if}):
// 고장이 아니라 설계대로 안 돈 것이다. 그래서 칩을 따로 세워 「조건 미충족」
// 이라고 적는다 — 「건너뜀」만 보이면 사용자가 고칠 것을 찾아 헤맨다. 관측값이
// 붙은 사유는 그 아래 메모 줄이 그대로 보여 준다.

import { useT } from "@/i18n";
import type { AutomationRunDto } from "@/lib/bindings";
import { NAV_BUS, type OpenEntityDetail } from "@/lib/navRegistry";
import { formatAt } from "./automationModel";

/** 상태별 칩 색. 성공/실패만 색을 쓰고 나머지는 중립이다. */
function chipClass(status: string): string {
  if (status === "ok") return "chip ok";
  if (status === "failed") return "chip warn";
  // 연기는 실패가 아니다 (Phase 7) — 경고색을 쓰지 않는다.
  if (status === "deferred") return "chip";
  return "chip";
}

/**
 * 조건 미충족으로 건너뛴 실행인가 ({#automation-step-if}).
 *
 * 러너가 `RUN_SKIPPED` 로 남기고 사유 앞머리에 「조건 미충족」/「조건을 읽지
 * 못했다」를 적는다 — 그 문구가 크로스-언어 계약이다 (백엔드
 * `conditions::first_unmet` 이 소유).
 */
export function isConditionSkip(run: { status: string; note: string | null }): boolean {
  if (run.status !== "skipped" || !run.note) return false;
  // 러너가 사연(「manual run」 등)을 앞에 붙일 수 있어 접두 비교가 아니라 포함이다.
  return CONDITION_NOTE_MARKERS.some((m) => run.note?.includes(m));
}

/**
 * 백엔드 `conditions::first_unmet` 이 만드는 사유의 머리말. **크로스-언어
 * 계약**이라 양쪽에 테스트가 있다 (`runner/tests.rs` 가 이 문구를 단언하고,
 * `src/__tests__/automation_egress_conditions.test.tsx` 가 이 목록을 단언한다).
 * 바뀌면 칩이 무증상으로 「건너뜀」으로 되돌아간다.
 */
// i18n-ignore-next-line -- 표시 문자열이 아니라 백엔드 원장 메모와의 대조 패턴이다.
export const CONDITION_NOTE_MARKERS = ["조건 미충족", "조건을 읽지 못했다"] as const;

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
              {isConditionSkip(run)
                ? t("automation.status.skippedByCondition")
                : t(`automation.status.${run.status}` as never)}
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
