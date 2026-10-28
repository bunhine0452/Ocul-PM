import { CheckMark } from "@/components/Icons";
import { agentLabel } from "@/features/today/agentColor";
import { useT } from "@/i18n";
import type { JournalEntrySummary } from "@/lib/bindings";
import { evidenceStateOf, type EvidenceState } from "./evidenceState";
import { TRIGGER_META } from "./triggerMeta";

// 작업 일지 목록의 한 줄 (4.0). [종류 점 · 제목 · 증거 표시] / [시각 · 에이전트 · 파일 수].
// 줄 전체가 버튼이다 — 어디를 눌러도 오른쪽 상세에 열린다. 색은 종류 점 하나뿐이고,
// 눈에 띄는 것은 **예외(증거 없음)** 하나다.

/**
 * 제목의 인라인 마크다운 표식을 벗긴다 — 에이전트는 첫 줄에도 `**강조**` 와 `` `코드` `` 를 쓰는데,
 * 목록의 한 줄에서 그 별표와 억음부호는 뜻이 아니라 얼룩이다.
 */
export function plainTitle(title: string): string {
  return title.replace(/\*\*|__|`/g, "");
}

/** ISO 8601 `created_at` 에서 HH:MM. */
export function timeLabel(createdAt: string): string {
  const m = /T(\d{2}:\d{2})/.exec(createdAt);
  return m ? m[1] : "";
}

/** 증거 표시 — 경고는 칩, 통과는 체크 하나. 요구하지 않는 유형은 아무것도 안 그린다. */
export function EvidenceMark({ state }: { state: EvidenceState }) {
  const { t } = useT();
  if (state === "missing") return <span className="chip sm warn">{t("journal.evidence.missing")}</span>;
  if (state === "command" || state === "confirmed") {
    const label = state === "command" ? t("entry.evidence.command") : t("entry.verified");
    return (
      <span className="jl-ok" role="img" aria-label={label} title={label}>
        <CheckMark size={13} />
      </span>
    );
  }
  return null;
}

interface JournalRowProps {
  entry: JournalEntrySummary;
  selected: boolean;
  onSelect: (entry: JournalEntrySummary) => void;
}

export function JournalRow({ entry, selected, onSelect }: JournalRowProps) {
  const { t } = useT();
  const kind = TRIGGER_META[entry.type] ?? TRIGGER_META.chore;
  const open = entry.status !== "done";
  const meta = [
    timeLabel(entry.created_at),
    agentLabel(entry.agent_id),
    entry.files_count > 0 ? t("journal.row.files", { n: entry.files_count }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      className="jl-item"
      data-path={entry.relative_path}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(entry)}
    >
      <span className="jl-r1">
        <i
          className="jl-dot"
          style={{ "--c": `var(--t-${kind.cssVar})` } as React.CSSProperties}
          role="img"
          aria-label={t(kind.labelKey)}
        />
        <span className="jl-ti">{plainTitle(entry.title) || entry.slug}</span>
        {open ? (
          <span className="chip sm">
            {entry.status === "abandoned" ? t("entry.status.abandoned") : t("entry.status.open")}
          </span>
        ) : null}
        <EvidenceMark state={evidenceStateOf(entry)} />
      </span>
      <span className="jl-meta">{meta}</span>
    </button>
  );
}
