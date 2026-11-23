/**
 * 계획 문서 한 벌 — 목록 · 선택 · 상세 · 항목 상태 바꾸기 (4.0 `{#ui-planner}`).
 *
 * 3.x 에서는 이 훅이 쓰기 열다섯(이름 바꾸기·옮기기·단계 편집·잠그기·보관·앱 안 AI 갱신 …)을
 * 들고 있었다. 4.0 에서 계획은 **에이전트가 쓴다** — 사람이 화면에서 하는 쓰기는 항목 상태
 * 하나만 남았다(막힘·이월·폐기처럼 사람이 정하는 상태가 있어서다).
 *
 * 옛 상태가 남지 않게 (11-15):
 *  - 읽기에 성공하면 오류를 지운다 — 에이전트가 계획 .md 를 고치는 순간 한 번 실패하면, 다시 읽어도
 *    오류 카드가 남아 있었다. 목록과 상세의 오류는 따로 들고 **각자 자기 것만** 지운다: 상세 읽기의 성공이
 *    목록 오류까지 지우면, 목록을 못 읽은 화면이 「계획 없음」 빈 화면(과 계획 세우기 단추)으로 섰다.
 *  - 「계획이 하나도 없다」 는 목록을 **받아서** 0 개일 때만이다 — 못 읽으면 `plans` 는 그대로(null) 둔다.
 *  - 조용한 갱신(디스크 변경)이 실패하면 마지막 문서를 그대로 두고 문서 위에 한 줄만 단다(`staleSince` — 마지막으로
 *    읽은 때. 오늘 화면과 같은 「14:12 이후 못 읽음」 이다, RC-11).
 *  - 모든 쓰기는 **보이는 문서의 계획 id**(`detail.plan.plan_id`)로 간다 — 고른 id 는 앞서 바뀌어 있을
 *    수 있다(다른 계획을 읽는 중). 화면은 그동안 동작 단추를 막는다(`busy`).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { t } from "@/i18n";
import { toAppError } from "@/api/invoke";
import { planApi } from "@/api/plan";
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
  /** 고른 계획과 보이는 문서가 다르다(읽는 중) — 동작 단추를 막는다. */
  busy: boolean;
  /** frontmatter status 가 "active" 가 아니면 잠김 (done/archived) — 고치지 않는다. */
  locked: boolean;
  /** 목록 · 문서를 처음부터 못 읽었다 — 오류 카드. */
  error: string | null;
  /** 문서는 있는데 다시 읽기를 못 했다 — 그때 보이는 값을 읽은 시각(ms). 문서 위 한 줄. */
  staleSince: number | null;
  /** 「다시 시도」 — 사유를 지우고 목록과 문서를 다시 읽는다. */
  retry: () => void;
  refreshDetail: () => void;
  setStatus: (item: PlanItemDto, status: string) => Promise<void>;
  /** 보이는 계획을 닫는다 (남은 항목이 0 일 때만 화면이 부른다) — 알림에 「되돌리기」 가 달린다. */
  close: () => Promise<void>;
}

