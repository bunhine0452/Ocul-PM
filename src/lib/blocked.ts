/**
 * 이유를 말하는 비활성 — `{#fix-disabled-reason}` (2026-09-10).
 *
 * ## 왜 `disabled` 가 아닌가
 *
 * 감사는 "비활성 버튼에 `title`·`aria-describedby` 를 붙여라" 였는데, 그
 * 처방은 **둘 다 사용자에게 도달하지 않는다**: `disabled` 요소는 마우스
 * 이벤트를 받지 않아 `title` 툴팁이 뜨지 않고, 포커스도 잡히지 않아
 * `aria-describedby` 가 읽히지 않는다. 회색 버튼 앞에서 이유를 물을 방법이
 * 없는 상태가 그대로 남는다.
 *
 * `aria-disabled` 는 요소를 **살려 둔 채** 보조기술에 "지금은 못 누른다" 를
 * 알린다. 포커스가 남으므로 툴팁도 뜨고 설명도 읽힌다. 대신 브라우저가
 * 클릭을 막아 주지 않으므로 그 일은 이쪽이 한다.
 *
 * ## 언제 무엇을 쓰나 — 둘을 가르는 것은 "사용자가 물을 것이 있는가"
 *
 *     disabled          진행 중이라 잠깐 못 누른다 (busy · saving · loading).
 *                       스스로 설명되고 곧 풀린다. 물을 것이 없다.
 *     blocked(reason)   조건이 안 맞아 못 누른다 (입력이 비었다 · 프로젝트가
 *                       없다 · 색인이 아직이다). 사용자가 **무엇을 고쳐야
 *                       하는지** 알아야 풀린다.
 *
 * 둘은 겹칠 수 있고, 그때는 같이 쓴다:
 *
 *     <button {...blocked(problem ? t(problem) : null)} disabled={busy}>
 *
 * ## 곁의 보이는 텍스트가 더 낫다
 *
 * `AutomationEditor` 는 이유를 버튼 곁에 문장으로 띄운다 — 그게 가장 확실히
 * 도달하는 방법이고, 이유가 하나뿐인 폼에서는 그쪽이 정답이다. 이 헬퍼는
 * 문장을 놓을 자리가 없는 자리(툴바 버튼·아이콘 버튼·목록 행의 동작)를 위한
 * 것이지, 보이는 텍스트를 대체하려는 게 아니다.
 *
 * 겉모습은 `:disabled` 와 같다 — CSS 는 `:is(:disabled, [aria-disabled="true"])`
 * 로 둘을 함께 받는다.
 */
import type { MouseEvent } from "react";

export interface BlockedProps {
  "aria-disabled": true;
  /** 포커스가 남아 있으므로 이 툴팁이 실제로 뜬다. */
  title: string;
  /**
   * `capture` 단계에서 막는다 — 버튼 자신의 `onClick` 은 물론 조상의 위임
   * 핸들러(목록 행 클릭 등)까지 함께 멈춰야, 눌리지 않는 버튼을 눌렀을 때
   * 엉뚱한 것이 열리지 않는다. submit 버튼이면 `preventDefault` 가 폼 제출도
   * 막는다.
   */
  onClickCapture: (e: MouseEvent) => void;
}

/**
 * 이유가 있으면 "이유를 말하는 비활성" props 를, 없으면 (있을 때) 평소 툴팁만
 * 준다. 그대로 펼쳐 쓴다 — `<button {...blocked(reason, t("...title"))}>`.
 *
 * **툴팁을 이 헬퍼가 가져가는 이유**: 막힌 이유와 동작 설명은 같은 자리를
 * 두고 다투는 다른 문장이라, 호출부에 `title` 을 따로 두면 둘 중 하나가 조용히
 * 덮인다(실제로 `TodayScreenV2` 에서 TS2783 으로 잡혔다). 한 자리에서 고르게
 * 해서 "막혔으면 이유, 아니면 설명" 을 규칙으로 만든다.
 *
 * `reason` 과 `title` 은 **이미 번역된 문장**이다 (i18n 키가 아니다). 이유는
 * 조건마다 달라 키가 하나로 안 정해지는 자리가 대부분이라 호출부가 `t()` 를
 * 부른다.
 */
export function blocked(
  reason: string | null | undefined,
  title?: string,
): BlockedProps | { title?: string } {
  if (!reason) return title ? { title } : {};
  return {
    "aria-disabled": true,
    title: reason,
    onClickCapture: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
