/**
 * 계획 문서 한 벌 — 목록 · 선택 · 상세 · 편집 · 파생값.
 *
 * `PlannerScreenV2` 에서 그대로 들어냈다 (분할 라운드, 플랜 `v3-release`
 * {#planner-diff-split}). 화면 파일이 1,100줄을 넘겨 새 JSX 를 한 줄로 눌러
 * 담아야 했고, 그중 절반은 **그리는 코드가 아니라 읽고 쓰는 코드**였다.
 *
 * 규약은 `features/sessions/useSessionBoard.ts` 와 같다: 이 훅이 데이터와
 * 쓰기를 전부 소유하고, 화면은 결과를 배치하기만 한다. 다만 **작성기·대화상자
 * 같은 UI 상태는 여기 두지 않는다** — 새 계획 입력칸이나 완료 확인 대화상자는
 * 화면의 것이라, 여기서는 `createPlan(title)` / `setStatus(item, status)` 처럼
 * 인자를 받는 동작만 내놓는다.
 *
 * ## 546줄인데 왜 안 쪼개는가 ({#use-plan-document-size}, 2026-09-07 재판단)
 *
 * 집 규율("200~400 보통")보다 길다. 그래도 읽기/쓰기로 가르지 않는 이유는 셋이다.
 *
 * 1. **가를 자리가 데이터 흐름을 가로지른다.** 쓰기 15개가 읽기 상태를 만지는
 *    자리가 68곳이고(`setDetail`·`setBusy`·`refreshPlans`·`setSelectedId`·
 *    `refreshDetail`), 특히 `setStatus` 는 낙관적 갱신이라 **쓰기이면서 읽기**다
 *    (롤백용 `prevDetail` 을 자기가 읽는다). 읽기/쓰기 선은 이 코드의 이음매가
 *    아니다.
 * 2. **지금 사적인 것이 공개된다.** 위 다섯은 이 파일 안에서만 불린다. 갈라 두면
 *    훅 사이의 계약이 되어, "누가 `setDetail` 을 불러도 되는가"를 두 파일을 열어
 *    확인해야 한다. 배관 25줄이 늘고 개념은 하나도 안 준다.
 * 3. **재사용이 없다.** 소비자는 `PlannerScreenV2` 하나뿐이고, 갈라도 그 하나가
 *    두 훅을 다시 합쳐 쓴다.
 *
 * 재판단 조건은 그대로다 — **다음 라운드가 여기에 항목을 더 붙이면** 다시 본다.
 * 그때 가장 먼저 나갈 후보는 읽기/쓰기가 아니라 `resolveJournalRefs`(이 훅의
 * 상태를 하나도 안 쓴다 — `projectId` 뿐)와 항목 이력 3종(`historyFor`·
 * `history`·`toggleHistory`)이다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import {
  commands,
  type PlanDetail,
  type PlanEditOp,
  type PlanItemDto,
  type PlanItemUpdateDto,
  type PlanSummary,
} from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { facetsOf, latestActivityByPlan, type PlanFacet } from "./planList";
import { countByStatus, leafItems, NO_PHASE, type JournalRefMeta } from "./planMeta";

export interface PlanDocument {
  plans: PlanSummary[] | null;
  selectedId: string | null;
  select: (planId: string | null) => void;
  detail: PlanDetail | null;
  loadingDetail: boolean;
  busy: boolean;
  /** frontmatter status 가 "active" 가 아니면 잠김 (done/archived). */
  locked: boolean;
  error: string | null;
  /** 오류 카드의 「다시 시도」 — 사유를 지우고 목록부터 다시 읽는다. */
  retry: () => void;

  /** 단계별 항목 묶음 (문서 순서 그대로). */
  phases: [string, PlanItemDto[]][];
  /** 상태별 항목 수 (리프 기준 — 부모 항목은 롤업이라 제외). */
  counts: Record<string, number>;
  /** 이미 쓰이고 있는 단계 이름 — 새 항목 작성기의 자동완성. */
  existingPhases: string[];
  /** 상대 시각 계산의 기준 (마운트에 고정). */
  now: number;
  facets: Map<string, PlanFacet>;
  railStats: { active: number; stale: number };

  historyFor: string | null;
  history: PlanItemUpdateDto[] | null;

  refreshDetail: () => void;
  setStatus: (item: PlanItemDto, status: string) => Promise<void>;
  /** 성공 여부 — 실패하면 화면이 작성기를 닫지 않는다. */
  addItem: (phase: string, title: string) => Promise<boolean>;
  createPlan: (title: string) => Promise<boolean>;
  renamePlan: (title: string) => void;
  deletePlan: () => void;
  removeItem: (item: PlanItemDto) => void;
  /** E2 — 항목을 다른 항목 앞으로, 또는 단계 끝으로 (하위가 따라간다). */
  moveItem: (item: PlanItemDto, target: { before?: string; phase?: string }) => void;
  renameItem: (item: PlanItemDto, title: string) => void;
  renamePhase: (from: string, to: string) => void;
  removePhase: (phase: string) => void;
  movePhase: (phase: string, up: boolean) => void;
  setLock: (lock: boolean) => void;
  aiRefresh: () => void;
  importGoals: () => void;
  toggleHistory: (itemId: string) => void;
  archivePlans: (planIds: string[]) => void;
  resolveJournalRefs: (refs: string[]) => Promise<JournalRefMeta[]>;
}

