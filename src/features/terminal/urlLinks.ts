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
 * 밖으로 내보내는 것은 http/https 뿐이다 (`activateUrl`). `javascript:` 같은
 * 나머지는 백엔드까지 가지 않는다.
 *
 * # `file://` (2026-10-09)
 *
 * `allowNonHttpProtocols` 를 **켰다** — 그 전에는 xterm 이 http/https 밖을
 * 프로바이더 단계에서 걸러 `file://` 링크가 아예 없었다. 앱이 PTY 에
 * `FORCE_HYPERLINK=1` 을 실으면서(`commands/terminal.rs`) Claude Code 가 파일
 * 경로를 `file://` 절대경로로 감싸 보내고, 그 링크가 이제 두 갈래로 간다:
 *  - **이미지** → 올리면 미리보기, 누르면 크게 (`useTerminalFileLinks`)
 *  - 그 밖의 파일 → `src/foo.ts:42` 와 같은 파일 메뉴 (프로젝트 안일 때만)
 *
 * 두 번째 갈래는 선택이 아니다. 같은 칸에 OSC 링크와 우리 `파일:줄` 프로바이더가
 * 함께 걸리면 xterm 은 **먼저 등록된 쪽**(코어의 OSC 프로바이더)을 고른다 —
 * 이 갈래가 없으면 Claude Code 가 찍은 `src/foo.ts` 를 눌러도 아무 일이 없다.
 *
 * 열 수 없는 스킴(`javascript:`·`vscode:` …)은 xterm 이 손 모양 커서는 그대로
 * 그리지만 밑줄은 긋지 않고, 눌러도 아무 데도 가지 않는다.
 */
import type { IBufferRange, ILinkHandler } from "@xterm/xterm";

import { previewKindFor } from "@/features/code/previewKind";
import type { LinkUnderline } from "./linkUnderline";

/** 밖으로 내보내는 스킴 — `src/lib/externalLinks.ts` 와 같은 판정이다. */
const OPENABLE = /^https?:\/\//i;

export function isOpenableUrl(uri: string): boolean {
  return OPENABLE.test(uri.trim());
}

/** OSC 8 `file://` 링크에서 일어난 일 — 무엇을 할지는 화면이 정한다. */
export type FileLinkEvent =
  | { kind: "hover" | "open"; path: string; image: boolean; x: number; y: number }
  | { kind: "leave" };

export interface UrlLinkDeps {
  /** OS 기본 브라우저로 연다 (백엔드 `open_url`). 스킴 검사는 이쪽이 끝낸 뒤다. */
  openUrl: (uri: string) => void;
  underline: LinkUnderline;
  /**
   * `file://` 링크를 받을 곳 — 링크를 만질 때마다 묻는다(화면이 나중에 붙이거나
   * 뗄 수 있다). 없으면 밑줄도 반응도 없다: 눌러도 아무 일 없는 밑줄은 거짓말이다.
   */
  getFileLink?: () => ((event: FileLinkEvent) => void) | undefined;
}

/**
 * `file:///private/tmp/a%20b.png` → `/private/tmp/a b.png`. 다른 호스트를
 * 가리키는 `file://host/…` 와 깨진 퍼센트 인코딩은 `null`.
 * Windows 의 `file:///C:/x.png` 는 `C:/x.png` 로 편다.
 */
export function fileUriToPath(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;
  if (url.hostname !== "" && url.hostname !== "localhost") return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (/^\/[A-Za-z]:\//.test(path)) return path.slice(1);
  return path.startsWith("/") ? path : null;
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
  const fileEvent = (kind: "hover" | "open", event: MouseEvent, path: string): FileLinkEvent => ({
    kind,
    path,
    image: previewKindFor(path) === "image",
    x: event.clientX,
    y: event.clientY,
  });
  return {
    activate: (event, uri) => {
      const path = fileUriToPath(uri);
      if (path === null) return activateUrl(deps, uri);
      deps.underline.hide();
      deps.getFileLink?.()?.(fileEvent("open", event, path));
    },
    hover: (event, uri, range: IBufferRange) => {
      const path = fileUriToPath(uri);
      if (path === null) {
        if (isOpenableUrl(uri)) deps.underline.show(range);
        return;
      }
      const onFileLink = deps.getFileLink?.();
      if (!onFileLink) return;
      deps.underline.show(range);
      onFileLink(fileEvent("hover", event, path));
    },
    leave: () => {
      deps.underline.hide();
      deps.getFileLink?.()?.({ kind: "leave" });
    },
    // `file://` 를 받으려면 켜야 한다 — 그 밖의 스킴을 막는 일은 위 두 함수가 한다.
    allowNonHttpProtocols: true,
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
