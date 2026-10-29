/**
 * 계획 — 완료 조건이 참인가를 사람이 3분 안에 본다 (4.0 `{#ui-planner}`, 시안 Plan).
 *
 *   왼쪽 260px  진행 중 계획(진척 · 판정) + 끝난 계획 한 줄
 *   오른쪽      메타 · 제목 · 완료 조건/확인 명령/마지막 판정 · 다음 · 단계 격자 · 갱신 기록
 *
 * 계획은 에이전트가 쓴다. 사람이 여기서 하는 일은 판정을 보고, 다음 항목을 프롬프트로
 * 넘기고, 필요하면 항목 상태를 바꾸는 것뿐이다. 앱 안 LLM 갱신은 4.0 에서 사라졌다.
 */

import { useState } from "react";

import { toAppError } from "@/api/invoke";
import { planApi } from "@/api/plan";
import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { TargetIcon, TriangleAlert } from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { AppDialog } from "@/components/ui/AppDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { PlanItemDto } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { runGoalInTerminal, runPromptInTerminal } from "@/features/terminal/runPrompt";
import { goalCommand } from "./goal";
import { CarryInbox } from "./CarryInbox";
import { PlanDoc } from "./PlanDoc";
import { PlanRail } from "./PlanRail";
import { usePlanDocument } from "./usePlanDocument";
import "./planner.css";

interface PlannerScreenV2Props {
  projectId: number;
  onNavigate: (view: UiV2View) => void;
  /** Open a specific journal entry (path relative to the journal root). */
  onOpenJournal?: (relativePath: string) => void;
}

export function PlannerScreenV2({ projectId, onNavigate, onOpenJournal }: PlannerScreenV2Props) {
  // 언어 전환 시 화면 전체를 다시 그린다.
  useT();
  const plan = usePlanDocument(projectId);
  const { detail, selectedId, locked } = plan;

  // 완료 소프트 게이트 (PR-CI6) — 연결된 검증 일지 없이 완료로 바꾸려 하면 한 번 묻는다.
  // 막지는 않는다: 「검증 없이 완료」를 누르면 그대로 간다.
  const [confirmDone, setConfirmDone] = useState<PlanItemDto | null>(null);
  const applyStatus = (item: PlanItemDto, status: string) => {
    if (status === "done" && item.status !== "done" && item.journal_refs.length === 0) {
      setConfirmDone(item);
      return;
    }
    void plan.setStatus(item, status);
  };

  // 다음 항목 넘기기 — 백엔드가 프롬프트를 조립하고, 앱 안 터미널의 새 세션이 claude 로 돌린다
  // (클립보드 경로는 터미널이 돌아오며 걷었다).
  const runPrompt = async (item: PlanItemDto, untilDone: boolean) => {
    if (selectedId == null) return;
    try {
      // 「끝까지」 — 완료 조건 · 확인 명령이 있으면 Claude Code 의 /goal 로 (ocul-next #goal).
      const goal = untilDone && detail ? goalCommand(t, selectedId, detail.done_when, detail.check) : null;
      if (goal) {
        if (!(await runGoalInTerminal(projectId, goal))) {
          void navigator.clipboard?.writeText(goal).catch(() => {});
          toast.warning(t("plan.goal.notReady"), { durationMs: 15000 });
        }
        return;
      }
      const res = await planApi.dispatchPrompt(projectId, selectedId, item.item_id);
      const text = untilDone ? `${res.prompt}\n\n${t("plan.nextRow.untilDoneSuffix")}` : res.prompt;
      await runPromptInTerminal(projectId, text);
    } catch (e) {
      toast.destructive(t("plan.dispatchFailed", { error: tError(toAppError(e)) }));
    }
  };

  // plan-log 의 일지 열은 `.oculpm/` 기준이다 — 일지 화면은 일지 루트 기준으로 연다.
  const openJournal = (ref: string) => {
    const path = ref.replace(/^\.oculpm\//, "").replace(/^journal\//, "");
    if (onOpenJournal) onOpenJournal(path);
    else onNavigate("journal");
  };

  let main;
  if (plan.error) {
    main = <ErrorCard title={t("plan.error")} error={plan.error} onRetry={plan.retry} />;
  } else if (plan.plans == null) {
    main = <SkeletonList rows={4} height={36} gap={10} />;
  } else if (plan.plans.length === 0) {
    main = (
      <EmptyState density="rich" icon={TargetIcon} title={t("plan.emptyTitle")}>
        {t("plan.emptyAgents")}
      </EmptyState>
    );
  } else if (detail == null) {
    main = plan.loadingDetail ? <SkeletonList rows={6} height={30} gap={8} /> : null;
  } else {
    main = (
      <>
        <PlanDoc
          projectId={projectId}
          detail={detail}
          locked={locked}
          onSetStatus={applyStatus}
          onRun={(item) => void runPrompt(item, false)}
          onRunUntilDone={(item) => void runPrompt(item, true)}
          onOpenJournal={openJournal}
        />
        {/* 닫힌 계획에 갇힌 미완 — 고른 활성 계획으로 옮긴다 (없으면 그리지 않는다). */}
        <CarryInbox
          projectId={projectId}
          selectedId={selectedId}
          selectedLocked={locked}
          onMoved={plan.refreshDetail}
          refreshKey={plan.plans.length}
        />
      </>
    );
  }

  return (
    <>
      <Toolbar title={t("nav.planner")} find />
      <div className="plv-body">
        {plan.plans && plan.plans.length > 0 ? (
          <PlanRail plans={plan.plans} selectedId={selectedId} onSelect={plan.select} />
        ) : null}
        <div className="plv-main">{main}</div>
      </div>

      <AppDialog open={confirmDone != null} onClose={() => setConfirmDone(null)} label={t("plan.confirmDoneTitle")} width={480}>
        {confirmDone ? (
          <>
            <div className="plv-confirm">
              <TriangleAlert size={18} className="plv-confirm-ico" />
              <div>
                <strong>{confirmDone.title}</strong> {t("plan.confirmDoneBody1")} <strong>{t("plan.confirmDoneBody2")}</strong>.
                <br />
                <span className="plv-meta">{t("plan.confirmDoneHint")}</span>
              </div>
            </div>
            <div className="plv-confirm-actions">
              <button type="button" className="btn sm" onClick={() => setConfirmDone(null)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn primary sm"
                onClick={() => {
                  const item = confirmDone;
                  setConfirmDone(null);
                  void plan.setStatus(item, "done");
                }}
              >
                {t("plan.confirmDoneAction")}
              </button>
            </div>
          </>
        ) : null}
      </AppDialog>
    </>
  );
}