export function usePlanDocument(projectId: number): PlanDocument {
  const { state, setState } = useWorkspace();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  // Restore the last-viewed plan (persisted) so returning from a linked journal
  // lands back on the SAME plan instead of resetting to the first one.
  const [selectedId, setSelectedId] = useState<string | null>(state.plannerPlanId);
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<PlanItemUpdateDto[] | null>(null);

  /**
   * 계획별 마지막 **실제** 활동 시각 (plan-log 기반).
   *
   * `PlanSummary.updated_at` 은 frontmatter `updated:` 인데 항목 편집으로는
   * 갱신되지 않아 사실상 생성일에 고정돼 있다 — 그 값으로 '멈춤' 을 주장하면
   * 거짓 경고가 된다. 그래서 멈춤 배지는 이 맵에 기록이 있는 계획에만 붙고,
   * 없으면 아무 주장도 하지 않는다 (planList.ts 참고).
   *
   * 마운트당 1회만 부른다: 이 커맨드도 plan 파일 전량 재읽기를 한다.
   */
  const [activity, setActivity] = useState<Record<string, string>>({});

  const refreshPlans = useCallback(async () => {
    // 봉투가 아닌 **진짜 Error**(전송 계층 실패·창 teardown)를 안 받으면 `plans`
    // 가 `null` 로 남아 스켈레톤이 영원히 돈다 — 오류 카드도 안 뜬다.
    try {
      const res = await commands.planList(projectId);
      if (res.status === "ok") {
        setPlans(res.data ?? []);
        // Keep the current selection if it still exists; otherwise fall back to
        // the first plan. (A persisted id may point at a since-deleted plan.)
        setSelectedId((cur) =>
          cur && res.data?.some((p) => p.plan_id === cur)
            ? cur
            : res.data?.[0]?.plan_id ?? null,
        );
      } else {
        setError(tError(res.error));
        setPlans([]);
      }
    } catch (e) {
      setError(String(e));
      setPlans([]);
    }
  }, [projectId]);

  // Persist the active plan so it survives navigating away (e.g. to a linked
  // journal) and back.
  useEffect(() => {
    setState((prev) => (prev.plannerPlanId === selectedId ? prev : { ...prev, plannerPlanId: selectedId }));
  }, [selectedId, setState]);

  // `silent` — 스켈레톤 없이 조용히 다시 읽는다. 디스크 변경(에이전트가 계획을
  // 고침)으로 도는 갱신은 사용자가 요청한 적이 없으므로, 읽고 있던 내용이
  // 로딩 뼈대로 깜빡이면 안 된다.
  const refreshDetail = useCallback(async (silent = false) => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    if (!silent) setLoadingDetail(true);
    try {
      const res = await commands.planGet(projectId, selectedId);
      if (res.status === "ok") setDetail(res.data);
      else setError(tError(res.error));
    } catch (e) {
      setError(String(e));
    } finally {
      if (!silent) setLoadingDetail(false);
    }
  }, [projectId, selectedId]);

  // 에이전트(또는 다른 창)가 `.oculpm/planner/*.md` 를 건드리면 즉시 다시 읽는다.
  // 이 구독이 없던 동안 계획 화면은 마운트 때 읽은 내용에 그대로 머물렀다.
  const refreshFromDisk = useCallback(() => {
    void refreshPlans();
    void refreshDetail(true);
  }, [refreshPlans, refreshDetail]);
  useOculpmDataEvents("planner", projectId, true, refreshFromDisk);

  useEffect(() => {
    void refreshPlans();
  }, [refreshPlans]);

  useEffect(() => {
    let alive = true;
    void commands.planRecentUpdates(projectId, 500).then((res) => {
      // 응답 모양을 신뢰하지 않는다 — 실패하면 조용히 비워 두고, 레일은
      // 활동 정보 없이도 완전히 동작한다 (멈춤 배지만 안 붙는다).
      if (!alive || res.status !== "ok") return;
      setActivity(latestActivityByPlan(res.data));
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    setHistoryFor(null);
    void refreshDetail();
  }, [refreshDetail]);

  // v2 U9 (docs/20260706_v2/01-ux-spec.md §4) — 낙관적 업데이트: 글리프를
  // 즉시 바꾸고 백그라운드로 기록한다. 파생 상태(phases/counts)는 detail 의
  // useMemo 라 자동 추종. 성공 시 응답의 정규화된 detail 로 치환하고 진행률
  // 롤업(plans 목록)만 비차단 refetch; 실패 시 이전 detail 로 롤백 + 토스트.
  // busy 게이트를 걸지 않아 연속 토글이 즉각 반응한다 (백엔드는 N4 공유
  // plan-write 락이 직렬화).
  const setStatus = async (item: PlanItemDto, status: string) => {
    if (selectedId == null || item.status === status) return;
    const prevDetail = detail;
    setDetail((d) =>
      d
        ? {
            ...d,
            items: d.items.map((it) =>
              it.item_id === item.item_id ? { ...it, status } : it,
            ),
          }
        : d,
    );
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      { kind: "set_status", item_id: item.item_id, status },
      "user",
    );
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      setDetail(prevDetail);
      toast.destructive(t("plan.statusFailed", { error: res.error }));
    }
  };

  // Resolve a plan item's linked journal refs to {date, title} for the picker
  // shown when an item links MORE THAN ONE journal. The workday comes free from
  // the path; the real title is the entry's first line (getJournalEntry).
  const resolveJournalRefs = useCallback(
    async (refs: string[]): Promise<JournalRefMeta[]> =>
      Promise.all(
        refs.map(async (ref) => {
          const path = ref.replace(/^\.oculpm\//, "").replace(/^journal\//, "");
          const workday = path.split("/")[0] ?? "";
          const fallback = path.split("/").pop()?.replace(/\.md$/, "") || path;
          try {
            const entry = await oculpmApi.getJournalEntry(projectId, path);
            return { ref, path, workday, title: entry?.title?.trim() || fallback };
          } catch {
            return { ref, path, workday, title: fallback };
          }
        }),
      ),
    [projectId],
  );

  const addItem = async (phase: string, title: string) => {
    if (selectedId == null || !title.trim()) return false;
    setBusy(true);
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      {
        kind: "add_item",
        phase: phase.trim() || t("plan.defaultPhase"),
        title: title.trim(),
        item_id: null,
        status: null,
      },
      "user",
    );
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
      return true;
    }
    toast.destructive(t("plan.addItemFailed", { error: res.error }));
    return false;
  };

  const createPlan = async (title: string) => {
    if (!title.trim()) return false;
    setBusy(true);
    const res = await commands.planCreate(projectId, title.trim());
    setBusy(false);
    if (res.status === "ok") {
      setSelectedId(res.data.plan_id);
      void refreshPlans();
      return true;
    }
    toast.destructive(t("plan.createFailed", { error: res.error }));
    return false;
  };

  // Plan-level CRUD: rename (frontmatter title) + delete (.md unlink + reproject).
  const renamePlan = async (title: string) => {
    if (busy || selectedId == null || !title.trim()) return;
    setBusy(true);
    const res = await commands.planRename(projectId, selectedId, title.trim());
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(t("plan.renameFailed", { error: res.error }));
    }
  };

  const deletePlan = async () => {
    if (busy || selectedId == null) return;
    setBusy(true);
    const res = await commands.planDelete(projectId, selectedId);
    setBusy(false);
    if (res.status === "ok") {
      setSelectedId(null);
      setDetail(null);
      void refreshPlans();
    } else {
      toast.destructive(t("plan.deleteFailed", { error: res.error }));
    }
  };

  // Item-level remove / rename (reuses plan_apply_edit; locked plans rejected).
  const removeItem = async (item: PlanItemDto) => {
    if (busy || selectedId == null) return;
    setBusy(true);
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      { kind: "remove_item", item_id: item.item_id },
      "user",
    );
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(t("plan.removeItemFailed", { error: res.error }));
    }
  };

  const moveItem = async (item: PlanItemDto, target: { before?: string; phase?: string }) => {
    if (busy || selectedId == null) return;
    if (target.before === item.item_id) return;
    setBusy(true);
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      { kind: "move_item", item_id: item.item_id, phase: target.phase ?? null, before: target.before ?? null },
      "user",
    );
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(t("plan.moveItemFailed", { error: res.error }));
    }
  };

  const renameItem = async (item: PlanItemDto, title: string) => {
    if (busy || selectedId == null || !title.trim()) return;
    setBusy(true);
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      { kind: "rename_item", item_id: item.item_id, title: title.trim() },
      "user",
    );
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(t("plan.renameFailed", { error: res.error }));
    }
  };

  // Phase-level CRUD — rename / delete / reorder a `## ` section. Phases were
  // previously only creatable (implicitly, via add_item); these close the gap.
  const editPhase = async (op: PlanEditOp, failMsg: string) => {
    if (busy || selectedId == null) return;
    setBusy(true);
    const res = await commands.planApplyEdit(projectId, selectedId, op, "user");
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(`${failMsg}: ${res.error}`);
    }
  };

  const renamePhase = (from: string, to: string) => {
    if (!to.trim() || to.trim() === from) return;
    void editPhase({ kind: "rename_phase", from, to: to.trim() }, t("plan.phaseRenameFailed"));
  };
  const removePhase = (phase: string) => void editPhase({ kind: "remove_phase", phase }, t("plan.phaseRemoveFailed"));
  const movePhase = (phase: string, up: boolean) =>
    void editPhase({ kind: "move_phase", phase, up }, t("plan.phaseMoveFailed"));

  // Dogfooding 2026-06-07 (Planner #1) — 완료·잠금: mark the plan done (read-only).
  // Locked plans reject in-app edits + AI refresh (backend guard) and AGENTS.md
  // tells external agents the same, so finished plans freeze and work moves on.
  const setLock = async (lock: boolean) => {
    if (selectedId == null || busy) return;
    setBusy(true);
    const res = await commands.planSetStatus(projectId, selectedId, lock ? "done" : "active");
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
      toast.info(lock ? t("plan.lockedDone") : t("plan.unlocked"));
    } else {
      toast.destructive(tError(res.error));
    }
  };

  // PR-PLN 5 — in-app AI updates item statuses from recent journal activity.
  const aiRefresh = async () => {
    if (selectedId == null || busy) return;
    const provR = await commands.settingsGet("default_provider");
    const provider = provR.status === "ok" ? provR.data : null;
    if (!provider) {
      toast.warning(t("plan.needProvider"));
      return;
    }
    const mR = await commands.settingsGet(`model_${provider}`);
    let model = mR.status === "ok" ? mR.data : null;
    if (!model) {
      const dm = await commands.settingsGet("default_model");
      model = dm.status === "ok" ? dm.data : null;
    }
    if (!model) {
      toast.warning(t("plan.needModel"));
      return;
    }
    setBusy(true);
    const res = await commands.planAiRefresh(projectId, selectedId, provider, model);
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
      toast.info(t("plan.aiDone"));
    } else {
      toast.destructive(t("plan.aiFailed", { error: res.error }));
    }
  };

  // PR-PLN 5 — one-time import of legacy goals/subtasks into _imported.md.
  const importGoals = async () => {
    if (busy) return;
    setBusy(true);
    const res = await commands.planMigrateGoals(projectId);
    setBusy(false);
    if (res.status === "ok") {
      setSelectedId(res.data.plan_id);
      void refreshPlans();
      toast.info(t("plan.goalsImported"));
    } else {
      toast.destructive(tError(res.error));
    }
  };

  const toggleHistory = async (itemId: string) => {
    if (historyFor === itemId) {
      setHistoryFor(null);
      return;
    }
    setHistoryFor(itemId);
    setHistory(null);
    if (selectedId == null) return;
    const res = await commands.planItemHistory(projectId, selectedId, itemId);
    if (res.status === "ok") setHistory(res.data);
  };

  /**
   * 끝난 계획 묶음을 통째로 보관으로 옮긴다 (레일 완료 섹션의 정리 동작).
   * 한 번의 백엔드 호출로 처리한다 — `plan_set_status` 를 N번 부르면 계획
   * 파일 전체를 N번 다시 파싱한다 (바로 이 경우가 가장 아픈 자리다).
   */
  const archivePlans = async (planIds: string[]) => {
    if (planIds.length === 0 || busy) return;
    setBusy(true);
    const res = await commands.planSetStatusBulk(projectId, planIds, "archived");
    setBusy(false);
    if (res.status === "ok") {
      void refreshPlans();
      if (selectedId != null && planIds.includes(selectedId)) void refreshDetail();
      toast.info(t("plan.rail.archived", { n: res.data }));
    } else {
      toast.destructive(tError(res.error));
    }
  };

  const phases = useMemo(() => {
    const map = new Map<string, PlanItemDto[]>();
    for (const it of detail?.items ?? []) {
      const key = it.phase ?? NO_PHASE;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return [...map.entries()];
  }, [detail]);

  // 리프 기준 — 부모는 파생값이라 세지 않는다 (진척 바·done/total 과 같은 모수).
  const counts = useMemo(() => countByStatus(leafItems(detail?.items ?? [])), [detail]);

  const existingPhases = useMemo(
    () => [...new Set((detail?.items ?? []).map((i) => i.phase).filter((p): p is string => !!p))],
    [detail],
  );

  // A plan whose frontmatter status isn't "active" is locked (done/archived):
  // edits + AI refresh are disabled in the UI (and refused by the backend).
  const locked = (detail?.plan.status ?? "active") !== "active";

  // 레일과 툴바 카운트가 같은 계산을 공유하도록 패싯은 여기서 한 번만 만든다.
  // `now` 를 렌더마다 새로 읽으면 useMemo 가 매번 무효화되므로 마운트에 고정한다
  // (상대 시각 표시는 분 단위 정확도를 요구하지 않는다).
  const now = useMemo(() => {
    void projectId; // 프로젝트가 바뀔 때만 다시 읽는다 — 값 자체는 안 쓴다.
    return Date.now();
  }, [projectId]);
  const facets = useMemo(
    () => facetsOf(plans ?? [], now, activity),
    [plans, now, activity],
  );

  const railStats = useMemo(() => {
    let active = 0;
    let stale = 0;
    for (const f of facets.values()) {
      if (f.bucket === "active") active += 1;
      if (f.staleDays != null) stale += 1;
    }
    return { active, stale };
  }, [facets]);

  return {
    plans,
    selectedId,
    select: setSelectedId,
    detail,
    loadingDetail,
    busy,
    locked,
    error,
    retry: () => {
      setError(null);
      void refreshPlans();
    },
    phases,
    counts,
    existingPhases,
    now,
    facets,
    railStats,
    historyFor,
    history,
    refreshDetail: () => void refreshDetail(),
    setStatus,
    addItem,
    createPlan,
    renamePlan,
    deletePlan,
    removeItem,
    moveItem,
    renameItem,
    renamePhase,
    removePhase,
    movePhase,
    setLock,
    aiRefresh,
    importGoals,
    toggleHistory,
    archivePlans,
    resolveJournalRefs,
  };
}
