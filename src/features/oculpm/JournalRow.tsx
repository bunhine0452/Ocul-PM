import { memo, type ReactNode } from "react";
import { CheckMark } from "@/components/Icons";
import { agentLabel } from "@/features/today/agentColor";
import { useT } from "@/i18n";
import type { JournalEntrySummary } from "@/lib/bindings";
import { evidenceStateOf, type EvidenceState } from "./evidenceState";
import { TRIGGER_META } from "./triggerMeta";

// 작업 일지 목록의 한 줄 (4.0 → 11-15). 증거가 선 일지(명령 · 읽음)는 36px 한 줄 — 제목과 오른쪽 고정 칸의
// 시각뿐이다. 예외(검증 없음 · 미완료 · 중단 · 파싱 경고)만 두 줄을 받아 이유 칩을 단다. 예전엔 모든 일지가
// 같은 두 줄이고 예외는 끝의 작은 칩 하나라, 1440×900 에 58px 행 13개 중 칩이 하나 섰다 — 예외가 묻혔다.
// 줄은 listbox 의 option 이다(고른 줄만 Tab 이 멈춘다 — 로빙 tabindex). 키는 화면 컨테이너가 듣는다.

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

/** ISO 8601 `created_at` 에서 「M/D」 — 날짜 머리가 없는 관련도 순서의 오른쪽 칸. */
function shortDate(createdAt: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(createdAt);
  return m ? `${Number(m[1])}/${Number(m[2])}` : "";
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

/** 검색어의 낱말을 굵게 — 색은 없다(영수증 규칙 1). */
function highlight(text: string, query: string | undefined): ReactNode {
  const words = (query ?? "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return text;
  const re = new RegExp(`(${words.join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part));
}

interface JournalRowProps {
  entry: JournalEntrySummary;
  selected: boolean;
  onSelect: (entry: JournalEntrySummary) => void;
  /** 목록에 에이전트가 둘 이상인가 — 하나면 줄마다 이름을 쓰지 않는다 (화면 검사 {#journal-list}). */
  showAgent?: boolean;
  /** 검색 발췌 — 있으면 둘째 줄이 「왜 걸렸는가」 를 말한다. */
  excerpt?: string;
  /** 발췌에서 굵게 할 검색어. */
  query?: string;
  /** 오른쪽 칸에 시각 대신 날짜 — 날짜 머리가 없는 관련도 순서. */
  withDate?: boolean;
  /** 로빙 tabindex — 고른 줄 하나만 Tab 이 멈춘다. */
  tabbable?: boolean;
}

export const JournalRow = memo(function JournalRow({
  entry,
  selected,
  onSelect,
  showAgent = true,
  excerpt,
  query,
  withDate = false,
  tabbable = false,
}: JournalRowProps) {
  const { t } = useT();
  const evState = evidenceStateOf(entry);
  const missing = evState === "missing";
  const open = entry.status !== "done";
  const parseWarn = entry.parse_ok === false;
  const exception = missing || open || parseWarn;
  const two = exception || !!excerpt;
  const title = plainTitle(entry.title) || entry.slug;
  const kind = TRIGGER_META[entry.type] ?? TRIGGER_META.chore;
  // 둘째 줄의 메타 — 종류를 첫 낱말로(영수증 규칙 1, 색 점이 아니라). 시각은 첫 줄 오른쪽 칸에 있다.
  const meta = [
    t(kind.labelKey),
    showAgent ? agentLabel(entry.agent_id) : "",
    entry.files_count > 0 ? t("journal.row.files", { n: entry.files_count }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      className={"jl-item " + (two ? "is-two" : "is-one")}
      data-path={entry.relative_path}
      onClick={() => onSelect(entry)}
    >
      <span className="jl-r1">
        <span className="jl-ti" title={title}>
          {title}
        </span>
        <span className="jl-when">{withDate ? shortDate(entry.created_at) : timeLabel(entry.created_at)}</span>
      </span>
      {two ? (
        <span className="jl-r2">
          {missing ? <EvidenceMark state={evState} /> : null}
          {open ? (
            <span className="chip sm hairline">
              {entry.status === "abandoned" ? t("entry.status.abandoned") : t("entry.status.open")}
            </span>
          ) : null}
          {parseWarn ? <span className="chip sm warn">{t("entry.parseWarnShort")}</span> : null}
          {excerpt ? (
            <span className="jl-excerpt">{highlight(excerpt, query)}</span>
          ) : (
            <span className="jl-meta">{meta}</span>
          )}
          {/* 통과 표시는 예외 줄에만 — 미완료지만 검증은 섰다처럼, 두 사실이 함께일 때만 뜻이 있다. */}
          {exception && !missing ? <EvidenceMark state={evState} /> : null}
        </span>
      ) : null}
    </div>
  );
});
