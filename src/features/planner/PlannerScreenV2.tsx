import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  Plus, TriangleAlert, RefreshCw, PanelLeft, PanelRight, TargetIcon,
} from "@/components/Icons";
import { commands, type PlanItemDto } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { handoffDispatch, terminalOnScreen } from "@/features/terminal/dispatchTarget";
import { SkeletonList } from "@/components/ui/Skeleton";
import { AppDialog } from "@/components/ui/AppDialog";
import { useTerminalSessions, useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { PlanRailDock, clampRailWidth } from "./PlanRailDock";
import type { PlanGroup, PlanSort } from "./planList";
import { t, useT } from "@/i18n";
import { PlanBody } from "./PlanBody";
import { usePlanDocument } from "./usePlanDocument";
import { blocked } from "@/lib/blocked";

// Planner Upgrade (PR-PLN 3) — document-style living checklist over the file
// `.oculpm/planner/*.md` SSOT. Reads via plan_list/plan_get; edits via
// plan_apply_edit (status cycle / add item) and plan_create. Per-item
// attribution chips reuse Today's agentColor. Legacy PlannerPanel untouched.
//
// 이 파일은 **배치와 UI 상태**만 갖는다 (분할 라운드 {#planner-diff-split}):
// 읽기·쓰기는 `usePlanDocument`, 문서 본문은 `PlanBody`, 단계 카드는
// `PhaseCard` 가 소유한다.

interface PlannerScreenV2Props {
  projectId: number;
  onNavigate: (view: UiV2View) => void;
  /** Open a specific journal entry (path relative to the journal root). */
  onOpenJournal?: (relativePath: string) => void;
}

export function PlannerScreenV2({ projectId, onNavigate, onOpenJournal }: PlannerScreenV2Props) {
  // 언어 전환 시 이 화면 전체가 다시 그려지도록 구독한다 (표시는 모듈 t 로도 되지만
  // 훅이 없으면 언어를 바꿔도 리렌더가 안 걸린다).
  useT();
  const { state, setState } = useWorkspace();
  const sessions = useTerminalSessions();
  const plan = usePlanDocument(projectId);
  const { detail, selectedId, busy, locked } = plan;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState("");
  const [composer, setComposer] = useState<{ phase: string; title: string } | null>(null);

  // 계획 레일 (2026-07-30 스케일 라운드). 검색어만 휘발 — 나머지는 영속.
  const [query, setQuery] = useState("");

  // PR-CI6 (EDD-lite) — 완료 소프트 게이트: plan-log 에 검증 일지가 연결되지
  // 않은 항목을 done 으로 바꾸려 하면 확인을 한 번 거친다. 소프트 — "검증
  // 없이 완료" 를 누르면 그대로 진행되고, 어떤 상태도 강제로 막지 않는다.
  const [confirmDone, setConfirmDone] = useState<PlanItemDto | null>(null);

  const applyStatus = async (item: PlanItemDto, status: string) => {
    if (status === "done" && item.status !== "done" && item.journal_refs.length === 0) {
      setConfirmDone(item);
      return;
    }
    await plan.setStatus(item, status);
  };

  // IN2 — 항목 실행: 백엔드가 프롬프트를 조립·저장하고, 터미널에 프리필할 한 줄
  // 명령 + 프롬프트 본문을 돌려준다. 실행(Enter)은 사용자가 한다.
  //
  // 어디에 무엇으로 꽂을지는 `dispatchTarget` 이 판단한다 — 돌고 있는 에이전트가
  // 있으면 본문을 붙여넣고, 아니면 셸에 한 줄 명령. 그리고 터미널이 이미 화면에
  // 있으면(⌘J 도크·터미널 화면·분리 창) **여기 화면을 빼앗지 않는다**.
  const dispatchItem = async (item: PlanItemDto) => {
    if (selectedId == null) return;
    const res = await commands.planDispatchPrompt(projectId, selectedId, item.item_id);
    if (res.status !== "ok") {
      toast.destructive(t("plan.dispatchFailed", { error: res.error }));
      return;
    }
    // 이동 여부는 **쓰기 전에** 정한다 — 프리필이 성공했더라도 터미널이 안
    // 보이는 사람에게는 어디로 갔는지 보여줘야 한다.
    const onScreen = terminalOnScreen(state);
    const done = await handoffDispatch(
      { projectId, command: res.data.command, prompt: res.data.prompt },
      sessions.terminalTabs,
      sessions.terminalActiveId,
    );
    toast.info(
      done.kind === "pasted"
        ? t("plan.dispatchPasted", { title: res.data.item_title, agent: done.agent })
        : t("plan.dispatchReady", { title: res.data.item_title }),
    );
    if (!onScreen) onNavigate("terminal");
  };

  // plan-log journal refs are written relative to `.oculpm/` (e.g.
  // "journal/2026…/Bugs/…md"); the journal screen resolves paths relative to the
  // journal root, so strip a leading ".oculpm/" and/or "journal/" prefix. The
  // journal screen then opens the entry by its workday (window-independent).
  const openJournal = (ref: string) => {
    const path = ref.replace(/^\.oculpm\//, "").replace(/^journal\//, "");
    if (onOpenJournal) onOpenJournal(path);
    else onNavigate("journal");
  };

  const submitNewItem = async () => {
    if (!composer) return;
    if (await plan.addItem(composer.phase, composer.title)) setComposer(null);
  };

  const submitNewPlan = async () => {
    if (await plan.createPlan(newPlanTitle)) {
      setNewPlanOpen(false);
      setNewPlanTitle("");
    }
  };

  // 계획이 하나뿐이면 레일은 제목만 되풀이하므로 가로폭만 낭비한다.
  const railEligible = (plan.plans?.length ?? 0) >= 2;
  const railVisible = railEligible && !state.plannerRailCollapsed;

  const setSort = (sort: PlanSort) => setState((p) => ({ ...p, plannerSort: sort }));
  const setGroup = (group: PlanGroup) => setState((p) => ({ ...p, plannerGroup: group }));
  const toggleSection = (key: string, nextOpen: boolean) =>
    setState((p) => ({ ...p, plannerRailOpen: { ...p.plannerRailOpen, [key]: nextOpen } }));

  // 알 수 없는 영속값은 왼쪽으로 — 렌더는 "right" 하나만 특별 취급한다.
  const railSide = state.plannerRailSide === "right" ? "right" : "left";

  const railDock =
    railVisible && plan.plans ? (
      <PlanRailDock
        width={clampRailWidth(state.plannerRailWidth)}
        onWidthChange={(w) => setState((p) => ({ ...p, plannerRailWidth: w }))}
        side={railSide}
        onArchiveSection={(ids) => void plan.archivePlans(ids)}
        plans={plan.plans}
        facets={plan.facets}
        selectedId={selectedId}
        onSelect={plan.select}
        sort={state.plannerSort}
        onSortChange={setSort}
        group={state.plannerGroup}
        onGroupChange={setGroup}
        query={query}
        onQueryChange={setQuery}
        openOverride={state.plannerRailOpen}
        onToggleSection={toggleSection}
        now={plan.now}
      />
    ) : null;

  return (
    <>
      <Toolbar
        title={t("nav.planner")}
        sub={
          plan.plans && plan.plans.length > 0
            ? `${t("plan.toolbarSub", { n: plan.plans.length, active: plan.railStats.active })}${plan.railStats.stale ? t("plan.toolbarStale", { n: plan.railStats.stale }) : ""}`
            : t("plan.toolbarIdle")
        }
        leading={
          railEligible ? (
            <>
              <button
                className="pln-iconbtn"
                aria-label={railVisible ? t("plan.railCollapse") : t("plan.railExpand")}
                aria-expanded={railVisible}
                title={railVisible ? t("plan.railCollapse") : t("plan.railExpand")}
                onClick={() =>
                  setState((p) => ({ ...p, plannerRailCollapsed: !p.plannerRailCollapsed }))
                }
              >
                {/* 접기 글리프는 레일이 붙어 있는 쪽을 가리킨다 — 그래야 옆의
                    '옮기기' 버튼(반대쪽 글리프)과 한눈에 구별된다. */}
                {railSide === "right" ? <PanelRight size={15} /> : <PanelLeft size={15} />}
              </button>
              {railVisible ? (
                <button
                  className="pln-iconbtn"
                  aria-label={t(railSide === "right" ? "plan.railToLeft" : "plan.railToRight")}
                  title={t(railSide === "right" ? "plan.railToLeft" : "plan.railToRight")}
                  onClick={() =>
                    setState((p) => ({
                      ...p,
                      plannerRailSide: p.plannerRailSide === "right" ? "left" : "right",
                    }))
                  }
                >
                  {railSide === "right" ? <PanelLeft size={15} /> : <PanelRight size={15} />}
                </button>
              ) : null}
            </>
          ) : undefined
        }
      >
        <button
          className="scope-chip"
          style={{ height: 30 }}
          onClick={() => void plan.aiRefresh()}
          {...blocked(
            locked ? t("plan.aiLockedTitle") : selectedId == null ? t("plan.blockedNoPlan") : null,
            t("plan.aiTitle"),
          )}
          disabled={busy}
        >
          <RefreshCw size={13} /> {t("plan.aiRefresh")}
        </button>
        <button
          className="scope-chip"
          style={{ height: 30 }}
          onClick={() => setComposer((c) => (c ? null : { phase: plan.existingPhases[0] ?? t("plan.defaultPhase"), title: "" }))}
          {...blocked(
            locked ? t("plan.addLockedTitle") : selectedId == null ? t("plan.blockedNoPlan") : null,
            t("plan.addItemTitle"),
          )}
          disabled={busy}
        >
          <Plus size={13} /> {t("plan.addItem")}
        </button>
        <button className="btn primary" onClick={() => setNewPlanOpen((v) => !v)} disabled={busy}>
          <Plus size={15} /> {t("plan.newPlan")}
        </button>
      </Toolbar>

      <div className="pln-body">
        {railSide === "left" ? railDock : null}

        <div className="pln-main">
        <div className="pln-doc fade-in">
          {plan.error ? (
            <ErrorCard
              title={t("plan.error")}
              error={plan.error}
              onRetry={plan.retry}
              style={{ marginBottom: 16 }}
            />
          ) : null}

          {/* New plan composer */}
          {newPlanOpen ? (
            <div className="card card-pad" style={{ marginBottom: 16, display: "flex", gap: 8 }}>
              <input
                autoFocus
                className="set-input"
                style={{ flex: 1 }}
                placeholder={t("plan.newPlanPlaceholder")}
                value={newPlanTitle}
                onChange={(e) => setNewPlanTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submitNewPlan(); if (e.key === "Escape") setNewPlanOpen(false); }}
              />
              <button className="btn primary" onClick={() => void submitNewPlan()} {...blocked(newPlanTitle.trim() ? null : t("plan.blockedNoTitle"))} disabled={busy}>{t("plan.create")}</button>
              <button className="btn sm" onClick={() => setNewPlanOpen(false)}>{t("common.cancel")}</button>
            </div>
          ) : null}

          {plan.plans == null ? (
            <SkeletonList rows={3} height={44} />
          ) : plan.plans.length === 0 ? (
            /* 계획이 「스스로 갱신된다」는 것은 자동화가 아니다 (v3-surface
               {#first-day-screens}) — 에이전트가 plan_update 를 부를 때 갱신된다. */
            <EmptyState
              density="rich"
              icon={TargetIcon}
              title={t("plan.emptyTitle")}
              actions={
                <>
                  <button className="btn primary" onClick={() => setNewPlanOpen(true)} disabled={busy}>
                    <Plus size={15} /> {t("plan.newPlan")}
                  </button>
                  <button className="btn" onClick={() => void plan.importGoals()} disabled={busy}>
                    {t("plan.importGoals")}
                  </button>
                </>
              }
            >
              {t("plan.empty")}
            </EmptyState>
          ) : detail == null ? (
            plan.loadingDetail ? <SkeletonList rows={6} height={30} gap={8} /> : null
          ) : (
            <PlanBody
              detail={detail}
              counts={plan.counts}
              phases={plan.phases}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              onSetStatus={applyStatus}
              onDispatch={dispatchItem}
              busy={busy}
              locked={locked}
              onToggleLock={plan.setLock}
              onArchive={() => void plan.archivePlans(selectedId ? [selectedId] : [])}
              onRename={plan.renamePlan}
              onDelete={plan.deletePlan}
              onRemoveItem={plan.removeItem}
              onRenameItem={plan.renameItem}
              onRenamePhase={plan.renamePhase}
              onRemovePhase={plan.removePhase}
              onMovePhase={plan.movePhase}
              historyFor={plan.historyFor}
              history={plan.history}
              onToggleHistory={plan.toggleHistory}
              onRefresh={plan.refreshDetail}
              onOpenJournalRef={openJournal}
              resolveJournalRefs={plan.resolveJournalRefs}
            />
          )}

          {/* New item composer */}
          {composer && detail ? (
            <div className="card card-pad" style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                className="set-input"
                style={{ width: 180 }}
                list="phase-suggestions"
                placeholder={t("plan.phasePlaceholder")}
                value={composer.phase}
                onChange={(e) => setComposer({ ...composer, phase: e.target.value })}
              />
              <datalist id="phase-suggestions">
                {plan.existingPhases.map((p) => <option key={p} value={p} />)}
              </datalist>
              <input
                autoFocus
                className="set-input"
                style={{ flex: 1, minWidth: 200 }}
                placeholder={t("plan.itemPlaceholder")}
                value={composer.title}
                onChange={(e) => setComposer({ ...composer, title: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") void submitNewItem(); if (e.key === "Escape") setComposer(null); }}
              />
              <button className="btn primary" onClick={() => void submitNewItem()} {...blocked(composer.title.trim() ? null : t("plan.blockedNoItemTitle"))} disabled={busy}>{t("plan.add")}</button>
              <button className="btn sm" onClick={() => setComposer(null)}>{t("common.cancel")}</button>
            </div>
          ) : null}
        </div>
        </div>

        {railSide === "right" ? railDock : null}
      </div>

      {/* PR-CI6 (EDD-lite) — 완료 소프트 게이트: 검증 일지 미연결 경고 (무시 가능). */}
      <AppDialog
        open={confirmDone != null}
        onClose={() => setConfirmDone(null)}
        label={t("plan.confirmDoneTitle")}
        width={480}
      >
        {confirmDone ? (
          <>
            <div style={{ display: "flex", gap: 10, padding: "18px 20px 4px" }}>
              <TriangleAlert size={18} style={{ flexShrink: 0, marginTop: 2, color: "var(--t-bug, #d97706)" }} />
              <div style={{ fontSize: "var(--fs-4)", lineHeight: 1.65 }}>
                <strong>{confirmDone.title}</strong> {t("plan.confirmDoneBody1")} <strong>{t("plan.confirmDoneBody2")}</strong>.
                <br />
                <span style={{ color: "var(--text-3)" }}>
                  {t("plan.confirmDoneHint")}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px 16px" }}>
              <button className="btn sm" onClick={() => setConfirmDone(null)}>
                {t("common.cancel")}
              </button>
              <button
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
