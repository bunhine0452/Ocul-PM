import { useEffect, useState } from "react";
import { LoadingState } from "@/components/LoadingState";
import { ListChecks, ArrowRight } from "@/components/Icons";
import { commands, type PlanActivityDto } from "@/lib/bindings";
import { agentColor, agentLabel } from "./agentColor";
import { STATUS_META } from "@/features/planner/planMeta";
import { type UiV2View } from "@/contexts/WorkspaceContext";
import { t } from "@/i18n";
import { relativeTime } from "@/lib/format";

// Today block (Planner Upgrade follow-up) — recent plan activity across all
// plans, so Planner updates surface on the dashboard next to journal activity.
// Reuses agentColor/agentLabel for attribution consistency.

// 상태 글리프는 Planner 의 `STATUS_META` 한 곳에서만 태어난다 (3.0 {#status-glyph-ssot}).
// 예전엔 이 파일이 같은 표를 **자기 사본**으로 들고 있었고, 그 사본의 blocked 가
// U+FE0E 없는 맨 `⚠` 였다 — 같은 상태가 플래너에서는 본문색 선화로, 오늘 화면에서는
// OS 컬러 이모지로 그려졌다 (이모지는 color 를 무시하므로 붉은 tint 도 안 먹었다).
function StatusGlyph({ status }: { status: string | null }) {
  if (!status) return null;
  const meta = STATUS_META[status];
  if (!meta) return <>{status}</>;
  return (
    <span className="plu-glyph" style={{ color: meta.color }} title={t(meta.labelKey)}>
      {meta.glyph}
    </span>
  );
}

function relTime(iso: string): string {
  return relativeTime(iso, Date.now());
}

interface PlanUpdatesProps {
  projectId: number;
  onNavigate: (view: UiV2View) => void;
}

export function PlanUpdates({ projectId, onNavigate }: PlanUpdatesProps) {
  const [items, setItems] = useState<PlanActivityDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await commands.planRecentUpdates(projectId, 6);
      if (!cancelled && r.status === "ok") setItems(r.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Nothing logged yet → don't take up dashboard space.
  if (items != null && items.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <ListChecks size={15} color="var(--accent-text)" />
        <h3>{t("today.plan.title")}</h3>
        <span className="count">{items?.length ?? 0}</span>
        <button
          className="btn ghost sm right"
          onClick={() => onNavigate("planner")}
          aria-label={t("today.next.open")}
        >
          Planner <ArrowRight size={13} />
        </button>
      </div>
      <div className="panel-body">
        {items == null ? (
          <LoadingState />
        ) : (
          items.map((u, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onNavigate("planner")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                padding: "8px 2px",
                cursor: "pointer",
              }}
            >
              <span
                title={agentLabel(u.agent_id)}
                style={{ width: 8, height: 8, borderRadius: "50%", background: agentColor(u.agent_id), flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{ fontSize: "var(--fs-4)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  <span className="plu-transition">
                    <StatusGlyph status={u.from_status} />
                    {u.from_status && u.to_status ? <ArrowRight size={11} aria-hidden /> : null}
                    <StatusGlyph status={u.to_status} />
                  </span>{" "}
                  {u.item_title}
                </div>
                <div style={{ fontSize: "var(--fs-2)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {agentLabel(u.agent_id)} · {u.plan_title} · {relTime(u.ts)}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
