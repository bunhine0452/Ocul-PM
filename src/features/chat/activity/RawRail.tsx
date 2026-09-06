// 원본 이벤트 레일 — **도망갈 데** (플랜 `v3-surface` `{#raw-rail}`).
//
// 이 폴더가 하는 일은 도구 호출을 우리 어휘로 **번역**하는 것이다. 번역은
// 반드시 틀린다: 분류학은 자라고, 새 도구는 우리가 모르는 이름으로 오고,
// 어댑터는 `_meta` 를 어느 날 다르게 채운다. 그때 사용자가 할 수 있는 일이
// "이상하네" 뿐이면 우리는 진단조차 못 받는다.
//
// 그래서 추상화보다 **먼저** 이 레일을 놓는다. 어떤 활동이든, 우리가 뭐라고
// 부르기로 했든, 그 아래에는 원본 이벤트가 접힌 채로 늘 있다. 어휘가 틀린 날
// 사용자는 여기를 펴서 스스로 확인하고, 우리는 그 화면을 복사해 받는다.

import { ChevronDown } from "@/components/Icons";
import { useT } from "@/i18n";

/**
 * 레일에 싣는 최대 글자 수.
 *
 * 도구 출력은 수 MB 도 나온다. 여기는 "무슨 이벤트였나"를 확인하는 자리이지
 * 로그 뷰어가 아니다 — 잘렸다는 사실만 정직하게 남긴다.
 */
export const RAW_CHAR_CAP = 8000;

/** 원본을 사람이 읽을 수 있는 한 덩어리로. 못 찍으면 빈 문자열(레일이 안 뜬다). */
export function rawEventText(raw: unknown): string {
  if (raw == null) return "";
  try {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
    if (!text) return "";
    return text.length > RAW_CHAR_CAP ? text.slice(0, RAW_CHAR_CAP) : text;
  } catch {
    // 순환 참조 등 — 레일이 없는 편이 화면이 깨지는 것보다 낫다.
    return "";
  }
}

/**
 * 접힌 원본 이벤트 한 칸. 실을 것이 없으면 아무 것도 그리지 않는다.
 *
 * `<details>` 를 쓰는 이유는 상태를 들지 않기 위해서다 — 활동 줄마다 하나씩
 * 붙는 물건이라, 여는 상태를 React 로 들면 스무 줄짜리 턴에서 스무 개의
 * 상태가 스트리밍마다 함께 다시 그려진다.
 */
export function RawRail({ raw }: { raw: unknown }) {
  const { t } = useT();
  const text = rawEventText(raw);
  if (!text) return null;
  const clipped = text.length >= RAW_CHAR_CAP;
  return (
    <details className="raw-rail">
      <summary>
        <ChevronDown size={11} />
        {t("activity.raw.title")}
        {clipped ? <span className="raw-rail-cut">{t("activity.raw.clipped")}</span> : null}
      </summary>
      <pre>{text}</pre>
    </details>
  );
}
