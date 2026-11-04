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
 * - **맨 글자 이미지 경로** — 하이퍼링크를 안 쏘는 도구(`ls`, 스크립트, 도구 출력)도 있다. 절대경로
 *   `…/x.png` 를 찾아 같은 미리보기로. **줄을 넘긴 경로도 잇는다**(11-04) — Claude Code 는 긴 경로를 제
 *   폭에서 끊고 다음 줄을 들여 쓴다(`/private/tmp/…/b8d4-` ⏎ `  f327…/before-home.png`). 한 줄씩만 보던
 *   때는 두 조각 다 이미지 경로가 아니라 아무 일도 없었다(`wrappedChain`).
 *
 * 누르면 **그 파일을 Finder 에서 연다**(11-04 「클릭 시 경로로 이동」), ⌘ 를 누른 채 누르면 크게 본다.
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
  | { kind: "hover" | "open" | "reveal"; path: string; x: number; y: number }
  | { kind: "leave" };

/** 누름의 뜻 — 그냥 누르면 Finder 에서(경로로 이동), ⌘(Ctrl) 를 누른 채면 크게. */
function clickKind(event: MouseEvent): "open" | "reveal" {
  return event.metaKey || event.ctrlKey ? "open" : "reveal";
}

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
      if (path) return deps.onImage({ kind: clickKind(event), path, x: event.clientX, y: event.clientY });
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
  /** 앞 줄이 폭에 차서 이어진 줄(xterm 의 소프트 줄바꿈). */
  isWrapped?: boolean;
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

/** 이어 붙일 줄은 이만큼까지 — 한 경로가 여섯 줄을 넘는 일은 없다. */
const MAX_CHAIN = 6;
/** 이 칸 수 안쪽에서 끝난 줄만 「폭에서 끊겼다」 고 본다 — 낱말 단위 줄바꿈은 다음 조각이 안 들어가면 일찍 끊는다. */
const EDGE_SLACK = 20;
/** 경로 조각 — 공백 · 따옴표 · 괄호가 없는 끝 덩어리. */
const PATH_TAIL = /[^\s'"`()<>[\]{}|;]+$/;

interface Row {
  y: number;
  text: string;
  first: number[];
  last: number[];
  wrapped: boolean;
}

/**
 * `a` 줄의 끝이 `b` 줄로 이어지는 경로 조각인가 — 그렇다면 `b` 에서 이어 붙일 첫 글자 위치를 돌려준다.
 * 소프트 줄바꿈(`b.wrapped`)이면 그대로, 아니면(TUI 가 직접 끊고 들여 쓴 줄) 폭 가까이에서 끝났을 때만
 * `b` 의 앞 공백을 건너뛴다. `a` 의 끝 조각이 이미 이미지 확장자로 끝나면 잇지 않는다.
 */
function continuation(a: Row, b: Row, cols: number): number | null {
  const end = a.text.replace(/\s+$/, "");
  const tail = PATH_TAIL.exec(end)?.[0];
  if (!tail || IMAGE_EXT.test(tail)) return null;
  if (b.wrapped) return end.length === a.text.length ? 0 : null;
  const lastCell = a.last[end.length - 1] ?? 0;
  if (lastCell < cols - EDGE_SLACK) return null;
  const lead = /^\s*/.exec(b.text)![0].length;
  return lead < b.text.length ? lead : null;
}

/**
 * `y` 줄을 품은 이어진 줄 묶음 — 줄마다 붙인 글자의 시작 위치와 함께. 이어지지 않으면 그 줄 하나.
 * 이어 붙인 글자의 위치 → (줄, 칸) 을 되짚을 수 있게 조각마다 시작 오프셋을 남긴다.
 */
export function wrappedChain(
  getLine: (y: number) => CellLine | undefined,
  y: number,
  cols: number,
): { text: string; pieces: { row: Row; from: number; at: number }[] } | null {
  const rowAt = (yy: number): Row | null => {
    const line = yy >= 0 ? getLine(yy) : undefined;
    if (!line) return null;
    return { y: yy, ...lineCells(line), wrapped: line.isWrapped === true };
  };
  const here = rowAt(y);
  if (!here) return null;
  const rows: { row: Row; from: number }[] = [{ row: here, from: 0 }];
  // 뒤로 — 이 줄이 앞 줄의 이어짐인가.
  for (let i = 0; i < MAX_CHAIN; i++) {
    const prev = rowAt(rows[0].row.y - 1);
    const from = prev ? continuation(prev, rows[0].row, cols) : null;
    if (!prev || from === null) break;
    rows[0].from = from;
    rows.unshift({ row: prev, from: 0 });
  }
  // 앞으로 — 다음 줄이 이 줄의 이어짐인가.
  for (let i = 0; i < MAX_CHAIN; i++) {
    const cur = rows[rows.length - 1].row;
    const next = rowAt(cur.y + 1);
    const from = next ? continuation(cur, next, cols) : null;
    if (!next || from === null) break;
    rows.push({ row: next, from });
  }
  let text = "";
  const pieces = rows.map(({ row, from }, i) => {
    // 이어지는 줄의 끝 공백은 떼고 붙인다(마지막 줄은 그대로 — 경로 뒤의 문장이 그 줄에 있다).
    const body = i < rows.length - 1 ? row.text.slice(from).replace(/\s+$/, "") : row.text.slice(from);
    const at = text.length;
    text += body;
    return { row, from, at };
  });
  return { text, pieces };
}

/** 맨 글자 이미지 경로의 링크 프로바이더. `getCols` 는 터미널 폭(줄을 넘긴 경로를 알아보는 데 쓴다). */
export function createImagePathProvider(
  getLine: (y: number) => CellLine | undefined,
  onImage: (event: ImageLinkEvent) => void,
  getCols: () => number = () => Number.MAX_SAFE_INTEGER,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const chain = wrappedChain(getLine, y - 1, getCols());
      if (!chain) return callback(undefined);
      // 이어 붙인 글자 위치 → 1부터 센 (칸, 줄).
      const cellOf = (pos: number, side: "first" | "last"): { x: number; y: number } => {
        let piece = chain.pieces[0];
        for (const p of chain.pieces) if (p.at <= pos) piece = p;
        const idx = piece.from + (pos - piece.at);
        return { x: piece.row[side][idx] + 1, y: piece.row.y + 1 };
      };
      const links: ILink[] = [];
      for (const { start, end, path } of findImagePaths(chain.text)) {
        const range: IBufferRange = { start: cellOf(start, "first"), end: cellOf(end - 1, "last") };
        // 이 줄에 걸친 경로만 — 묶음의 다른 줄 경로는 그 줄을 물을 때 돌려준다.
        if (range.start.y > y || range.end.y < y) continue;
        links.push({
          range,
          text: path,
          decorations: { underline: true, pointerCursor: true },
          activate: (event) => onImage({ kind: clickKind(event), path, x: event.clientX, y: event.clientY }),
          hover: (event) => onImage({ kind: "hover", path, x: event.clientX, y: event.clientY }),
          leave: () => onImage({ kind: "leave" }),
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}
