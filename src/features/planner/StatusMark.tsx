/**
 * 상태 마크 — 여섯 상태를 한 벌의 원으로 (2026-09-10 플래너 리디자인).
 *
 * 예전엔 유니코드 글리프(☐ ▣ ☑ ⚠︎ → ✗)였다. 글리프는 OS 서체가 그리므로
 * 굵기·크기·기준선이 글자마다 달랐고, ⚠ 는 이모지 폰트로 새서 색을 무시했다.
 * 이 마크는 CSS 만으로 그린다 — 같은 지름, 같은 선 굵기, 테마·프리셋 토큰을
 * 그대로 따른다. 뜻은 `planMeta.STATUS_META` 가 갖고, 여기는 모양만 갖는다.
 *
 *   todo        빈 링
 *   in_progress 반이 찬 링 (액센트)
 *   done        찬 원 + 체크
 *   blocked     찬 원(빨강) + !
 *   deferred    점선 링 + 화살
 *   dropped     흐린 링 + ×
 *
 * 항목 행 · 다음 할 일 · 보드 카드/열 머리 · 상태 메뉴 · 집계 범례가 전부
 * 이 하나를 쓴다. 장식이라 `aria-hidden` — 상태 이름은 호출부의 title/aria 가 말한다.
 */

interface StatusMarkProps {
  status: string;
  /** 촘촘한 자리(범례·열 머리·메뉴)는 12px. */
  size?: "sm" | "md";
  className?: string;
}

export function StatusMark({ status, size = "md", className }: StatusMarkProps) {
  return (
    <span
      className={"pmark is-" + status + (size === "sm" ? " sm" : "") + (className ? " " + className : "")}
      aria-hidden="true"
    />
  );
}
