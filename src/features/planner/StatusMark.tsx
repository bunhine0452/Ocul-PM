/**
 * 상태 상자 — 여섯 상태를 한 벌의 네모로 (4.0 계획 화면, 시안 Plan).
 *
 *   todo        빈 상자
 *   in_progress 반이 찬 상자 (액센트)
 *   done        찬 상자 + 체크
 *   blocked     붉은 테두리
 *   deferred    점선 테두리
 *   dropped     흐린 상자
 *
 * CSS 만으로 그린다 — 같은 크기, 같은 선, 테마 토큰을 그대로 따른다. 뜻은
 * `planMeta.STATUS_META` 가 갖고, 여기는 모양만 갖는다. 장식이라 `aria-hidden` —
 * 상태 이름은 호출부의 라벨이 말한다.
 */

import { Check } from "@/components/Icons";

interface StatusMarkProps {
  status: string;
  className?: string;
}

export function StatusMark({ status, className }: StatusMarkProps) {
  return (
    <span className={"plv-box is-" + status + (className ? " " + className : "")} aria-hidden="true">
      {status === "done" ? <Check size={11} strokeWidth={3} /> : null}
    </span>
  );
}
