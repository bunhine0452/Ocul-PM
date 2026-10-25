// 열린 파일의 외부 변경 감지 (watcher) — 깨끗한 버퍼는 조용히 최신화(상태바에 잠깐
// 「다시 불러옴」), 미저장이면 충돌, 미리보기는 자산 재독, 사라진 파일은 「지워짐」 띠.
// `CodePane.tsx` 에서 그대로 들어냈다.
import { useEffect, useRef, useState } from "react";
import type React from "react";

import { codeApi } from "@/api/code";
import { oculpmApi } from "@/api/oculpm";
import { safeUnlistenPromise } from "@/lib/unlisten";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";

import { previewKindFor } from "../previewKind";
import {
  bufferKey,
  detectEol,
  normalizeEol,
  putBuffer,
  type CodeBuffer,
} from "../codeBuffers";
import type { PendingJump } from "./types";

/** `code_write` 가 「디스크에 없음」을 말하는 해시 자리 (`read_write.rs` `GONE_HASH`). */
export const GONE_HASH = "";

/** 「다시 불러옴」 알림이 상태바에 머무는 시간. */
const RELOADED_NOTICE_MS = 4000;

interface Args {
  projectId: number;
  pathRef: React.RefObject<string | null>;
  bufferRef: React.RefObject<CodeBuffer | null>;
  cursorRef: React.RefObject<{ line: number; col: number }>;
  refreshHistorySoon: () => void;
  setPreviewEpoch: React.Dispatch<React.SetStateAction<number>>;
  setPendingJump: React.Dispatch<React.SetStateAction<PendingJump | null>>;
  setEditorEpoch: React.Dispatch<React.SetStateAction<number>>;
  setConflict: React.Dispatch<React.SetStateAction<{ diskHash: string } | null>>;
}

export function useExternalChanges({
  projectId,
  pathRef,
  bufferRef,
  cursorRef,
  refreshHistorySoon,
  setPreviewEpoch,
  setPendingJump,
  setEditorEpoch,
  setConflict,
}: Args) {
  // watcher 가 "파일이 사라졌다" 를 같은 파일에 반복하지 않기 위한 부기.
  const goneNotifiedRef = useRef<string | null>(null);
  // 깨끗한 버퍼를 바깥 판으로 갈아 끼운 순간 — 상태바가 몇 초 동안 말한다. 조용히만
  // 바꾸면 읽던 글이 눈앞에서 바뀌어도 왜 바뀌었는지 알 길이 없다 (2026-10-25).
  const [reloaded, setReloaded] = useState(0);
  useEffect(() => {
    if (!reloaded) return;
    const id = window.setTimeout(() => setReloaded(0), RELOADED_NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [reloaded]);

  // ── 열린 파일의 외부 변경 감지 (watcher) ───────────────────────────────
  useEffect(() => {
    const un = oculpmApi.onFileChanged((payload) => {
      if (payload.project_id !== projectId) return;
      const path = pathRef.current;
      if (!path || payload.event.path !== path) return;
      // 캡처는 이 이벤트 **뒤에** fire-and-forget 으로 돈다 — 곧바로 물으면
      // 방금 그 판이 아직 없다. 잠깐 뒤에 다시 센다.
      refreshHistorySoon();
      void (async () => {
        // 미리보기 파일은 본문이 아니라 자산을 다시 읽는다 — 에이전트가 스크린샷을
        // 갈아 끼우면 화면도 따라가야 한다.
        if (previewKindFor(path)) {
          setPreviewEpoch((n) => n + 1);
          return;
        }
        const file = await codeApi.read(projectId, path).catch(() => null);
        if (pathRef.current !== path) return;
        if (file == null) {
          // 외부에서 파일이 지워지거나 이동됐다 — 조용히 삼키면 사용자는
          // 저장 실패에서야 알게 된다. 같은 파일에 한 번만 알린다. 편집기에 본문이
          // 남아 있으면 「지워짐」 띠(다시 만들기)로, 아니면 토스트로.
          if (goneNotifiedRef.current !== path) {
            goneNotifiedRef.current = path;
            if (bufferRef.current) setConflict({ diskHash: GONE_HASH });
            else toast.warning(t("code.fileGone", { path }));
          }
          return;
        }
        goneNotifiedRef.current = null;
        const buf = bufferRef.current;
        if (!buf || file.binary || file.too_large) return;
        if (file.hash === buf.baseHash) return; // 자기 저장의 에코
        if (buf.text === buf.baseText) {
          // 깨끗한 버퍼 — 조용히 최신화하되 읽던 줄은 유지한다.
          const eol = detectEol(file.content);
          const text = normalizeEol(file.content);
          const fresh: CodeBuffer = { text, baseText: text, baseHash: file.hash, eol };
          bufferRef.current = fresh;
          putBuffer(bufferKey(projectId, path), fresh);
          setPendingJump({ line: cursorRef.current.line });
          setEditorEpoch((n) => n + 1);
          setReloaded(Date.now());
        } else {
          setConflict({ diskHash: file.hash });
        }
      })();
    });
    return () => safeUnlistenPromise(un);
  }, [
    projectId,
    refreshHistorySoon,
    pathRef,
    bufferRef,
    cursorRef,
    setPreviewEpoch,
    setPendingJump,
    setEditorEpoch,
    setConflict,
  ]);
  return reloaded !== 0;
}
