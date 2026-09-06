import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { MessageSquare, ArrowRight } from "@/components/Icons";
import { commands, type DiscussionSummary } from "@/lib/bindings";
import { type UiV2View } from "@/contexts/WorkspaceContext";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { useT } from "@/i18n";

// Today block (Discussion feature, PR-DISC 4) — open problem-solving documents
// awaiting a decision, so the "fuzzy front end" surfaces on the dashboard next
// to plan + journal activity. Clicking jumps to the 문제 해결 screen.

interface DiscussionPendingProps {
  projectId: number;
  onNavigate: (view: UiV2View) => void;
}

export function DiscussionPending({ projectId, onNavigate }: DiscussionPendingProps) {
  const { t } = useT();
  const [items, setItems] = useState<DiscussionSummary[] | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(() => {
    void (async () => {
      const r = await commands.discussionList(projectId);
      if (alive.current && r.status === "ok") {
        setItems((r.data ?? []).filter((d) => d.status === "open"));
      }
    })();
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);
  // 논의가 열리거나 해결되면 이 카드도 따라간다 — 대시보드가 지난 내용을
  // 붙들고 있으면 "결정 대기" 라는 주장 자체가 거짓이 된다.
  useOculpmDataEvents("discussion", projectId, true, load);

  // No open discussions → don't take up dashboard space.
  if (items != null && items.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <MessageSquare size={16} color="var(--accent-text)" />
        <h3>{t("today.discussion.title")}</h3>
        <span className="count">{items?.length ?? 0}</span>
        <button
          className="btn ghost sm right"
          onClick={() => onNavigate("discussion")}
          aria-label={t("today.discussion.open")}
        >
          {t("nav.discussion")} <ArrowRight size={13} />
        </button>
      </div>
      <div className="panel-body">
        {items == null ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : (
          items.map((d, i) => (
            <button
              key={d.discussion_id}
              type="button"
              onClick={() => onNavigate("discussion")}
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-1)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.title}
                </div>
                {d.problem_preview ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.problem_preview}
                  </div>
                ) : null}
              </div>
              {d.next_step_count > 0 ? (
                <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>
                  {t("today.discussion.nextSteps", { n: d.next_step_count })}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
