/**
 * 「숫자만 굵게」 — 하루 한 줄의 「기록 **58**건」.
 */

import { t, type I18nKey } from "@/i18n";

/**
 * 사전 문장 안의 `{n}` 만 굵게. 사전에는 JSX 를 넣지 않으므로 값을 넣어 받은 문장을
 * 그 수가 처음 나오는 자리에서 가른다. 자리표시자를 남긴 채 받으면 영어의 단수/복수
 * `{n|entry|entries}` 가 풀리지 않아 「34 {n|entry|entries}」 가 그대로 그려졌다(10-30).
 */
export function Num({ k, n, className }: { k: I18nKey; n: number | string; className?: string }) {
  const full = t(k, { n });
  const num = String(n);
  const at = full.indexOf(num);
  if (at < 0) return <span>{full}</span>;
  return (
    <span>
      {full.slice(0, at)}
      <b className={className}>{n}</b>
      {full.slice(at + num.length)}
    </span>
  );
}
