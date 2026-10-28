import { Clock, Cpu, Download, Eye, History, Pencil, PenLine, Puzzle } from "@/components/Icons";
import { t, useT, type I18nKey } from "@/i18n";
import type { EntrySource } from "./entrySource";

// 출처 배지 (Osaurus 라운드 Phase 3). 필터 레일은 4.0 일지 화면이 걷었다 — 목록은 종류·증거로 거른다.
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
  agent: { icon: Cpu, labelKey: "source.agent", cls: "chip sm" },
  draft: { icon: PenLine, labelKey: "source.draft", cls: "chip sm info" },
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
