import { AlertTriangle, Link2 } from "@/components/Icons";
import type { JournalEntrySummary, RelatedRef } from "@/lib/bindings";
import { useT, getLang, type I18nKey } from "@/i18n";
import { agentLabelWithModel } from "@/features/today/agentColor";
import { TRIGGER_META } from "./triggerMeta";
import { SourceBadge } from "./SourceBadge";
import { sourceOf } from "./entrySource";
import { plainTitle, timeLabel } from "./JournalRow";

// 작업 일지 열람의 마스트헤드 (2026-09-11 원장의 한 장 리디자인) — 원장 행을
// 펼친 모양이다: 척추(종류색) · 종류 · 날짜/시각 · 작성자 · 큰 제목 · 발치
// (태그 · 관련 일지 · 파일 수). 예전엔 이 정보가 툴바 sub 의 칩 다섯 개였고,
// 본문 위에는 태그만 떠 있어 문서가 머리 없이 시작했다.
//
// 메타 승격 규칙은 원장과 같다 — 에이전트 출처는 기본값이라 배지를 달지 않고
// 작성자 이름이 그 말을 한다; 사람 손·자동화·백필처럼 **다른** 출처만 배지.

/** i18n keys for the four spec'd `related.kind` values — unknown kinds render as-is. */
const RELATED_KIND_KEY: Record<string, I18nKey> = {
  blocks: "entry.relatedKind.blocks",
  blocked_by: "entry.relatedKind.blocked_by",
  followup: "entry.relatedKind.followup",
  duplicate: "entry.relatedKind.duplicate",
};

/** 요일 라벨 — 로케일 인식 (하드코딩 배열 대신 Intl, useTodayBrief 와 같은 방식). */
const weekdays = () => {
  const f = new Intl.DateTimeFormat(getLang(), { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(1970, 0, 4 + i))));
};

/**
 * The entry's written date, e.g. "2026.06.15 (월)". Prefers the ISO `created_at`
 * (exact calendar day) and falls back to the YYYYMMDD `workday`. Returns "" when
 * neither parses.
 */
export function dateLabel(createdAt: string, workday: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(createdAt);
  let y: string, mo: string, d: string;
  if (iso) {
    [, y, mo, d] = iso;
  } else {
    const wd = /^(\d{4})(\d{2})(\d{2})$/.exec(workday);
    if (!wd) return "";
    [, y, mo, d] = wd;
  }
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return `${y}.${mo}.${d} (${weekdays()[dt.getDay()] ?? ""})`;
}

interface EntryMastheadProps {
  entry: JournalEntrySummary;
  related: RelatedRef[];
  /** 부록의 파일 수 — 0 이면 "변경된 파일" 링크를 그리지 않는다. */
  filesCount: number;
  onJumpToFiles: () => void;
  onOpenRelated?: (relativePath: string) => void;
  /** frontmatter 보정·파싱 경고 (F7a). 비면 상자를 그리지 않는다. */
  warnings: string[];
  parseFailed: boolean;
  /** "backfilled to" 메모가 있어 원본에 시간대를 1회 기록할 수 있는가. */
  canCoerceTz: boolean;
  confirmCoerce: boolean;
  onConfirmCoerce: (open: boolean) => void;
  coercing: boolean;
  onApplyTz: () => void;
}

export function EntryMasthead({
  entry,
  related,
  filesCount,
  onJumpToFiles,
  onOpenRelated,
  warnings,
  parseFailed,
  canCoerceTz,
  confirmCoerce,
  onConfirmCoerce,
  coercing,
  onApplyTz,
}: EntryMastheadProps) {
  const { t } = useT();
  const meta = TRIGGER_META[entry.type] ?? TRIGGER_META.chore;
  const source = sourceOf(entry.session_id, entry.agent_id);
  const date = dateLabel(entry.created_at, entry.workday);
  const time = timeLabel(entry.created_at);
  const statusKey: I18nKey | null =
    entry.status === "done"
      ? null
      : entry.status === "abandoned"
        ? "entry.status.abandoned"
        : "entry.status.open";
  const hasFoot = entry.tags.length > 0 || related.length > 0 || filesCount > 0;

  return (
    <header className="entry-mast">
      <div className="entry-eyebrow">
        <span className="entry-kind">{t(meta.labelKey)}</span>
        {statusKey ? <span className="entry-flag">{t(statusKey)}</span> : null}
        {date ? (
          <span className="entry-when">
            {date}
            {time ? <b>{time}</b> : null}
          </span>
        ) : null}
        <span className="entry-who">{agentLabelWithModel(entry.agent_id, entry.agent_version)}</span>
        {source !== "agent" ? <SourceBadge source={source} /> : null}
        {parseFailed ? (
          <span className="entry-warn" title={t("entry.parseWarn")}>
            <AlertTriangle size={13} /> {t("entry.parseWarnShort")}
          </span>
        ) : null}
      </div>

      <h1 className="entry-title">{plainTitle(entry.title || entry.slug)}</h1>

      {hasFoot ? (
        <div className="entry-mast-foot">
          {entry.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
          {related.map((r) => {
            const kindKey = RELATED_KIND_KEY[r.kind];
            const base = r.ref.split("/").pop() ?? r.ref;
            return (
              <button
                key={`${r.kind}:${r.ref}`}
                type="button"
                className="chip sm entry-rel"
                title={r.ref}
                data-inert={onOpenRelated ? undefined : "true"}
                onClick={() => onOpenRelated?.(r.ref)}
              >
                <Link2 size={11} /> {kindKey ? t(kindKey) : r.kind} · {base}
              </button>
            );
          })}
          {filesCount > 0 ? (
            <button type="button" className="entry-jump" onClick={onJumpToFiles}>
              {t("entry.filesChanged", { n: "" }).trim()} <b>{filesCount}</b>
            </button>
          ) : null}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="entry-notice">
          <div className="entry-notice-title">
            <AlertTriangle size={13} /> {parseFailed ? t("entry.parseWarn") : t("entry.coercionTitle")}
          </div>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {canCoerceTz ? (
            <div className="entry-notice-act">
              {confirmCoerce ? (
                <>
                  <span>{t("entry.editsOriginal")}</span>
                  <button type="button" className="btn sm" onClick={onApplyTz} disabled={coercing}>
                    {coercing ? t("entry.applying") : t("entry.apply")}
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => onConfirmCoerce(false)}
                    disabled={coercing}
                  >
                    {t("common.cancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => onConfirmCoerce(true)}
                  title={t("entry.applyTzTitle")}
                >
                  {t("entry.applyTz")}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
