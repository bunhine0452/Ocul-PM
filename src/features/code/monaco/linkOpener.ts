/**
 * Monaco 링크 ⌘클릭 → OS 기본 브라우저 (2026-09-22).
 *
 * 편집기 본문의 URL(`links` 기여가 감지)을 ⌘클릭하면 Monaco 의 `OpenerService`
 * 가 등록된 오프너를 차례로 묻고, 아무도 안 받으면 기본 외부 오프너가
 * `window.open(url, "_blank", "noopener")` 를 부른다. 이 웹뷰(wry)는 새 창
 * 요청 처리기가 없어 그 호출이 **null 을 돌려주고 아무 일도 하지 않는다** —
 * 오류도 없이 조용히. 터미널의 OSC 8 링크가 같은 이유로 죽어 있었다
 * (`features/terminal/urlLinks.ts`, 거기는 `confirm()` 까지 겹쳐 로그에 남았다).
 *
 * `registerLinkOpener` 로 앞에 서서 http/https 만 백엔드 `open_url` 로 보낸다.
 * 그 밖의 스킴(`file:`, `command:` …)은 `false` 를 돌려 Monaco 의 나머지
 * 오프너(명령 링크 등)가 종전대로 처리하게 둔다.
 */

/** Monaco `Uri` 에서 여기 필요한 만큼만 — 실제 타입은 monaco 를 끌어와야 해서. */
export interface LinkResource {
  scheme: string;
  toString(skipEncoding?: boolean): string;
}

export interface LinkOpener {
  open(resource: LinkResource): boolean;
}

export function createExternalLinkOpener(openUrl: (url: string) => void): LinkOpener {
  return {
    open(resource) {
      if (resource.scheme !== "http" && resource.scheme !== "https") return false;
      // Monaco 의 `_doOpenExternal` 과 같은 방식 — `toString()` 은 쿼리의 `=`·`&`
      // 까지 %XX 로 바꿔 놓아 그대로 열면 주소가 깨진다. 인코딩을 건너뛴 문자열을
      // `encodeURI` 로 한 번만 다듬는다.
      openUrl(encodeURI(resource.toString(true)));
      return true;
    },
  };
}
