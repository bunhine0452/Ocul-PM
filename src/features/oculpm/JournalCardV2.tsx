import { useEffect, useRef, useState } from "react";
import { Bot, RotateCcw, GitCompareArrows } from "@/components/Icons";
import { TriggerBadge } from "./triggerMeta";
import { EntryDiffModal } from "./EntryDiffModal";
import { agentLabel } from "@/features/today/agentColor";
import type { JournalEntrySummary } from "@/lib/bindings";

// Final UI Update (ui_v2) — journal timeline card. Mirrors
// Ocul-PM1.0/src/journal-diff.jsx `JournalCard`.
//
// Dogfooding 2026-06-07: the per-file +/- chips were removed — the byte deltas
// were almost always "+0" (agents rarely fill frontmatter byte counts) and
// added noise. The whole card body now opens EntryDiffModal, which carries the
// changed-file list (with op badges + path disambiguation), the recorded diffs,
// AND the entry's narrative. A small foot button still jumps to the LIVE 변경
// diff 화면 for the entry. When `focused`, the card gets a 1.6s accent ring
// (route.params.focus handoff from Today's MiniEntry — §2).

/** Extract HH:MM from an ISO 8601 created_at string. */
function timeLabel(createdAt: string): string {
  const m = /T(\d{2}:\d{2})/.exec(createdAt);
  return m ? m[1] : "";
}

interface JournalCardV2Props {
  projectId: number;
  entry: JournalEntrySummary;
  focused: boolean;
  /** Jump to the LIVE 변경 diff 화면, pre-selected to this entry's file. */
  onOpenDiff: (entry: JournalEntrySummary) => void;
}

export function JournalCardV2({ projectId, entry, focused, onOpenDiff }: JournalCardV2Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [modalOpen, setModalOpen] = useState(false);

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
    <>
      <div className="jcard" ref={ref}>
        <button
          type="button"
          className="jcard-main"
          onClick={() => setModalOpen(true)}
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
          <button
            type="button"
            className="file-pill file-pill--btn"
            onClick={() => onOpenDiff(entry)}
            title="변경 diff 화면에서 열기"
          >
            <GitCompareArrows size={12} color="var(--text-3)" />
            변경 diff 화면
          </button>
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
      {modalOpen ? (
        <EntryDiffModal
          projectId={projectId}
          entry={entry}
          initialFile={null}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </>
  );
}
