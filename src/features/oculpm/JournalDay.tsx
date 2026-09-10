import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "@/components/Icons";
import type { EntryType, JournalEntrySummary } from "@/lib/bindings";
import { useT } from "@/i18n";
import { agentColor, agentLabelWithModel } from "@/features/today/agentColor";
import { TRIGGER_META } from "./triggerMeta";
import { SourceBadge } from "./SourceBadge";
import { sourceOf, type EntrySource } from "./entrySource";
import { JournalRow, plainTitle, timeLabel } from "./JournalRow";
import type { JournalDay as JournalDayData } from "./useJournalDays";

// 작업 일지 원장의 날짜 절 (2026-09-11 리디자인).
//
// 머리글이 그날을 **요약**한다: 날짜·요일·건수, 항목마다 한 조각인 색띠
// (하루의 모양), 종류별 건수 범례, 작성자 명단. 행에 되풀이되던 메타가
// 여기로 올라왔으므로 행은 제목과 달라지는 것만 든다.

/** 그날 안에서 값이 몇 가지인지 — 하나면 머리글로, 여럿이면 행마다. */
interface DayMeta {
  agents: { id: string; label: string; n: number }[];
  sources: { source: EntrySource; n: number }[];
  types: { type: EntryType; n: number }[];
}

function summarize(entries: JournalEntrySummary[]): DayMeta {
  const agents = new Map<string, { id: string; label: string; n: number }>();
  const sources = new Map<EntrySource, number>();
  const types = new Map<EntryType, number>();
  for (const e of entries) {
    const label = agentLabelWithModel(e.agent_id, e.agent_version);
    const a = agents.get(label);
    if (a) a.n += 1;
    else agents.set(label, { id: e.agent_id, label, n: 1 });
    const s = sourceOf(e.session_id, e.agent_id);
    sources.set(s, (sources.get(s) ?? 0) + 1);
    types.set(e.type, (types.get(e.type) ?? 0) + 1);
  }
  const byCount = <T extends { n: number }>(a: T, b: T) => b.n - a.n;
  return {
    agents: [...agents.values()].sort(byCount),
    sources: [...sources.entries()].map(([source, n]) => ({ source, n })).sort(byCount),
    types: [...types.entries()].map(([type, n]) => ({ type, n })).sort(byCount),
  };
}

function typeColor(type: EntryType): string {
  const m = TRIGGER_META[type] ?? TRIGGER_META.chore;
  return `var(--t-${m.cssVar})`;
}

/** 요일 — 사전 키 없이 로케일이 쓴다 (`toLocaleDateString`). */
function weekdayOf(workday: string, lang: string): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6));
  const d = Number(workday.slice(6, 8));
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US", {
    weekday: "long",
  });
}

interface JournalDayProps {
  day: JournalDayData;
  open: boolean;
  onToggle: () => void;
  /** 그린 행 수 — 나머지는 「더 보기」 뒤에 있다. */
  shown: number;
  onShowMore: () => void;
  focusPath: string | null;
  onOpenEntry: (entry: JournalEntrySummary) => void;
}

export function JournalDay({
  day,
  open,
  onToggle,
  shown,
  onShowMore,
  focusPath,
  onOpenEntry,
}: JournalDayProps) {
  const { t, lang } = useT();
  const meta = useMemo(() => summarize(day.entries), [day.entries]);
  const showAgent = meta.agents.length > 1;
  const showSource = meta.sources.length > 1;
  // 출처가 하나뿐이고 그것이 평범한 에이전트 기록이 아니면(손으로·MCP·백필…)
  // 머리글이 한 번 말한다. 에이전트 기록은 기본값이라 말하지 않는다.
  const uniformSource =
    meta.sources.length === 1 && meta.sources[0].source !== "agent" ? meta.sources[0].source : null;

  const visible = day.entries.slice(0, shown);
  const hidden = day.entries.length - visible.length;
  // 색띠는 아침이 왼쪽 — 목록(최신 위)과 반대지만 시간축은 이쪽이 읽힌다.
  const strip = useMemo(() => day.entries.slice().reverse(), [day.entries]);
  const weekday = weekdayOf(day.workday, lang);

  return (
    <section className="jl-day">
      <header className={"jl-mast" + (open ? "" : " is-closed")}>
        <div className="jl-mast-title">
          <button type="button" className="jl-day-toggle" onClick={onToggle} aria-expanded={open}>
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <span className="jl-day-label">{day.label}</span>
          </button>
          {weekday ? <span className="jl-day-weekday">{weekday}</span> : null}
        </div>
        <span className="jl-day-count">{t("journal.dayCount", { n: day.entries.length })}</span>

        {open ? (
          <div className="jl-strip" aria-hidden="true">
            {strip.map((e) => (
              <i
                key={e.relative_path}
                style={{ "--c": typeColor(e.type) } as React.CSSProperties}
                title={`${timeLabel(e.created_at)} ${plainTitle(e.title) || e.slug}`}
              />
            ))}
          </div>
        ) : null}

        <div className="jl-legend">
          {meta.types.map(({ type, n }) => (
            <span key={type}>
              <i className="jl-dot" style={{ "--c": typeColor(type) } as React.CSSProperties} />
              {t((TRIGGER_META[type] ?? TRIGGER_META.chore).labelKey)}
              <b>{n}</b>
            </span>
          ))}
        </div>
        <div className="jl-roster">
          {uniformSource ? <SourceBadge source={uniformSource} /> : null}
          {meta.agents.map((a) => (
            <span key={a.label}>
              <i className="jl-agent-dot" style={{ "--c": agentColor(a.id) } as React.CSSProperties} />
              {a.label}
              {showAgent ? <b>{a.n}</b> : null}
            </span>
          ))}
        </div>
      </header>

      {open ? (
        <div className="jl-rows">
          {visible.map((e) => (
            <JournalRow
              key={e.relative_path}
              entry={e}
              focused={focusPath === e.relative_path}
              showAgent={showAgent}
              showSource={showSource}
              onOpenEntry={onOpenEntry}
            />
          ))}
          {hidden > 0 ? (
            <button type="button" className="btn sm jl-more" onClick={onShowMore}>
              {t("journal.dayMore", { n: hidden })}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
