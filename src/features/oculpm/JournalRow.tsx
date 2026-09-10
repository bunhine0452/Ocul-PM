import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw } from "@/components/Icons";
import { TRIGGER_META } from "./triggerMeta";
import { SourceBadge } from "./SourceBadge";
import { sourceOf } from "./entrySource";
import { agentColor, agentLabelWithModel } from "@/features/today/agentColor";
import type { JournalEntrySummary } from "@/lib/bindings";
import { useT } from "@/i18n";

// 작업 일지 원장의 한 행 (2026-09-11 리디자인 — `JournalCardV2` 를 대체).
//
// [시각 | 척추 | 제목 + 메타] 격자. 상자·그림자·아이콘 배지가 없다 — 종류는
// 척추 한 토막의 색과 메타 줄의 단어 하나로 말한다. 행 전체가 버튼이라
// 어디를 눌러도 상세로 간다 (예전 카드는 머리·제목만 버튼이었다).
//
// 작성자·출처는 **그날 안에서 값이 갈릴 때만** 행에 남는다 (`showAgent` ·
// `showSource`). 값이 하나면 날짜 머리글이 한 번만 말한다 — 카드마다
// 「에이전트 · Claude Code · Fable 5.1」 이 되풀이되던 것이 이 화면의 가장
// 큰 소음이었다.

/**
 * 제목의 인라인 마크다운 표식을 벗긴다 — 에이전트는 첫 줄에도 `**강조**` 와
 * `` `코드` `` 를 쓰는데, 원장의 한 줄에서 그 별표와 억음부호는 뜻이 아니라
 * 얼룩이다. 상세 화면은 마크다운을 그대로 렌더하므로 잃는 것이 없다.
 */
export function plainTitle(title: string): string {
  return title.replace(/\*\*|__|`/g, "");
}

/** Extract HH:MM from an ISO 8601 created_at string. */
export function timeLabel(createdAt: string): string {
  const m = /T(\d{2}:\d{2})/.exec(createdAt);
  return m ? m[1] : "";
}

interface JournalRowProps {
  entry: JournalEntrySummary;
  /** Today 에서 건너온 한 번짜리 초점 — 1.6초 강조 후 풀린다. */
  focused: boolean;
  /** 그날 작성자가 둘 이상이라 행마다 적어야 하는가. */
  showAgent: boolean;
  /** 그날 출처가 둘 이상이라 행마다 적어야 하는가. */
  showSource: boolean;
  onOpenEntry: (entry: JournalEntrySummary) => void;
}

export function JournalRow({ entry, focused, showAgent, showSource, onOpenEntry }: JournalRowProps) {
  const { t } = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!focused || !ref.current) return;
    ref.current.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 1600);
    return () => window.clearTimeout(timer);
  }, [focused]);

  const meta = TRIGGER_META[entry.type] ?? TRIGGER_META.chore;
  const color = `var(--t-${meta.cssVar})`;
  const open = entry.status !== "done";
  // 에이전트 기록은 기본값이라 섞인 날에도 배지를 달지 않는다 — 옆의 작성자
  // 이름이 이미 그 말을 한다. 손으로·MCP·자동화·백필만 배지가 된다.
  const source = sourceOf(entry.session_id, entry.agent_id);

  return (
    <button
      type="button"
      ref={ref}
      className={"jl-row" + (flash ? " is-focus" : "")}
      style={{ "--c": color } as React.CSSProperties}
      onClick={() => onOpenEntry(entry)}
      aria-label={t("journal.card.aria", { title: entry.title, type: entry.type })}
    >
      <span className="jl-time">{timeLabel(entry.created_at)}</span>
      <span className="jl-spine" aria-hidden="true" />
      <span className="jl-body">
        <span className="jl-title">{plainTitle(entry.title) || entry.slug}</span>
        <span className="jl-meta">
          <span className="jl-type">{t(meta.labelKey)}</span>
          {open ? (
            <span className="cycle-flag">
              <RotateCcw size={11} />
              {entry.status === "in_progress" ? t("journal.card.inProgress") : entry.status}
            </span>
          ) : null}
          {entry.verified_by_user ? (
            <span className="jl-verified" title={t("entry.verified")} aria-label={t("entry.verified")}>
              <Check size={13} />
            </span>
          ) : null}
          {showSource && source !== "agent" ? <SourceBadge source={source} /> : null}
          {showAgent ? (
            <span className="jl-meta-agent">
              <i className="jl-agent-dot" style={{ "--c": agentColor(entry.agent_id) } as React.CSSProperties} />
              {agentLabelWithModel(entry.agent_id, entry.agent_version)}
            </span>
          ) : null}
          {entry.tags.length > 0 ? (
            <span className="jl-tags">
              {entry.tags.slice(0, 5).map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
