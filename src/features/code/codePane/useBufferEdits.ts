// 버퍼 쓰기 셋 — 타자(handleChange) · 본문 통째 교체(포맷팅) · 저장 반영.
// 버퍼는 ref 고 화면에 보여야 하는 파생값만 state 다. `CodePane.tsx` 에서 그대로 들어냈다.
import { useCallback } from "react";
import type React from "react";

import { bufferKey, putBuffer, type CodeBuffer } from "../codeBuffers";
import type { UseLspResult } from "../useLsp";
import type { PendingJump } from "./types";

/** svg 미리보기 갱신 디바운스 — 타자마다 blob 을 새로 굽지 않는다. */
const SVG_DEBOUNCE_MS = 250;

interface Args {
  projectId: number;
  dirtyPaths: Set<string>;
  onBuffersChanged: () => void;
  onPinTab: (path: string) => void;
  lsp: UseLspResult;
  refreshGutter: (text: string, immediate?: boolean) => void;
  bufferRef: React.RefObject<CodeBuffer | null>;
  pathRef: React.RefObject<string | null>;
  cursorRef: React.RefObject<{ line: number; col: number }>;
  setDirty: React.Dispatch<React.SetStateAction<boolean>>;
  setConflict: React.Dispatch<React.SetStateAction<{ diskHash: string } | null>>;
  setPendingJump: React.Dispatch<React.SetStateAction<PendingJump | null>>;
  setEditorEpoch: React.Dispatch<React.SetStateAction<number>>;
  /** 자동 저장의 타자 트리거 — 훅이 저장 경로보다 아래에서 만들어지므로 ref 로 잇는다. */
  onEditRef: React.RefObject<() => void>;
  svgOpenRef: React.RefObject<boolean>;
  svgTimerRef: React.RefObject<number | null>;
  setSvgText: React.Dispatch<React.SetStateAction<string>>;
}

export function useBufferEdits({
  projectId,
  dirtyPaths,
  onBuffersChanged,
  onPinTab,
  lsp,
  refreshGutter,
  bufferRef,
  pathRef,
  cursorRef,
  setDirty,
  setConflict,
  setPendingJump,
  setEditorEpoch,
  onEditRef,
  svgOpenRef,
  svgTimerRef,
  setSvgText,
}: Args) {
  // ── 편집·저장 ──────────────────────────────────────────────────────────
  const handleChange = useCallback(
    (text: string) => {
      const buf = bufferRef.current;
      const path = pathRef.current;
      if (!buf || !path) return;
      const next = { ...buf, text };
      bufferRef.current = next;
      putBuffer(bufferKey(projectId, path), next);
      const nowDirty = text !== next.baseText;
      setDirty((prev) => (prev === nowDirty ? prev : nowDirty));
      if (nowDirty !== dirtyPaths.has(path)) onBuffersChanged();
      // 고치기 시작한 파일은 더 이상 "훑어보는 중" 이 아니다 — 미리보기가 아니면
      // `pinTab` 이 같은 상태를 돌려주므로 타자마다 불러도 리렌더가 없다.
      if (nowDirty) onPinTab(path);
      // 저장을 기다리지 않고 서버에 밀어 넣는다 — 진단은 미저장 상태에서
      // 가장 쓸모 있다 (내부에서 디바운스).
      lsp.pushText(text);
      refreshGutter(text);
      onEditRef.current();
      if (svgOpenRef.current) {
        if (svgTimerRef.current != null) window.clearTimeout(svgTimerRef.current);
        svgTimerRef.current = window.setTimeout(() => {
          svgTimerRef.current = null;
          setSvgText(text);
        }, SVG_DEBOUNCE_MS);
      }
    },
    [
      projectId,
      dirtyPaths,
      onBuffersChanged,
      onPinTab,
      lsp,
      refreshGutter,
      bufferRef,
      pathRef,
      setDirty,
      onEditRef,
      svgOpenRef,
      svgTimerRef,
      setSvgText,
    ],
  );

  /**
   * 버퍼 본문을 통째로 갈아끼운다 (포맷팅). 에디터는 언컨트롤드라 `key` 로
   * 재마운트해야 새 본문이 실리고, 그러면 커서가 맨 위로 가므로 보던 줄을
   * 점프로 복원한다 — watcher 리로드가 쓰는 것과 같은 수법.
   */
  const replaceBufferText = useCallback(
    (text: string) => {
      const buf = bufferRef.current;
      const path = pathRef.current;
      if (!buf || !path) return;
      const next = { ...buf, text };
      bufferRef.current = next;
      putBuffer(bufferKey(projectId, path), next);
      setDirty(text !== next.baseText);
      onBuffersChanged();
      lsp.pushText(text);
      refreshGutter(text);
      setPendingJump({ line: cursorRef.current.line });
      setEditorEpoch((n) => n + 1);
    },
    [
      projectId,
      onBuffersChanged,
      lsp,
      refreshGutter,
      bufferRef,
      pathRef,
      cursorRef,
      setDirty,
      setPendingJump,
      setEditorEpoch,
    ],
  );

  const applySaved = useCallback(
    (path: string, hash: string) => {
      const buf = bufferRef.current;
      if (!buf) return;
      const next = { ...buf, baseText: buf.text, baseHash: hash };
      bufferRef.current = next;
      putBuffer(bufferKey(projectId, path), next);
      setDirty(false);
      setConflict(null);
      onBuffersChanged();
    },
    [projectId, onBuffersChanged, bufferRef, setDirty, setConflict],
  );

  return { handleChange, replaceBufferText, applySaved };
}
