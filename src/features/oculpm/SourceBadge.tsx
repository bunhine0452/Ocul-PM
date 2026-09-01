import { Bot, Clock, Download, Eye, History, Pencil, Puzzle, SparklesIcon } from "@/components/Icons";
import { t, useT, type I18nKey } from "@/i18n";
import { SOURCE_ORDER, sourcesPresent, type EntrySource } from "./entrySource";

// 출처 배지와 그 필터 레일 (Osaurus 라운드 Phase 3).
//
// **새 프리미티브를 만들지 않는다** — `.chip` 한 벌이 이미 있고(polish-round
// Phase 5 에서 열한 벌을 여기로 접었다), 배지는 라벨이지 새 도형이 아니다.
// 좁은 목록에서는 아이콘만, 넓으면 라벨까지 (`TriggerBadge` 와 같은 규약).

interface SourceMeta {
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  labelKey: I18nKey;
  /** `.chip` 수정자 — 색은 "무엇이 사람 손을 탔는가" 를 말한다. */
  cls: string;
}

/**
 * 색의 규칙: 사람이 만든 것(직접)은 강조색, 기계가 스스로 만든 것(초안·스케줄·
 * 감시)은 정보색, 기계가 사람의 지시로 만든 것(에이전트·MCP)과 복원(백필·
 * 들여옴)은 중립이다. 위험색은 쓰지 않는다 — 출처는 경고가 아니다.
 */
export const SOURCE_META: Record<EntrySource, SourceMeta> = {
  direct: { icon: Pencil, labelKey: "source.direct", cls: "chip sm accent" },
  agent: { icon: Bot, labelKey: "source.agent", cls: "chip sm" },
  draft: { icon: SparklesIcon, labelKey: "source.draft", cls: "chip sm info" },
  schedule: { icon: Clock, labelKey: "source.schedule", cls: "chip sm info" },
  automation: { icon: Eye, labelKey: "source.automation", cls: "chip sm info" },
  mcp: { icon: Puzzle, labelKey: "source.mcp", cls: "chip sm" },
  backfill: { icon: History, labelKey: "source.backfill", cls: "chip sm" },
  imported: { icon: Download, labelKey: "source.imported", cls: "chip sm" },
};

/** 툴팁·스크린리더가 읽는 한 문장 — "이건 무슨 뜻인가" 에 답한다. */
export function sourceTitle(source: EntrySource): string {
  return `${t(SOURCE_META[source].labelKey)} — ${t(`source.hint.${source}` as I18nKey)}`;
}

export function SourceBadge({
  source,
  withLabel = true,
}: {
  source: EntrySource;
  /** 좁은 줄(오늘 피드·세션 목록)은 아이콘만 — 라벨은 툴팁이 든다. */
  withLabel?: boolean;
}) {
  const { t: tr } = useT();
  const meta = SOURCE_META[source];
  const Icon = meta.icon;
  const title = sourceTitle(source);
  return (
    <span className={meta.cls} title={title} aria-label={title}>
      <Icon size={11} strokeWidth={2} />
      {withLabel ? tr(meta.labelKey) : null}
    </span>
  );
}

/**
 * 출처 필터 레일 — 목록에 실제로 있는 출처만, 그리고 **2종 이상일 때만** 그린다.
 * 하나뿐인 목록에서 레일은 아무것도 좁히지 못하는 장식이다.
 *
 * `radiogroup` 인 이유: 한 번에 하나만 고르는 배타 선택이라 탭 목록도 체크박스
 * 무리도 아니다. 화살표 키 이동은 브라우저가 radio 에 이미 준다.
 */
export function SourceFilterRail({
  sources,
  value,
  onChange,
  counts,
}: {
  /** 지금 화면에 있는 항목들의 출처 (중복 포함 그대로 넘겨도 된다). */
  sources: readonly EntrySource[];
  /** null = 전체. */
  value: EntrySource | null;
  onChange: (next: EntrySource | null) => void;
  /** 출처별 건수 — 있으면 칩에 숫자를 곁들인다. */
  counts?: Readonly<Partial<Record<EntrySource, number>>>;
}) {
  const { t: tr } = useT();
  const present = sourcesPresent(sources);
  if (present.length < 2) return null;

  const option = (source: EntrySource | null) => {
    const key = source ?? "all";
    const selected = value === source;
    const label = source ? tr(SOURCE_META[source].labelKey) : tr("source.rail.all");
    const n = source ? counts?.[source] : sources.length;
    return (
      <button
        key={key}
        type="button"
        role="radio"
        aria-checked={selected}
        className={"scope-chip" + (selected ? " on" : "")}
        style={{ height: 24 }}
        title={source ? sourceTitle(source) : undefined}
        onClick={() => onChange(source)}
      >
        {label}
        {n != null ? <span className="mono">{n}</span> : null}
      </button>
    );
  };

  return (
    <div
      role="radiogroup"
      aria-label={tr("source.rail.aria")}
      style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
    >
      {option(null)}
      {SOURCE_ORDER.filter((s) => present.includes(s)).map((s) => option(s))}
    </div>
  );
}
