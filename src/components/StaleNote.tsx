/**
 * 다시 읽다 실패했을 때의 한 줄 (11-15 RC-11) — 「14:12 이후 못 읽음」(시각은 기계 글씨) + 글자 링크 「다시 시도」.
 * 보이는 값은 그때(`since`) 읽은 것이다.
 *
 * 오늘(카드 머리)과 계획(문서 위)이 같은 모양 · 같은 말이다. 계획만 경고 칩 안에 문장 「방금 이 계획을 못
 * 읽었어요」(11px — 칩은 상태 이름 자리다) + 테 없는 단추를 두었고, 같은 동작을 영어로 「Try again」 이라 따로
 * 불렀다. 모양은 screens-overflow.css 의 `.stale-note` 한 벌.
 */
import { useT } from "@/i18n";
import { clockOf } from "@/lib/whenLabel";

export function StaleNote({ since, onRetry }: { since: number; onRetry: () => void }) {
  const { t } = useT();
  const time = clockOf(new Date(since).toISOString());
  const text = t("state.staleSince", { time });
  const at = time ? text.indexOf(time) : -1;
  return (
    <span className="stale-note" role="status">
      <span>
        {at < 0 ? (
          text
        ) : (
          <>
            {text.slice(0, at)}
            <span className="mono">{time}</span>
            {text.slice(at + time.length)}
          </>
        )}
      </span>
      <button type="button" className="text-link" onClick={onRetry}>
        {t("common.retry")}
      </button>
    </span>
  );
}
