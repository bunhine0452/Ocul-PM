import { useT } from "@/i18n";

// 기록 없는 변경을 골랐을 때 diff 위에 서는 배너 (4.0) — 이 화면의 예외 처리 자리다.
// 두 길뿐이다: 에이전트에게 맡기거나(요청 글을 복사), 사람이 직접 한 건 남기거나.

export function UnrecordedBanner({
  count,
  onCopy,
  onManual,
}: {
  /** 「기록 없음」 묶음의 파일 수 — 두 동작이 다루는 범위다. */
  count: number;
  onCopy: () => void;
  onManual: () => void;
}) {
  const { t } = useT();
  return (
    <div className="chg-banner" role="status">
      <div className="chg-banner-text">
        <b>{t("diff.unrecorded.title")}</b>
        <span>{t("diff.unrecorded.desc", { n: count })}</span>
      </div>
      <button type="button" className="btn primary sm" onClick={onCopy}>
        {t("diff.unrecorded.copy")}
      </button>
      <button type="button" className="btn sm" onClick={onManual}>
        {t("diff.unrecorded.manual")}
      </button>
    </div>
  );
}
