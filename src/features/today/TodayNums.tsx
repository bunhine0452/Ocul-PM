import { ShieldCheck } from "@/components/Icons";
import { useT } from "@/i18n";
import type { JournalEntrySummary } from "@/lib/bindings";

/** 증거를 요구하는 유형 — 성적표(`db::scorecard`)와 같은 셋. */
const JUDGED = new Set(["bug", "feature", "refactor"]);

/**
 * 오늘 화면 머리글의 숫자 셋 — 증거 있음 N/M · 미기록 파일 N · 다음 할 일 N (시안 Today).
 *
 * 세 숫자는 아래 세 칼럼(무엇을 했나 · 믿을 수 있나 · 다음은)의 요약이지 새 집계가 아니다.
 * 증거는 오늘 일지 중 결함·기능·리팩토링만 분모로 센다 — 잡일에 증거를 묻지 않는다.
 * 모르는 값은 `—` 로 둔다.
 */
export function TodayNums({
  today,
  unrecorded,
  nextCount,
}: {
  today: JournalEntrySummary[];
  unrecorded: number | null;
  nextCount: number | null;
}) {
  const { t } = useT();
  const judged = today.filter((e) => JUDGED.has(e.type));
  const withEvidence = judged.filter((e) => e.evidence === 2).length;
  return (
    <div className="today-nums" aria-label={t("today.nums.aria")}>
      <span>
        <i>
          <ShieldCheck size={11} /> {t("today.nums.evidence")}
        </i>
        <b data-tone={judged.length > 0 && withEvidence === judged.length ? "ok" : judged.length > 0 ? "warn" : undefined}>
          {judged.length === 0 ? "—" : `${withEvidence} / ${judged.length}`}
        </b>
      </span>
      <span>
        <i>{t("today.nums.unrecorded")}</i>
        <b data-tone={unrecorded == null ? undefined : unrecorded > 0 ? "warn" : "ok"}>{unrecorded == null ? "—" : unrecorded}</b>
      </span>
      <span>
        <i>{t("today.nums.next")}</i>
        <b>{nextCount == null ? "—" : nextCount}</b>
      </span>
    </div>
  );
}
