import { ChevronRight } from "@/components/Icons";
import { TriggerBadge } from "@/features/oculpm/triggerMeta";
import { SourceBadge } from "@/features/oculpm/SourceBadge";
import { sourceOf } from "@/features/oculpm/entrySource";
import { agentLabel } from "./agentColor";
import type { JournalEntrySummary } from "@/lib/bindings";
import { useT } from "@/i18n";

// Final UI Update (ui_v2) — compact journal entry row in the Today highlights /
// yesterday panels. Mirrors Ocul-PM1.0/src/today.jsx `MiniEntry`. The backend
// summary has no per-entry +/- line counts, so this row shows time · agent ·
// file count (the aggregate +/- lives on the stat card). Clicking jumps to the
// 작업 일지 화면 with this entry focused.

/** Extract HH:MM from an ISO 8601 created_at string. */
function timeLabel(createdAt: string): string {
  const m = /T(\d{2}:\d{2})/.exec(createdAt);
  return m ? m[1] : "";
}

interface MiniEntryProps {
  entry: JournalEntrySummary;
  onOpen: (entry: JournalEntrySummary) => void;
}

export function MiniEntry({ entry, onOpen }: MiniEntryProps) {
  const { t } = useT();
  return (
    <button type="button" className="mini-entry" onClick={() => onOpen(entry)}>
      <TriggerBadge type={entry.type} withLabel={false} />
      <div className="mini-entry-body">
        <div className="mini-entry-title">{entry.title}</div>
        <div className="mini-entry-meta">
          <span className="mono">{timeLabel(entry.created_at)}</span>
          <span className="dotsep">·</span>
          <span>{agentLabel(entry.agent_id)}</span>
          <span className="dotsep">·</span>
          {/* 좁은 줄이라 아이콘만 — 라벨은 툴팁이 든다. */}
          <SourceBadge source={sourceOf(entry.session_id, entry.agent_id)} withLabel={false} />
          <span className="dotsep">·</span>
          <span>{t("today.entry.files", { n: entry.files_count })}</span>
        </div>
      </div>
      <ChevronRight size={15} color="var(--text-3)" />
    </button>
  );
}
