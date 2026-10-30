/**
 * 터미널의 링크 — OSC 8 하이퍼링크와 출력에 찍힌 이미지 경로 (2026-10-30, 3.12.0 의 미리보기를 다시).
 *
 * # 두 갈래
 *
 * - **OSC 8 하이퍼링크** (`ESC ] 8 ; ; url ST`) — gh CLI · `ls --hyperlink` · Claude Code 가 쏜다.
 *   xterm 은 이것을 `linkHandler` 옵션으로만 넘기고, 없으면 기본 처리기가 `confirm()` →
 *   `window.open()` 을 부른다. 웹뷰에서는 둘 다 막혀 **눌러도 아무 일이 없었다**(4.0 터미널).
 *   여기서 http(s) 는 OS 브라우저로, `file://` 이미지는 미리보기로 보낸다. Claude Code 가 경로를
 *   `file://` 로 감싸려면 PTY 의 `FORCE_HYPERLINK=1` 이 있어야 한다(`src-tauri/src/terminal.rs`).
 * - **맨 글자 이미지 경로** — 하이퍼링크를 안 쏘는 도구(`ls`, 스크립트, 도구 출력)도 있다. 한 줄
 *   안의 절대경로 `…/x.png` 를 찾아 같은 미리보기로. 줄을 넘긴 경로는 OSC 8 만 잇는다.
 *
 * 무엇을 띄울지는 `imagePeek.ts` 가 정한다 — 여기는 링크를 찾아 사건으로 바꾸기만 한다.
 */
import type { IBufferRange, ILink, ILinkHandler, ILinkProvider } from "@xterm/xterm";

import type { FileMenuAt } from "./fileRefs";

/** 미리 보는 이미지 확장자 — 백엔드 `commands/term_image.rs` 의 `IMAGE_EXT` 와 같다. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

/** 이미지 링크에서 일어난 일 — `imagePeek.ts` 가 받는다. */
export type ImageLinkEvent =
  | { kind: "hover" | "open"; path: string; x: number; y: number }
  | { kind: "leave" };

/** 밖으로 내보내는 스킴은 http/https 뿐 — `javascript:` 같은 나머지는 백엔드까지 가지 않는다. */
export function isOpenableUrl(uri: string): boolean {
  return /^https?:\/\//i.test(uri.trim());
}

/**
 * `file:///private/tmp/a%20b.png` → `/private/tmp/a b.png`. 다른 호스트의 `file://host/…` 와
 * 깨진 퍼센트 인코딩은 `null`. Windows 의 `file:///C:/x.png` 는 `C:/x.png`.
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

export interface LinkDeps {
  openUrl: (uri: string) => void;
  onImage: (event: ImageLinkEvent) => void;
  /** 이미지가 아닌 `file://` — 「이 파일로 할 일」 메뉴(`fileRefs.ts`). */
  onFile?: (at: FileMenuAt) => void;
}

/** xterm `linkHandler` 옵션 — OSC 8 하이퍼링크. */
export function createOscLinkHandler(deps: LinkDeps): ILinkHandler {
  const imageOf = (uri: string) => {
    const path = fileUriToPath(uri);
    return path !== null && isImagePath(path) ? path : null;
  };
  return {
    activate: (event, uri) => {
      const path = imageOf(uri);
      if (path) return deps.onImage({ kind: "open", path, x: event.clientX, y: event.clientY });
      if (isOpenableUrl(uri)) return deps.openUrl(uri.trim());
      // 이미지가 아닌 `file://` 는 파일 메뉴로 — 같은 칸의 맨 글자 경로 프로바이더보다 이 링크가 먼저라
      // 여기서 넘기지 않으면 Claude Code 가 감싼 경로는 눌러도 아무 일이 없다. 그 밖의 스킴은 조용히.
      const file = fileUriToPath(uri);
      if (file !== null) deps.onFile?.({ path: file, line: null, x: event.clientX, y: event.clientY });
    },
    hover: (event, uri) => {
      const path = imageOf(uri);
      if (path) deps.onImage({ kind: "hover", path, x: event.clientX, y: event.clientY });
    },
    leave: () => deps.onImage({ kind: "leave" }),
    // `file://` 를 받으려면 켜야 한다 — 그 밖의 스킴을 막는 일은 위 세 함수가 한다.
    allowNonHttpProtocols: true,
  };
}

/**
 * 한 줄 안의 절대 이미지 경로 — `[시작, 끝)` 글자 위치. 앞은 줄머리 · 공백 · 따옴표 · 괄호,
 * 뒤는 줄끝 · 공백 · 따옴표 · 닫는 괄호 · 문장부호. 공백이 든 경로는 잡지 않는다.
 */
export function findImagePaths(text: string): { start: number; end: number; path: string }[] {
  const re = /(^|[\s'"`([<])((?:\/|[A-Za-z]:[\\/])[^\s'"`()<>[\]{}|;]*\.(?:png|jpe?g|gif|webp|avif|bmp|ico))(?=$|[\s'"`)\]>,.:;])/gi;
  const out: { start: number; end: number; path: string }[] = [];
  for (const m of text.matchAll(re)) {
    const start = (m.index ?? 0) + m[1].length;
    out.push({ start, end: start + m[2].length, path: m[2] });
  }
  return out;
}

/** xterm 버퍼 줄의 필요한 모양만 — 테스트가 가짜 줄을 넘긴다. */
export interface CellLine {
  length: number;
  getCell(x: number): { getChars(): string; getWidth(): number } | undefined;
}

/**
 * 버퍼 줄 → 글자와 글자마다의 칸(0부터). 넓은 글자(한글)는 두 칸이라 글자 위치와 칸 위치가
 * 어긋난다 — 링크 범위는 칸으로 줘야 밑줄이 제자리에 그어진다.
 */
export function lineCells(line: CellLine): { text: string; first: number[]; last: number[] } {
  let text = "";
  const first: number[] = [];
  const last: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) break;
    const width = cell.getWidth();
    if (width === 0) continue; // 넓은 글자의 뒤 칸
    const chars = cell.getChars() || " ";
    for (let i = 0; i < chars.length; i++) {
      first.push(x);
      last.push(x + width - 1);
    }
    text += chars;
  }
  return { text, first, last };
}

/** 맨 글자 이미지 경로의 링크 프로바이더. */
export function createImagePathProvider(
  getLine: (y: number) => CellLine | undefined,
  onImage: (event: ImageLinkEvent) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const line = getLine(y - 1);
      if (!line) return callback(undefined);
      const { text, first, last } = lineCells(line);
      const links: ILink[] = findImagePaths(text).map(({ start, end, path }) => {
        const range: IBufferRange = { start: { x: first[start] + 1, y }, end: { x: last[end - 1] + 1, y } };
        return {
          range,
          text: path,
          decorations: { underline: true, pointerCursor: true },
          activate: (event) => onImage({ kind: "open", path, x: event.clientX, y: event.clientY }),
          hover: (event) => onImage({ kind: "hover", path, x: event.clientX, y: event.clientY }),
          leave: () => onImage({ kind: "leave" }),
        };
      });
      callback(links.length > 0 ? links : undefined);
    },
  };
}
