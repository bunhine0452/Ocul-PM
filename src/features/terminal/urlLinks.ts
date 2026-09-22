/**
 * 터미널 URL 링크 — 본문에 찍힌 URL 과 OSC 8 하이퍼링크의 공통 처리기 (2026-09-22).
 *
 * # 왜 따로 있는가
 *
 * xterm 은 URL 을 두 갈래로 링크로 만든다.
 *  - **본문 URL**: `WebLinksAddon` 이 정규식으로 찾는다. 우리 핸들러를 받는다.
 *  - **OSC 8 하이퍼링크**: `ls --hyperlink`, gh CLI, Claude Code TUI 가 쏘는
 *    `ESC ] 8 ; ; url ST` 로, 화면의 글자는 아무 것이든 될 수 있다. 이건
 *    **`linkHandler` 옵션**을 따로 봐야 하며, 없으면 xterm 의 기본 처리기가
 *    `confirm()` → `window.open()` 을 부른다.
 *
 * 기본 처리기가 Tauri 웹뷰에서 어떻게 되는지 (oculpm.log 2026-09-21):
 *  1. Tauri 의 dialog 플러그인이 `window.confirm` 을 가로채 `plugin:dialog|confirm`
 *     을 부른다 → ACL 에 없어 거부 → `unhandled rejection`.
 *  2. 가로챈 함수는 **Promise 를 돌려주므로** `if (confirm(...))` 은 항상
 *     truthy — 사용자에게 묻지도 않고 지나간다.
 *  3. WKWebView 의 `window.open()` 은 null → "Opening link blocked as opener
 *     could not be cleared" 경고. **링크는 열리지 않고 에러 둘만 남는다.**
 *
 * 여기서는 두 갈래를 **같은 통로**(백엔드 `open_url` → OS 기본 브라우저)로
 * 모으고, 밑줄도 파일 링크와 같은 오버레이를 쓴다.
 *
 * # 스킴
 *
 * `allowNonHttpProtocols` 는 켜지 않는다 — xterm 이 http/https 밖(`file:`,
 * `javascript:` …)을 프로바이더 단계에서 걸러 우리에게 오지도 않는다. 그래도
 * `activate` 에서 한 번 더 본다: 옵션이 나중에 켜지더라도 `javascript:` 가
 * 백엔드까지 가지 않게 하는 마지막 방어선이다. 백엔드(`open_url`)는 그 위에
 * `mailto:` 도 받지만, 터미널이 하이퍼링크로 쏜 `mailto:` 는 xterm 이 먼저
 * 걸러 실제로는 오지 않는다.
 */
import type { IBufferRange, ILinkHandler } from "@xterm/xterm";

import type { LinkUnderline } from "./linkUnderline";

/** 밖으로 내보내는 스킴 — `src/lib/externalLinks.ts` 와 같은 판정이다. */
const OPENABLE = /^https?:\/\//i;

export function isOpenableUrl(uri: string): boolean {
  return OPENABLE.test(uri.trim());
}

export interface UrlLinkDeps {
  /** OS 기본 브라우저로 연다 (백엔드 `open_url`). 스킴 검사는 이쪽이 끝낸 뒤다. */
  openUrl: (uri: string) => void;
  underline: LinkUnderline;
}

/** 스킴이 허용되면 열고, 아니면 조용히 무시한다 (열린 것처럼 보이지 않게). */
export function activateUrl(deps: UrlLinkDeps, uri: string): void {
  if (!isOpenableUrl(uri)) return;
  deps.openUrl(uri.trim());
}

/**
 * xterm `linkHandler` 옵션 — OSC 8 하이퍼링크.
 *
 * `new Terminal({...})` 의 옵션이 아니라 **나중에** `term.options.linkHandler`
 * 로 붙인다: 밑줄 오버레이가 Terminal 인스턴스를 필요로 해서 생성 뒤에야
 * 만들 수 있고, xterm 은 이 옵션을 링크를 만들 때마다 다시 읽는다.
 */
export function createOscLinkHandler(deps: UrlLinkDeps): ILinkHandler {
  return {
    activate: (_event, uri) => activateUrl(deps, uri),
    hover: (_event, _uri, range: IBufferRange) => deps.underline.show(range),
    leave: () => deps.underline.hide(),
    // 명시적으로 끈다 — 기본값도 꺼져 있지만, 위 설명의 방어선이 왜 있는지
    // 읽는 사람이 여기서 바로 보게.
    allowNonHttpProtocols: false,
  };
}

/** `WebLinksAddon` 생성자 인자 — 본문 URL. OSC 8 과 같은 통로를 탄다. */
export function createWebLinksOptions(deps: UrlLinkDeps): {
  handler: (event: MouseEvent, uri: string) => void;
  options: {
    hover: (event: MouseEvent, text: string, range: IBufferRange) => void;
    leave: (event: MouseEvent, text: string) => void;
  };
} {
  return {
    handler: (_event, uri) => activateUrl(deps, uri),
    options: {
      hover: (_event, _text, range) => deps.underline.show(range),
      leave: () => deps.underline.hide(),
    },
  };
}
