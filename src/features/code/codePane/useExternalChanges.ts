// 열린 파일의 외부 변경 감지 (watcher) — 깨끗한 버퍼는 조용히 최신화, 미저장이면 충돌,
// 미리보기는 자산 재독, 사라진 파일은 한 번만 알린다. `CodePane.tsx` 에서 그대로 들어냈다.
import { useEffect, useRef } from "react";
import type React from "react";

import { commands, events } from "@/lib/bindings";
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
  // watcher 가 "파일이 사라졌다" 토스트를 같은 파일에 반복하지 않기 위한 부기.
  const goneNotifiedRef = useRef<string | null>(null);

  // ── 열린 파일의 외부 변경 감지 (watcher) ───────────────────────────────
  useEffect(() => {
    const un = events.oculpmFileChanged.listen(({ payload }) => {
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
        const res = await commands.codeRead(projectId, path);
        if (pathRef.current !== path) return;
        if (res.status !== "ok") {
          // 외부에서 파일이 지워지거나 이동됐다 — 조용히 삼키면 사용자는
          // 저장 실패에서야 알게 된다. 같은 파일에 한 번만 알린다.
          if (goneNotifiedRef.current !== path) {
            goneNotifiedRef.current = path;
            toast.warning(t("code.fileGone", { path }));
          }
          return;
        }
        goneNotifiedRef.current = null;
        const buf = bufferRef.current;
        if (!buf || res.data.binary || res.data.too_large) return;
        if (res.data.hash === buf.baseHash) return; // 자기 저장의 에코
        if (buf.text === buf.baseText) {
          // 깨끗한 버퍼 — 조용히 최신화하되 읽던 줄은 유지한다.
          const eol = detectEol(res.data.content);
          const text = normalizeEol(res.data.content);
          const fresh: CodeBuffer = { text, baseText: text, baseHash: res.data.hash, eol };
          bufferRef.current = fresh;
          putBuffer(bufferKey(projectId, path), fresh);
          setPendingJump({ line: cursorRef.current.line });
          setEditorEpoch((n) => n + 1);
        } else {
          setConflict({ diskHash: res.data.hash });
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
}
