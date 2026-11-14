/**
 * 계획 — 완료 조건이 참인가를 사람이 3분 안에 본다 (4.0 `{#ui-planner}`, 시안 Plan).
 *
 *   왼쪽 --panel-w  진행 중 계획(진척 · 판정) + 끝난 계획 한 줄 (일지 목록 칸과 같은 폭)
 *   오른쪽          메타 · 제목 · 완료 조건/확인 명령/마지막 결과 · 다음 · 단계 격자 · 계획 기록
 *
 * 계획은 에이전트가 쓴다. 사람이 여기서 하는 일은 판정을 보고, 다음 항목을 프롬프트로
 * 넘기고, 필요하면 항목 상태를 바꾸는 것뿐이다. 앱 안 LLM 갱신은 4.0 에서 사라졌다.
 *
 * 키 (11-15) — 화면 컨테이너가 듣는다(전역 keydown 아님): j/k 항목 사이 · [ ] 계획 사이 · Enter 상태 메뉴
 * (메뉴에서 1~6) · r 다음 할 일 실행. 예전엔 단축키가 하나도 없었다.
 */

import { useEffect, useRef, useState } from "react";

import { toAppError } from "@/api/invoke";
import { planApi } from "@/api/plan";
import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { TriangleAlert } from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { AppDialog } from "@/components/ui/AppDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { PlanItemDto } from "@/lib/bindings";
import { readChord } from "@/lib/kbd";
import { toast } from "@/lib/toast";
import { runCheckInTerminal } from "@/features/terminal/runCheck";
import { runGoalInTerminal, runPromptInTerminal } from "@/features/terminal/runPrompt";
import { goalCommand } from "./goal";
import { CarryInbox } from "./CarryInbox";
import { CheckRunDialog } from "./CheckRunDialog";
import { PlanDoc } from "./PlanDoc";
import { itemBoxes, refocusItem } from "./PlanItems";
import { PlanRail } from "./PlanRail";
import { railOrder } from "./planList";
import { nextLeaf } from "./planMeta";
import { usePlanDocument } from "./usePlanDocument";
import "./planner.css";

