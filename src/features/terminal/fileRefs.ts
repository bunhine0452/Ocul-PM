/**
 * 터미널에 찍힌 파일 경로 → 「이 파일로 할 일」 메뉴 (10-31, 3.x 의 ⌘클릭 메뉴를 4.x 터미널에 다시).
 *
 * 컴파일러 · 테스트 러너 · 린터 · Claude Code 가 쏟아내는 `src/lib/foo.ts:42:7` 을 ⌘클릭(Windows ·
 * Linux 는 Ctrl+클릭)하면 Finder 에서 보기 · 빠른 미리보기 · 외부 편집기 메뉴가 뜬다. Claude Code 가
 * 경로를 `file://` 하이퍼링크로 감싸 보내면(OSC 8) 그 링크는 그냥 눌러도 같은 메뉴다 — 같은 칸에서는
 * 코어 OSC 링크가 이 프로바이더보다 먼저라, 그쪽(`fileLinks.ts` 의 처리기)이 여기로 넘긴다.
 *
 * # 신뢰 경계
 *
 * 여기서 뽑은 경로는 **터미널로 흘러든 임의의 바이트**다. 이 모듈은 후보를 표시할 뿐이고, 실제 열기는
 * 백엔드(`commands/external_editor.rs`)가 프로젝트 루트 안쪽인지 다시 판정한다. 여기서도 명백히 거절될
 * 형태(맨 글자 절대경로 · `..` · URL)는 링크로 만들지 않는다 — 눌렀는데 거절당하는 링크는 거짓말이다.
 */
import { useSyncExternalStore } from "react";
import type { IBufferRange, ILink, ILinkProvider } from "@xterm/xterm";

import { isMac } from "@/lib/platform";
import { lineCells, type CellLine } from "./fileLinks";

export interface FileRef {
  /** 프로젝트 루트 기준 상대경로. */
  path: string;
  /** 1-based 줄 번호. 없으면 null. */
  line: number | null;
  /** 원문에서의 시작 · 끝(배타) 글자 위치. */
  start: number;
  end: number;
}

/**
 * `path/to/file.ext`, 뒤에 `:12` 또는 `:12:5` 가 붙을 수 있다. 확장자를 요구한다 — 없으면 `foo:1` 같은
 * 일반 글자가 전부 링크가 된다. 경로 글자는 공백 · 따옴표 · 괄호를 뺀 것만.
 */
const FILE_REF = /(?:^|[\s'"([<])((?:\.{1,2}\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z]\w{0,9})(?::(\d+))?/g;

function isRejectable(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("~")) return true; // 맨 글자 절대경로
  if (/(^|\/)\.\.(\/|$)/.test(path)) return true; // 상위 탈출
  return /^[A-Za-z]:[\\/]/.test(path); // Windows 드라이브
}

/** 한 줄의 파일 참조 — 위치는 글자 기준(0부터). 칸으로 바꾸는 것은 `lineCells` 가 한다. */
export function scanFileRefs(text: string): FileRef[] {
  const out: FileRef[] = [];
  FILE_REF.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_REF.exec(text)) !== null) {
    const [whole, rawPath, lineStr] = match;
    const pathStart = match.index + whole.indexOf(rawPath);
    // URL 은 웹 링크 애드온 몫 — `https://x.com/a.js` 를 가로채지 않는다.
    if (/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S*$/.test(text.slice(0, pathStart))) continue;
    if (isRejectable(rawPath)) continue;
    const parsed = lineStr ? Number.parseInt(lineStr, 10) : Number.NaN;
    const line = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    out.push({
      path: rawPath.startsWith("./") ? rawPath.slice(2) : rawPath,
      line,
      start: pathStart,
      // 줄 번호까지 범위에 — `foo.ts:42` 전체가 눌린다.
      end: pathStart + rawPath.length + (lineStr ? lineStr.length + 1 : 0),
    });
  }
  return out;
}

/** 절대경로면 프로젝트 루트 기준으로 — 루트 밖이면 `null`. 이미 상대경로면 그대로. */
export function relativeToRoot(path: string, root: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = norm(path);
  if (!/^(\/|[A-Za-z]:\/)/.test(p)) return p.startsWith("./") ? p.slice(2) : p;
  const r = norm(root);
  return p.startsWith(r + "/") ? p.slice(r.length + 1) : null;
}

/** 맨 글자 경로가 메뉴를 여는 클릭 — 그냥 누르는 것은 포커스 · 선택이다. */
export function isRefClick(e: MouseEvent): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

/** 메뉴를 띄울 자리 — 경로(상대 또는 절대)와 줄, 누른 곳. */
export interface FileMenuAt {
  path: string;
  line: number | null;
  x: number;
  y: number;
}

let current: FileMenuAt | null = null;
const subs = new Set<() => void>();

function set(next: FileMenuAt | null) {
  current = next;
  for (const fn of subs) fn();
}

export function openFileMenu(at: FileMenuAt): void {
  set(at);
}

export function closeFileMenu(): void {
  if (current) set(null);
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useFileMenu(): FileMenuAt | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** 맨 글자 파일 참조의 링크 프로바이더. */
export function createFileRefProvider(
  getLine: (y: number) => CellLine | undefined,
  onRef: (at: FileMenuAt) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const line = getLine(y - 1);
      if (!line) return callback(undefined);
      const { text, first, last } = lineCells(line);
      const links: ILink[] = scanFileRefs(text).map(({ start, end, path, line: ln }) => {
        const range: IBufferRange = { start: { x: first[start] + 1, y }, end: { x: last[end - 1] + 1, y } };
        return {
          range,
          text: path,
          decorations: { underline: true, pointerCursor: true },
          activate: (event) => {
            if (isRefClick(event)) onRef({ path, line: ln, x: event.clientX, y: event.clientY });
          },
        };
      });
      callback(links.length > 0 ? links : undefined);
    },
  };
}