/** 못 읽기 시작한 때를 정한다 — 이미 못 읽는 중이면 그 시각 그대로, 아니면 마지막으로 읽은 때(없으면 지금). */
const staleFrom = (okAt: number) => (prev: number | null) => prev ?? (okAt || Date.now());

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
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  // 못 읽기 시작한 때 보이던 값의 시각 — 마지막으로 읽은 때(`okAt`). 실패가 이어져도 처음 값을 둔다.
  const [listStale, setListStale] = useState<number | null>(null);
  const [detailStale, setDetailStale] = useState<number | null>(null);
  const okAt = useRef({ list: 0, detail: 0 });

  const refreshPlans = useCallback(
    async (silent = false) => {
      let failure: string;
      try {
        const res = await commands.planList(projectId);
        if (res.status === "ok") {
          const list = res.data ?? [];
          okAt.current.list = Date.now();
          setPlans(list);
          setListError(null);
          setListStale(null);
          // 고른 계획이 아직 있으면 그대로, 없으면 레일 맨 위 계획(먼저 볼 계획이 있으면 그것 — `railOrder`).
          setSelectedId((cur) => {
            if (cur && list.some((p) => p.plan_id === cur)) return cur;
            const { active, closed } = railOrder(list);
            return active[0]?.plan_id ?? closed[0]?.plan_id ?? null;
          });
          return;
        }
        failure = tError(res.error);
      } catch (e) {
        failure = tError(toAppError(e));
      }
      if (silent) setListStale(staleFrom(okAt.current.list));
      else setListError(failure);
    },
    [projectId],
  );

  useEffect(() => {
    setState((prev) => (prev.plannerPlanId === selectedId ? prev : { ...prev, plannerPlanId: selectedId }));
  }, [selectedId, setState]);

  // `silent` — 디스크 변경(에이전트가 계획을 고침)으로 도는 갱신은 뼈대로 깜빡이지 않고, 실패해도 문서를
  // 걷지 않는다(문서 위 한 줄).
  const refreshDetail = useCallback(
    async (silent = false) => {
      if (selectedId == null) {
        setDetail(null);
        setLoadingDetail(false);
        setDetailError(null);
        setDetailStale(null);
        return;
      }
      if (!silent) setLoadingDetail(true);
      try {
        const res = await commands.planGet(projectId, selectedId);
        if (selectedIdRef.current !== selectedId) return;
        if (res.status === "ok") {
          okAt.current.detail = Date.now();
          setDetail(res.data);
          setDetailError(null);
          setDetailStale(null);
        } else if (silent) setDetailStale(staleFrom(okAt.current.detail));
        else setDetailError(tError(res.error));
      } catch (e) {
        if (selectedIdRef.current !== selectedId) return;
        if (silent) setDetailStale(staleFrom(okAt.current.detail));
        else setDetailError(tError(toAppError(e)));
      } finally {
        if (!silent && selectedIdRef.current === selectedId) setLoadingDetail(false);
      }
    },
    [projectId, selectedId],
  );

  const refreshFromDisk = useCallback(() => {
    void refreshPlans(true);
    void refreshDetail(true);
  }, [refreshPlans, refreshDetail]);
  useOculpmDataEvents("planner", projectId, true, refreshFromDisk);

  useEffect(() => {
    void refreshPlans();
  }, [refreshPlans]);

  useEffect(() => {
    void refreshDetail();
  }, [refreshDetail]);

  // 낙관적 갱신 — 상자를 즉시 바꾸고 뒤에서 기록한다. 실패하면 **그 항목만** 되돌리고 알린다
  // (그 사이 디스크에서 다시 읽힌 다른 항목을 옛 문서로 덮지 않게).
  const setStatus = async (item: PlanItemDto, status: string) => {
    const planId = detail?.plan.plan_id;
    if (planId == null || item.status === status) return;
    const prevStatus = item.status;
    const patch = (to: string) => (d: PlanDetail | null) =>
      d && d.plan.plan_id === planId
        ? { ...d, items: d.items.map((it) => (it.item_id === item.item_id ? { ...it, status: to } : it)) }
        : d;
    setDetail(patch(status));
    const res = await commands.planApplyEdit(projectId, planId, { kind: "set_status", item_id: item.item_id, status }, "user");
    if (res.status === "ok") {
      if (res.data && selectedIdRef.current === planId) setDetail(res.data);
      void refreshPlans(true);
    } else {
      if (selectedIdRef.current === planId) setDetail(patch(prevStatus));
      toast.destructive(t("plan.statusFailed", { error: tError(res.error) }));
    }
  };

  // 계획 닫기 — 닫으면 잠겨서 에이전트도 고치지 못한다. 잘못 눌렀을 때를 위해 알림에 되돌리기를 단다.
  const close = async () => {
    if (detail == null) return;
    const planId = detail.plan.plan_id;
    const title = detail.plan.title;
    try {
      const closed = await planApi.close(projectId, planId);
      if (closed && selectedIdRef.current === planId) setDetail(closed);
      void refreshPlans(true);
      toast.info(t("plan.closed", { title }), {
        actions: [
          {
            label: t("plan.closeUndo"),
            onClick: () =>
              void planApi
                .reopen(projectId, planId)
                .then(refreshFromDisk)
                .catch((e) => toast.destructive(t("plan.closeFailed", { error: tError(toAppError(e)) }))),
          },
        ],
      });
    } catch (e) {
      toast.destructive(t("plan.closeFailed", { error: tError(toAppError(e)) }));
    }
  };

  return {
    plans,
    selectedId,
    select: setSelectedId,
    detail,
    loadingDetail,
    busy: detail != null && detail.plan.plan_id !== selectedId,
    locked: (detail?.plan.status ?? "active") !== "active",
    error: listError ?? detailError,
    staleSince: listStale == null ? detailStale : detailStale == null ? listStale : Math.min(listStale, detailStale),
    retry: () => {
      setListError(null);
      setDetailError(null);
      setListStale(null);
      setDetailStale(null);
      void refreshPlans();
      void refreshDetail();
    },
    refreshDetail: () => void refreshDetail(),
    setStatus,
    close,
  };
}