/** 계획이 하나도 없을 때 터미널의 claude 에게 넘기는 것 — 플러그인의 「새 계획 세우기」 스킬. */
export const INCEPTION_PROMPT = "/oculpm:inception";

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
  const { detail, selectedId, locked, busy } = plan;
  const bodyRef = useRef<HTMLDivElement>(null);
  // 화면에 들어오면 본문이 키를 받게 한다 — 윗줄 탭을 누르고 들어와도 바로 j/k 가 먹는다.
  useEffect(() => {
    const el = document.activeElement as HTMLElement | null;
    const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    if (!typing) bodyRef.current?.focus({ preventScroll: true });
  }, []);

  // 완료 소프트 게이트 (PR-CI6) — 연결된 검증 일지 없이 완료로 바꾸려 하면 한 번 묻는다.
  // 막지는 않는다: 「검증 없이 완료」를 누르면 그대로 간다.
  const [confirmDone, setConfirmDone] = useState<PlanItemDto | null>(null);
  const applyStatus = (item: PlanItemDto, status: string) => {
    if (busy) return;
    if (status === "done" && item.status !== "done" && item.journal_refs.length === 0) {
      setConfirmDone(item);
      return;
    }
    void plan.setStatus(item, status);
  };
  // 확인 상자를 닫는다(취소 · Esc · 「검증 없이 완료」). 포커스는 그 항목의 상자로 — 상자가 그대로면 대화상자가
  // 기억한 곳(상자)으로 돌아가고, 완료로 단계가 접혀 상자가 사라졌으면 같은 자리의 상자로(`refocusItem`).
  const closeConfirm = (apply: boolean) => {
    const item = confirmDone;
    if (!item) return;
    refocusItem(bodyRef.current, item.item_id);
    setConfirmDone(null);
    if (apply) void plan.setStatus(item, "done");
  };

  // 다음 항목 넘기기 — 백엔드가 프롬프트를 조립하고, 앱 안 터미널의 새 세션이 claude 로 돌린다
  // (클립보드 경로는 터미널이 돌아오며 걷었다). 계획 id 는 **보이는 문서의 것** — 고른 id 는 다른 계획을
  // 읽는 중일 수 있다(그동안 단추는 막혀 있다). 끝나기 전에 다시 부르면(r 을 누르고 있거나 두 번 침) 무시한다 —
  // 터미널로 넘어가기 전에 claude 세션이 여러 개 열렸다.
  const running = useRef(false);
  const runPrompt = async (item: PlanItemDto, untilDone: boolean) => {
    if (detail == null || busy || running.current) return;
    running.current = true;
    const planId = detail.plan.plan_id;
    try {
      // 「끝까지」 — 완료 조건 · 확인 명령이 있으면 Claude Code 의 /goal 로 (ocul-next #goal).
      const goal = untilDone ? goalCommand(t, planId, detail.done_when, detail.check) : null;
      if (goal) {
        if (!(await runGoalInTerminal(projectId, goal))) {
          void navigator.clipboard?.writeText(goal).catch(() => {});
          toast.warning(t("plan.goal.notReady"), { durationMs: 15000 });
        }
        return;
      }
      const res = await planApi.dispatchPrompt(projectId, planId, item.item_id);
      const text = untilDone ? `${res.prompt}\n\n${t("plan.nextRow.untilDoneSuffix")}` : res.prompt;
      await runPromptInTerminal(projectId, text);
    } catch (e) {
      toast.destructive(t("plan.dispatchFailed", { error: tError(toAppError(e)) }));
    } finally {
      running.current = false;
    }
  };

  // 확인 명령을 셸에서 (X-02, 11-15 「누를 때만 돌리기」) — 판정 카드의 단추가 거른 한 줄을 넘기면 여기서 묻고,
  // 「돌리기」 를 눌러야만 새 셸 세션을 연다. 취소 · Esc 면 아무것도 쓰지 않는다.
  const [checkLine, setCheckLine] = useState<string | null>(null);
  const runCheck = (line: string) => {
    setCheckLine(null);
    void runCheckInTerminal(projectId, line).catch((e) =>
      toast.destructive(t("plan.check.failed", { error: tError(toAppError(e)) })),
    );
  };

  // plan-log 의 일지 열은 `.oculpm/` 기준이다 — 일지 화면은 일지 루트 기준으로 연다.
  const openJournal = (ref: string) => {
    const path = ref.replace(/^\.oculpm\//, "").replace(/^journal\//, "");
    if (onOpenJournal) onOpenJournal(path);
    else onNavigate("journal");
  };

  // 계획이 없을 때의 한 길 — 터미널의 claude 에게 「새 계획 세우기」 를 넘긴다(채운 단추는 화면에 하나).
  const startPlan = () => {
    void runPromptInTerminal(projectId, INCEPTION_PROMPT).catch((e) =>
      toast.destructive(t("plan.dispatchFailed", { error: tError(toAppError(e)) })),
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const chord = readChord(e);
    if (chord.mod || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
    // 메뉴 · 대화상자 안의 키는 그쪽 것이다.
    if (el.closest('[role="menu"], [role="dialog"]')) return;
    const key = chord.key;
    const root = bodyRef.current;
    if (!root) return;
    if (key === "j" || key === "k") {
      // 항목 사이 — 보이는 상태 상자를 문서 순서대로(접힌 끝난 단계 안은 없다).
      const boxes = itemBoxes(root);
      if (boxes.length === 0) return;
      e.preventDefault();
      const at = boxes.indexOf(document.activeElement as HTMLButtonElement);
      const next = at < 0 ? (key === "j" ? 0 : boxes.length - 1) : Math.min(Math.max(at + (key === "j" ? 1 : -1), 0), boxes.length - 1);
      boxes[next].focus();
      boxes[next].scrollIntoView?.({ block: "nearest" });
    } else if (key === "[" || key === "]") {
      // 계획 사이 — 레일 순서(진행 중 → 끝난) 그대로.
      if (!plan.plans || plan.plans.length === 0) return;
      e.preventDefault();
      const { active, closed } = railOrder(plan.plans);
      const order = [...active, ...closed];
      const at = order.findIndex((p) => p.plan_id === selectedId);
      const next = order[Math.min(Math.max(at + (key === "]" ? 1 : -1), 0), order.length - 1)];
      if (next) plan.select(next.plan_id);
    } else if (key === "Enter" && el.classList.contains("plv-box-btn")) {
      // 상태 메뉴 — 단추의 기본 클릭을 막고(두 번 열고 닫히지 않게) 한 번만 연다.
      e.preventDefault();
      if (el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled) return;
      el.click();
    } else if (key === "r") {
      // 누르고 있으면 되풀이되는 키다 — 한 번만 돈다.
      if (e.repeat) return;
      const next = detail && !locked ? nextLeaf(detail.items) : null;
      if (!next || busy) return;
      e.preventDefault();
      void runPrompt(next, false);
    }
  };

  let main;
  if (plan.error) {
    main = <ErrorCard title={t("plan.error")} error={plan.error} onRetry={plan.retry} />;
  } else if (plan.plans == null) {
    main = <SkeletonList rows={4} height={36} gap={10} />;
  } else if (detail == null) {
    main = plan.loadingDetail ? <SkeletonList rows={6} height={30} gap={8} /> : null;
  } else {
    main = (
      <>
        {/* 조용한 갱신이 실패했다 — 마지막 문서는 그대로 두고 한 줄만 말한다. */}
        {plan.stale ? (
          <p className="plv-meta plv-stale" role="status">
            <span className="chip sm warn">{t("plan.staleRead")}</span>{" "}
            <button type="button" className="btn ghost sm" onClick={plan.retry}>
              {t("plan.retry")}
            </button>
          </p>
        ) : null}
        <PlanDoc
          projectId={projectId}
          detail={detail}
          locked={locked}
          busy={busy}
          onSetStatus={applyStatus}
          onRun={(item) => void runPrompt(item, false)}
          onRunUntilDone={(item) => void runPrompt(item, true)}
          onClose={() => void plan.close()}
          onOpenJournal={openJournal}
          onRunCheck={setCheckLine}
        />
        {/* 닫힌 계획에 갇힌 미완 — 고른 진행 중 계획으로 옮긴다 (없으면 그리지 않는다). */}
        <CarryInbox projectId={projectId} selectedId={detail.plan.plan_id} selectedLocked={locked || busy} onMoved={plan.refreshDetail} />
      </>
    );
  }

  // 「계획이 없다」 는 목록을 받아서 0 개일 때만 — 못 읽은 목록은 `plans` 가 null 로 남는다(usePlanDocument).
  const empty = !plan.error && plan.plans != null && plan.plans.length === 0;

  return (
    <>
      <Toolbar title={t("nav.planner")} find />
      <div className="plv-body" ref={bodyRef} tabIndex={-1} onKeyDown={onKeyDown}>
        {empty ? (
          // 계획이 없으면 막다른 문장이 아니라 한 길 — 본문 바탕 · 본문 왼쪽 선에서, 레일 없이 (일지 빈 화면과
          // 같은 자리 · 같은 꼴). 예전엔 한 단 밝은 문서 칸(--bg-card) 안에 문장만 있었다.
          <div className="scroll">
            <div className="page">
              <EmptyState
                density="rich"
                actions={
                  <button type="button" className="btn primary" onClick={startPlan}>
                    {t("plan.emptyStart")}
                  </button>
                }
              >
                {t("plan.emptyAgents")}
              </EmptyState>
            </div>
          </div>
        ) : (
          <>
            {plan.plans && plan.plans.length > 0 ? (
              <PlanRail plans={plan.plans} selectedId={selectedId} onSelect={plan.select} />
            ) : null}
            <div className="plv-main">{main}</div>
          </>
        )}
      </div>

      <AppDialog open={confirmDone != null} onClose={() => closeConfirm(false)} label={t("plan.confirmDoneTitle")} width={480}>
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
              <button type="button" className="btn sm" onClick={() => closeConfirm(false)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn primary sm" onClick={() => closeConfirm(true)}>
                {t("plan.confirmDoneAction")}
              </button>
            </div>
          </>
        ) : null}
      </AppDialog>
      <CheckRunDialog line={checkLine} onCancel={() => setCheckLine(null)} onRun={runCheck} />
    </>
  );
}
