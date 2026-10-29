import { useT } from "@/i18n";

// 기록 없는 변경을 골랐을 때 diff 위에 서는 배너 (4.0) — 이 화면의 예외 처리 자리다.
// 두 길뿐이다: Claude 에게 맡기거나(앱 안 터미널로 기록 요청), 사람이 직접 한 건 남기거나.
// 매번 서던 긴 설명문은 걷었다 (화면 검사 #diff-rows) — 제목이 파일 수까지 말한다.

export function UnrecordedBanner({
  count,
  onAsk,
  onManual,
}: {
  /** 「기록 없음」 묶음의 파일 수 — 두 동작이 다루는 범위다. */
  count: number;
  onAsk: () => void;
  onManual: () => void;
}) {
  const { t } = useT();
  return (
    <div className="chg-banner" role="status">
      <div className="chg-banner-text">
        <b>{t("diff.unrecorded.title", { n: count })}</b>
      </div>
      <button type="button" className="btn primary sm" onClick={onAsk}>
        {t("diff.unrecorded.ask")}
      </button>
      <button type="button" className="btn sm" onClick={onManual}>
        {t("diff.unrecorded.manual")}
      </button>
    </div>
  );
}
