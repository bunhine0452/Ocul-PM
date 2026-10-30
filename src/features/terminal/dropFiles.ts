/**
 * 터미널에 파일 · 그림 끌어다 놓기 (2026-10-30, Orca 「Drag Files to Agents」 벤치마킹).
 *
 * Finder 에서 놓으면 따옴표 친 경로가 그 세션의 입력에 붙는다 — 바깥 터미널(iTerm · Terminal.app)과
 * 같은 동작이다. Claude Code 는 붙여 넣은 그림 경로를 첨부(`[Image #1]`)로 바꾼다. 붙이기는 xterm 의
 * `paste` 로 — 안의 프로그램이 브래킷 붙여넣기를 켰을 때만 감싼다(셸 프롬프트에 날 escape 가 찍히지 않게).
 *
 * 앱 창은 Tauri 의 드래그-드롭을 켜 둔 채라 DOM `drop` 에는 경로가 없다 — 웹뷰의 `onDragDropEvent` 가
 * 경로와 위치를 준다. 받을 세션은 커서 아래 칸(`data-term-id`)이고, 못 찾으면 고른 세션.
 */
import { useEffect, useState } from "react";

/** 셸에서 그대로 한 낱말이 되는 글자만 있으면 따옴표 없이. */
const BARE = /^[A-Za-z0-9_\-.,/:@%+=~]+$/;
const SQ = "'";
const DQ = '"';

/** 경로 하나를 셸 낱말로 — POSIX 는 작은따옴표(안의 `'` 는 `'\''`), Windows 는 큰따옴표. */
export function shellQuote(path: string, windows: boolean): string {
  if (windows) return BARE.test(path.replace(/\\/g, "/")) ? path : DQ + path.split(DQ).join(DQ + DQ) + DQ;
  return BARE.test(path) ? path : SQ + path.split(SQ).join(SQ + "\\" + SQ + SQ) + SQ;
}

/** 놓인 경로들 → 입력에 붙일 글 (끝에 빈칸 하나 — 이어 쓰기 쉽게). */
export function dropText(paths: readonly string[], windows: boolean): string {
  const words = paths.filter((p) => p.length > 0).map((p) => shellQuote(p, windows));
  return words.length > 0 ? `${words.join(" ")} ` : "";
}

/** 화면 좌표의 터미널 칸 → 그 세션 id. */
export function termIdAt(x: number, y: number): number | null {
  const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  const id = el?.closest<HTMLElement>("[data-term-id]")?.dataset.termId;
  return id ? Number(id) : null;
}

/**
 * 웹뷰의 파일 드롭을 받는다. 돌려주는 것은 지금 그 위에 끌고 있는 세션 id(칸에 테를 두를 때 쓴다).
 * `onDrop` 은 받을 세션과 붙일 글을 받는다.
 */
export function useTerminalFileDrop(
  fallback: number | null,
  windows: boolean,
  onDrop: (id: number, text: string) => void,
): number | null {
  const [over, setOver] = useState<number | null>(null);
  useEffect(() => {
    let off: (() => void) | null = null;
    let alive = true;
    const at = (p: { x: number; y: number }) => {
      const scale = window.devicePixelRatio || 1;
      return termIdAt(p.x / scale, p.y / scale) ?? fallback;
    };
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent(({ payload }) => {
          if (payload.type === "leave") return setOver(null);
          if (payload.type !== "drop") return setOver(at(payload.position));
          setOver(null);
          const id = at(payload.position);
          const text = dropText(payload.paths, windows);
          if (id != null && text) onDrop(id, text);
        }),
      )
      .then((unlisten) => {
        if (alive) off = unlisten;
        else unlisten();
      })
      .catch(() => {
        /* 웹뷰 밖(브라우저 개발 서버 · 테스트)에는 드롭 이벤트가 없다 */
      });
    return () => {
      alive = false;
      off?.();
    };
  }, [fallback, windows, onDrop]);
  return over;
}
