import { useEffect, useState } from "react";
import { Target, ArrowRight } from "@/components/Icons";
import { commands, type PlanActivityDto } from "@/lib/bindings";
import { agentColor, agentLabel } from "./agentColor";
import { type UiV2View } from "@/contexts/WorkspaceContext";
import { t } from "@/i18n";

// Today block (Planner Upgrade follow-up) — recent plan activity across all
// plans, so Planner updates surface on the dashboard next to journal activity.
// Reuses agentColor/agentLabel for attribution consistency.

const GLYPH: Record<string, string> = {
  todo: "☐",
  in_progress: "▣",
  done: "☑",
  blocked: "⚠",
  deferred: "→",
  dropped: "✗",
};

function glyph(s: string | null): string {
  if (!s) return "";
  return GLYPH[s] ?? s;
}

function relTime(iso: string): string {
  // 지역 변수명을 `t` 로 두면 번역 함수를 섀도잉한다.
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minutesAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("time.hoursAgo", { n: hr });
  return t("time.daysAgo", { n: Math.floor(hr / 24) });
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
        <Target size={16} color="var(--accent-text)" />
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
          <div className="empty-hint">{t("common.loading")}</div>
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
                style={{ width: 8, height: 8, borderRadius: 99, background: agentColor(u.agent_id), flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{ fontSize: 13, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  <span style={{ color: "var(--text-3)" }}>
                    {glyph(u.from_status)}
                    {u.from_status && u.to_status ? "→" : ""}
                    {glyph(u.to_status)}
                  </span>{" "}
                  {u.item_title}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
