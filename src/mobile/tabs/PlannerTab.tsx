// 모바일 플래너 — 목록 → 상세, 체크박스 토글이 핵심 조작 (#mb3-screens).
import { useCallback, useEffect, useState } from "react";

import { commands, type PlanItemDto, type PlanSummary } from "@/lib/bindings";
import { ChevronLeft } from "@/components/Icons";
import { STATUS_META } from "@/features/planner/planMeta";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { ErrorNote, Loading } from "./shared";

type PlanDetail = NonNullable<Awaited<ReturnType<typeof commands.planGet>> extends infer R
  ? R extends { status: "ok"; data: infer D }
    ? D
    : never
  : never>;

// 글리프는 데스크톱과 **같은 표**에서 읽는다 (3.0 {#status-glyph-ssot}).
// 주석으로 "같은 글리프" 라고 적어 둔 사본이었는데, 사본은 언젠가 갈린다.
const NEXT_STATUS: Record<string, string> = { todo: "in_progress", in_progress: "done", done: "todo" };

export function PlannerTab({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setError(null);
    const res = await commands.planList(projectId);
    if (res.status === "ok") setPlans(res.data);
    else setError(res.error);
  }, [projectId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const open = async (planId: string) => {
    setSelected(planId);
    setDetail(null);
    const res = await commands.planGet(projectId, planId);
    if (res.status === "ok" && res.data) setDetail(res.data);
    else setError(res.status === "error" ? res.error : t("mobile.planner.missing"));
  };

  const toggle = async (item: PlanItemDto) => {
    if (!selected || !detail) return;
    const status = NEXT_STATUS[item.status] ?? "done";
    // 낙관적 갱신 — 실패 시 재조회로 되돌린다.
    setDetail({
      ...detail,
      items: detail.items.map((i) => (i.item_id === item.item_id ? { ...i, status } : i)),
    });
    const res = await commands.planApplyEdit(
      projectId,
      selected,
      { kind: "set_status", item_id: item.item_id, status },
      "mobile",
    );
    if (res.status === "ok" && res.data) setDetail(res.data);
    else void open(selected);
  };

  if (error) return <ErrorNote message={error} onRetry={() => void loadList()} />;

  if (selected) {
    if (!detail) return <Loading />;
    const active = detail.plan.status === "active";
    const byPhase = new Map<string, PlanItemDto[]>();
    for (const item of detail.items) {
      const key = item.phase ?? "";
      const arr = byPhase.get(key) ?? [];
      arr.push(item);
      byPhase.set(key, arr);
    }
    return (
      <div className="p-4 space-y-4">
        <button onClick={() => setSelected(null)} className="mob-link text-sm inline-flex items-center gap-0.5">
          <ChevronLeft size={15} /> {t("mobile.common.back")}
        </button>
        <div className="space-y-2">
          <h2 className="text-base font-semibold">{detail.plan.title}</h2>
          {detail.plan.progress !== null ? (
            <div className="mob-progress">
              <div style={{ width: `${Math.round(detail.plan.progress * 100)}%` }} />
            </div>
          ) : null}
          {!active ? <p className="text-xs mob-text-3">{t("mobile.planner.locked")}</p> : null}
        </div>
        {[...byPhase.entries()].map(([phase, items]) => (
          <section key={phase || "_"}>
            {phase ? <h3 className="mob-sec-title">{phase}</h3> : null}
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.item_id}>
                  <button
                    onClick={() => (active ? void toggle(item) : undefined)}
                    {...blocked(active ? null : t("mobile.planner.blockedLocked"))}
                    className="mob-card w-full flex items-start gap-2.5 text-left px-3 py-2.5 disabled:opacity-70 aria-disabled:opacity-70"
                  >
                    <span className={`mob-glyph ${item.status}`}>
                      {STATUS_META[item.status]?.glyph ?? STATUS_META.todo.glyph}
                    </span>
                    <span
                      className={`text-fs-4 leading-5 ${item.status === "done" ? "mob-item-done" : ""}`}
                    >
                      {item.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  if (plans === null) return <Loading />;
  if (plans.length === 0)
    return <p className="p-6 text-sm mob-text-3 text-center">{t("mobile.planner.empty")}</p>;

  return (
    <ul className="p-4 space-y-2">
      {plans.map((p) => (
        <li key={p.plan_id}>
          <button
            onClick={() => void open(p.plan_id)}
            className="mob-card w-full text-left px-3.5 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-fs-4 font-medium truncate">{p.title}</span>
              {p.progress !== null ? (
                <span className="text-fs-2 mob-text-2 shrink-0 font-mono tabular-nums">
                  {Math.round(p.progress * 100)}%
                </span>
              ) : null}
            </div>
            {p.progress !== null ? (
              <div className="mob-progress mt-2">
                <div style={{ width: `${Math.round(p.progress * 100)}%` }} />
              </div>
            ) : null}
            <div className="text-fs-2 mob-text-3 mt-1.5">{p.status}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}
