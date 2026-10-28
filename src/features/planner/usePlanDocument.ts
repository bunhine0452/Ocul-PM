/**
 * 계획 문서 한 벌 — 목록 · 선택 · 상세 · 항목 상태 바꾸기 (4.0 `{#ui-planner}`).
 *
 * 3.x 에서는 이 훅이 쓰기 열다섯(이름 바꾸기·옮기기·단계 편집·잠그기·보관·앱 안 AI 갱신 …)을
 * 들고 있었다. 4.0 에서 계획은 **에이전트가 쓴다** — 사람이 화면에서 하는 쓰기는 항목 상태
 * 하나만 남았다(막힘·이월·폐기처럼 사람이 정하는 상태가 있어서다).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import { commands, type PlanDetail, type PlanItemDto, type PlanSummary } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { railOrder } from "./planList";

export interface PlanDocument {
  plans: PlanSummary[] | null;
  selectedId: string | null;
  select: (planId: string) => void;
  detail: PlanDetail | null;
  loadingDetail: boolean;
  /** frontmatter status 가 "active" 가 아니면 잠김 (done/archived) — 고치지 않는다. */
  locked: boolean;
  error: string | null;
  /** 오류 카드의 「다시 시도」 — 사유를 지우고 목록부터 다시 읽는다. */
  retry: () => void;
  refreshDetail: () => void;
  setStatus: (item: PlanItemDto, status: string) => Promise<void>;
}

export function usePlanDocument(projectId: number): PlanDocument {
  const { state, setState } = useWorkspace();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  // 마지막에 본 계획 — 오늘 화면의 「계획 열기」도 이 값을 세우고 이 화면으로 온다.
  const [selectedId, setSelectedId] = useState<string | null>(state.plannerPlanId);
  // 늦게 온 `planGet` 응답이 그 사이 바뀐 선택을 덮지 않게.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPlans = useCallback(async () => {
    try {
      const res = await commands.planList(projectId);
      if (res.status === "ok") {
        const list = res.data ?? [];
        setPlans(list);
        // 고른 계획이 아직 있으면 그대로, 없으면 진행 중 첫 계획(오늘 화면과 같은 순서).
        setSelectedId((cur) => {
          if (cur && list.some((p) => p.plan_id === cur)) return cur;
          const { active, closed } = railOrder(list);
          return active[0]?.plan_id ?? closed[0]?.plan_id ?? null;
        });
      } else {
        setError(tError(res.error));
        setPlans([]);
      }
    } catch (e) {
      setError(String(e));
      setPlans([]);
    }
  }, [projectId]);

  useEffect(() => {
    setState((prev) => (prev.plannerPlanId === selectedId ? prev : { ...prev, plannerPlanId: selectedId }));
  }, [selectedId, setState]);

  // `silent` — 디스크 변경(에이전트가 계획을 고침)으로 도는 갱신은 뼈대로 깜빡이지 않는다.
  const refreshDetail = useCallback(
    async (silent = false) => {
      if (selectedId == null) {
        setDetail(null);
        setLoadingDetail(false);
        return;
      }
      if (!silent) setLoadingDetail(true);
      try {
        const res = await commands.planGet(projectId, selectedId);
        if (selectedIdRef.current !== selectedId) return;
        if (res.status === "ok") setDetail(res.data);
        else setError(tError(res.error));
      } catch (e) {
        if (selectedIdRef.current !== selectedId) return;
        setError(String(e));
      } finally {
        if (!silent && selectedIdRef.current === selectedId) setLoadingDetail(false);
      }
    },
    [projectId, selectedId],
  );

  const refreshFromDisk = useCallback(() => {
    void refreshPlans();
    void refreshDetail(true);
  }, [refreshPlans, refreshDetail]);
  useOculpmDataEvents("planner", projectId, true, refreshFromDisk);

  useEffect(() => {
    void refreshPlans();
  }, [refreshPlans]);

  useEffect(() => {
    void refreshDetail();
  }, [refreshDetail]);

  // 낙관적 갱신 — 상자를 즉시 바꾸고 뒤에서 기록한다. 실패하면 되돌리고 알린다.
  const setStatus = async (item: PlanItemDto, status: string) => {
    if (selectedId == null || item.status === status) return;
    const prevDetail = detail;
    setDetail((d) =>
      d ? { ...d, items: d.items.map((it) => (it.item_id === item.item_id ? { ...it, status } : it)) } : d,
    );
    const res = await commands.planApplyEdit(projectId, selectedId, { kind: "set_status", item_id: item.item_id, status }, "user");
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      setDetail(prevDetail);
      toast.destructive(t("plan.statusFailed", { error: res.error }));
    }
  };

  return {
    plans,
    selectedId,
    select: setSelectedId,
    detail,
    loadingDetail,
    locked: (detail?.plan.status ?? "active") !== "active",
    error,
    retry: () => {
      setError(null);
      void refreshPlans();
    },
    refreshDetail: () => void refreshDetail(),
    setStatus,
  };
}
