/**
 * 「숫자만 굵게」 — 하루 한 줄의 「기록 **58**건」.
 */

import { t, type I18nKey } from "@/i18n";

/**
 * 사전 문장 안의 `{n}` 만 굵게. 사전에는 JSX 를 넣지 않으므로 자리표시자를 남긴 채
 * 받아(`t` 는 값이 없으면 자리표시자를 그대로 둔다) 그 자리에서 가른다.
 */
export function Num({ k, n, className }: { k: I18nKey; n: number | string; className?: string }) {
  const [pre, post = ""] = t(k).split("{n}");
  return (
    <span>
      {pre}
      <b className={className}>{n}</b>
      {post}
    </span>
  );
}
