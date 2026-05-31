import { useEffect, useRef } from "react";
import { Bot, FileCode2, RotateCcw } from "@/components/Icons";
import { TriggerBadge } from "./triggerMeta";
import { agentLabel } from "@/features/today/agentColor";
import type { JournalEntrySummary } from "@/lib/bindings";

// Final UI Update (ui_v2) — journal timeline card. Mirrors
// Ocul-PM1.0/src/journal-diff.jsx `JournalCard`. Pure presenter over a
// JournalEntrySummary; clicking opens the 변경 diff 화면 for this entry. When
// `focused`, the card gets a 1.6s accent ring (route.params.focus handoff from
// Today's MiniEntry — 02-screen-specs §2).
//
// NOTE: the legacy JournalEntryCard.tsx is a different (flag-off) component and
// stays untouched. This V2 card uses the mockup .jcard tokens.

/** Extract HH:MM from an ISO 8601 created_at string. */
function timeLabel(createdAt: string): string {
  const m = /T(\d{2}:\d{2})/.exec(createdAt);
  return m ? m[1] : "";
}

interface JournalCardV2Props {
  entry: JournalEntrySummary;
  focused: boolean;
  onOpenDiff: (entry: JournalEntrySummary) => void;
}

export function JournalCardV2({ entry, focused, onOpenDiff }: JournalCardV2Props) {
  const ref = useRef<HTMLButtonElement>(null);

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
    <button
      type="button"
      className="jcard"
      ref={ref}
      onClick={() => onOpenDiff(entry)}
      aria-label={`${entry.title} — ${entry.type}`}
    >
      <div className="jcard-top">
        <TriggerBadge type={entry.type} />
        <span className="jcard-agent">
          <Bot size={13} /> {agentLabel(entry.agent_id)}
        </span>
        <span className="jcard-time">{timeLabel(entry.created_at)}</span>
      </div>
      <div className="jcard-title">{entry.title || entry.slug}</div>
      <div className="jcard-foot">
        <span className="file-pill">
          <FileCode2 size={12} color="var(--text-3)" />
          <b>{entry.files_count}</b>개 파일
        </span>
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
    </button>
  );
}
