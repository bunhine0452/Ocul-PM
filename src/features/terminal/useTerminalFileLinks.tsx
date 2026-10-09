import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useT } from "@/i18n";
import { toast } from "@/lib/toast";
import type { FileRefHit } from "./fileRefLinks";
import { TerminalImagePeek } from "./TerminalImagePeek";
import type { FileLinkEvent } from "./urlLinks";

// 터미널의 OSC 8 `file://` 링크를 화면 동작으로 바꾼다 (2026-10-09).
//
// 이미지는 올리기만 해도 그림이 뜬다 — Claude Code 가 그림을 만든 뒤 찍는
// `› [image] /private/tmp/…/x.png (1.9MB)` 가 출발점이다. 터미널은 경로 글자만
// 받으므로 그 자리에 그림을 끼워 넣을 수는 없다 (TUI 가 화면을 자기 좌표로 다시
// 그린다). 그래서 글자 위에 띄운다. 누르면 크게 고정된다.
//
// 이미지가 아닌 파일은 `src/foo.ts:42` 와 같은 파일 메뉴로 보낸다 — 근거는
// `urlLinks.ts` 머리말.

/** 지나가는 마우스에 그림이 번쩍이지 않게 — 이만큼 머물러야 띄운다. */
const HOVER_DELAY_MS = 120;

interface Peek {
  path: string;
  x: number;
  y: number;
  pinned: boolean;
}

/**
 * 절대경로 → 프로젝트 루트 기준 상대경로. 루트 밖이거나 루트 자신이면 `null`.
 * 백엔드가 `secure_join` 으로 다시 판정하므로 여기는 표시용 자르기다.
 */
export function relativeToRoot(path: string, root: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const base = norm(root).replace(/\/+$/, "");
  const full = norm(path);
  if (!base || !full.startsWith(`${base}/`)) return null;
  const rel = full.slice(base.length + 1);
  return rel ? rel : null;
}

export function useTerminalFileLinks(
  projectRoot: string | null,
  openFileMenu: (hit: FileRefHit) => void,
): { onFileLink: (event: FileLinkEvent) => void; peek: ReactNode } {
  const { t } = useT();
  const [peek, setPeek] = useState<Peek | null>(null);
  const timerRef = useRef<number | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  useEffect(() => clearTimer, [clearTimer]);

  const onFileLink = useCallback(
    (event: FileLinkEvent) => {
      if (event.kind === "leave") {
        clearTimer();
        setPeek((cur) => (cur?.pinned ? cur : null));
        return;
      }
      const { path, x, y } = event;
      if (event.image) {
        clearTimer();
        if (event.kind === "open") {
          setPeek({ path, x, y, pinned: true });
          return;
        }
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          // 크게 띄워 둔 동안에는 다른 링크에 스쳐도 바꾸지 않는다.
          setPeek((cur) => (cur?.pinned ? cur : { path, x, y, pinned: false }));
        }, HOVER_DELAY_MS);
        return;
      }
      if (event.kind !== "open") return;
      const rel = projectRoot ? relativeToRoot(path, projectRoot) : null;
      if (rel === null) {
        toast.info(t("term.fileLink.outside"));
        return;
      }
      openFileMenu({ path: rel, line: null, rect: { top: y, bottom: y, left: x, right: x } });
    },
    [projectRoot, openFileMenu, clearTimer, t],
  );

  const close = useCallback(() => setPeek(null), []);
  return {
    onFileLink,
    peek: peek ? <TerminalImagePeek {...peek} onClose={close} /> : null,
  };
}
