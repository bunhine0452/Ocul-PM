import { useEffect, useRef } from "react";
import { Bot, RotateCcw } from "@/components/Icons";
import { TriggerBadge } from "./triggerMeta";
import { agentLabel } from "@/features/today/agentColor";
import type { JournalEntrySummary } from "@/lib/bindings";

// Final UI Update (ui_v2) — journal timeline card. Mirrors
// Ocul-PM1.0/src/journal-diff.jsx `JournalCard`.
//
// Dogfooding 2026-06-07: the per-file +/- chips were removed (byte deltas were
// almost always "+0" — agents rarely fill frontmatter byte counts). The card
// body now opens the full-screen 변경 기록 detail view (EntryDetailView via
// onOpenEntry), which carries the changed-file list, recorded diffs, AND the
// entry narrative. A small foot button still jumps to the LIVE 변경 diff 화면.
// When `focused`, the card gets a 1.6s accent ring (Today MiniEntry handoff §2).

/** Extract HH:MM from an ISO 8601 created_at string. */
function timeLabel(createdAt: string): string {
  const m = /T(\d{2}:\d{2})/.exec(createdAt);
  return m ? m[1] : "";
}

interface JournalCardV2Props {
  entry: JournalEntrySummary;
  focused: boolean;
  /** Open the full-screen 변경 기록 detail view for this entry. */
  onOpenEntry: (entry: JournalEntrySummary) => void;
}

export function JournalCardV2({ entry, focused, onOpenEntry }: JournalCardV2Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused && ref.current) {
      const el = ref.current;
      el.style.boxShadow = "0 0 0 2px var(--accent), var(--shadow-pop)";
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = window.setTimeout(() => {
        if (el) el.style.boxShadow = "";
      }, 1600);
      return () => window.clearTimeout(t);
    }
  }, [focused]);

  return (
    <div className="jcard" ref={ref}>
        <button
          type="button"
          className="jcard-main"
          onClick={() => onOpenEntry(entry)}
          aria-label={`${entry.title} — ${entry.type} · 변경 기록 열기`}
        >
          <div className="jcard-top">
            <TriggerBadge type={entry.type} />
            <span className="jcard-agent">
              <Bot size={13} /> {agentLabel(entry.agent_id)}
            </span>
            <span className="jcard-time">{timeLabel(entry.created_at)}</span>
          </div>
          <div className="jcard-title">{entry.title || entry.slug}</div>
        </button>
        <div className="jcard-foot">
          {entry.status !== "done" ? (
            <span className="cycle-flag">
              <RotateCcw size={13} /> {entry.status === "in_progress" ? "진행중" : entry.status}
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          {entry.tags.slice(0, 5).map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
    </div>
  );
}
