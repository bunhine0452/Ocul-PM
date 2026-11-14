import { useT } from "@/i18n";

// 기록 없는 변경을 골랐을 때 diff 위에 서는 띠 (4.0) — 이 화면의 예외 처리 자리다.
// 두 길뿐이다: Claude 에게 맡기거나(받는 세션 · 미리보기가 있는 작성기로 기록 요청), 사람이 직접 한 건 남기거나.
//
// 11-15 (#diff-primary): 띠는 두 테마에서 같은 모양이다 — 옅은 경고색 테 하나와 아주 옅은 바탕. 다크에서
// 탁한 올리브(카드와 1.37:1), 라이트에서 거의 안 보이던(1.11:1) --warn-soft 면을 걷었다. 「Claude 에게
// 맡기기」 는 메모가 없을 때만 화면의 채운 단추이고(영수증 규칙 3), 「직접 기록」 은 조용한 단추다. 맡긴
// 뒤에는 머리카락 선 「맡김 · 일지 기다리는 중」 으로 바뀌어 같은 요청을 또 보내지 않게 한다 — 일지가
// 와서 일지 없는 파일이 바뀌면 저절로 풀린다(`diffSessionStore` 의 맡김).

export function UnrecordedBanner({
  count,
  asked,
  primary,
  onAsk,
  onManual,
}: {
  /** 「기록 없음」 묶음의 파일 수 — 두 동작이 다루는 범위다. */
  count: number;
  /** 지금 이 파일들을 맡겨 두었다. */
  asked: boolean;
  /** 이 화면의 채운 단추인가 — 보낼 메모가 있으면 그쪽이 채운 단추다. */
  primary: boolean;
  onAsk: () => void;
  onManual: () => void;
}) {
  const { t } = useT();
  return (
    <div className={"chg-banner" + (asked ? " is-asked" : "")} role="status">
      <span className={"chip sm " + (asked ? "hairline" : "warn")}>
        {asked ? t("diff.unrecorded.asked") : t("diff.unrecorded.label")}
      </span>
      <span className="chg-banner-n" title={t("diff.fileCount", { n: count })}>
        {count}
      </span>
      <b className="chg-banner-text">{asked ? t("diff.unrecorded.waiting") : t("diff.unrecorded.title")}</b>
      {asked ? null : (
        <button type="button" className={"btn sm" + (primary ? " primary" : "")} onClick={onAsk}>
          {t("diff.unrecorded.ask")}
        </button>
      )}
      <button type="button" className="btn ghost sm" onClick={onManual}>
        {t("diff.unrecorded.manual")}
      </button>
    </div>
  );
}
