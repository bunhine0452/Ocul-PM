/**
 * 터미널 출력의 `파일:줄` 링크 — 프로바이더 조립 (2026-09-07 에 분리).
 *
 * 스캐너는 `fileLinks.ts` 가, 밑줄은 `linkUnderline.ts` 가, 무엇을 할지는
 * 화면(`TerminalSurface`)이 정한다. 여기는 그 셋을 xterm 의 링크 프로토콜에
 * 맞춰 붙이는 자리다.
 *
 * WebLinks 애드온과 공존한다: URL 은 저쪽이, 상대경로는 이쪽이 맡는다.
 */
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";

import { readLineColumns, scanFileRefs } from "./fileLinks";
import type { LinkUnderline } from "./linkUnderline";

/** ⌘클릭이 화면에 넘기는 것 — 무엇을, 어디에 물어볼지. */
export interface FileRefHit {
  /** 프로젝트 루트 기준 상대 경로. 백엔드가 `secure_join` 으로 다시 판정한다. */
  path: string;
  /** 1-based 줄 번호. 없으면 null. */
  line: number | null;
  /** 클릭 지점의 화면 좌표 — 선택 팝오버의 앵커. */
  rect: { top: number; left: number; bottom: number; right: number };
}

export interface FileRefLinkOptions {
  term: Terminal;
  /** 지금 이 페인이 링크를 열 수 있는가 — 없으면 링크를 아예 만들지 않는다. */
  getActivate: () => ((hit: FileRefHit) => void) | undefined;
  underline: LinkUnderline;
  /** 스캔이 던졌을 때. 링크 하나 못 만드는 것으로 강등하고 이유는 남긴다. */
  onError: (err: unknown) => void;
}

export function createFileRefLinkProvider({
  term,
  getActivate,
  underline,
  onError,
}: FileRefLinkOptions): ILinkProvider {
  // 셀 버퍼를 재사용한다 — 이 경로는 마우스가 움직일 때마다 불린다.
  const cell = term.buffer.active.getNullCell();
  return {
    provideLinks(bufferLineNumber, callback) {
      const activate = getActivate();
      if (!activate) {
        callback(undefined);
        return;
      }
      // 방어 — 여기서 예외가 새면 렌더러 상태에 따라 컴포넌트째 죽는다.
      try {
        // bufferLineNumber 는 이미 스크롤(ydisp)이 반영된 절대 버퍼 줄이다 —
        // viewportY 를 더하면 스크롤백이 쌓인 뒤 엉뚱한 줄을 스캔한다.
        const line = term.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) {
          callback(undefined);
          return;
        }
        const { text, startCol, endCol } = readLineColumns(line, cell);
        const refs = scanFileRefs(text);
        if (refs.length === 0) {
          callback(undefined);
          return;
        }
        const links: ILink[] = [];
        for (const ref of refs) {
          const from = startCol[ref.start];
          const to = endCol[ref.end - 1];
          // 대응이 없으면 만들지 않는다 — 틀린 자리에 링크를 두느니 없는 게 낫다.
          if (from === undefined || to === undefined) continue;
          // xterm 의 x/y 는 1-based, end 는 포함(inclusive)이다.
          const range = {
            start: { x: from + 1, y: bufferLineNumber },
            end: { x: to + 1, y: bufferLineNumber },
          };
          links.push({
            range,
            text: text.slice(ref.start, ref.end),
            hover: () => underline.show(range),
            leave: () => underline.hide(),
            activate: (event) => {
              underline.hide();
              activate({
                path: ref.path,
                line: ref.line,
                rect: {
                  top: event.clientY,
                  bottom: event.clientY,
                  left: event.clientX,
                  right: event.clientX,
                },
              });
            },
          });
        }
        callback(links.length > 0 ? links : undefined);
      } catch (err) {
        onError(err);
        callback(undefined);
      }
    },
  };
}
