// Finder → 코드 트리로 파일을 들여오는 두 창구(드래그 드롭 · ⌘V)를 한 곳에 묶는다.
//
// 두 입력은 겉보기에 다르지만 결국 **OS 절대경로 목록**으로 같아진다:
//   · 드롭 — HTML 드롭 이벤트는 Tauri 가 가로채므로 `onDragDropEvent` 로만 온다
//     (웹뷰의 DataTransfer 에는 경로가 없다). 대신 커서 좌표가 함께 온다.
//   · ⌘V — 웹뷰의 paste 로는 **폴더가 실리지 않는다**(File 객체가 안 생긴다).
//     그래서 OS pasteboard 를 백엔드가 직접 읽는다 (`code_clipboard_files`).
// 그 뒤는 `code_import` 하나로 합류한다.
import { useCallback, useEffect, useRef, useState } from "react";

import { commands } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import { destLabel, importDestDir, type TreeHit } from "./importTarget";
import { hitAt } from "./treeDom";

export interface UseCodeImportArgs {
  projectId: number;
  /** 이 화면이 실제로 보이는가 — 배경에 살아 있는 다른 프로젝트 탭이 드롭을 삼키면 안 된다. */
  isVisible: () => boolean;
  /** 지금 고른 항목 — 커서가 없는 ⌘V 의 기준. */
  selected: TreeHit | null;
  /** 프로젝트 폴더 이름 — 루트로 들어갔을 때 토스트가 쓸 이름 (경로가 빈 문자열이라). */
  rootName: string;
  /** 가져오기가 끝났다 — 트리를 다시 읽고 새로 생긴 자리를 펼칠 기회. */
  onImported: (destDir: string, paths: string[]) => void;
}

export interface UseCodeImportResult {
  /** 드래그 중 파일이 떨어질 폴더 (`null` = 드래그 중이 아니거나 트리 밖). */
  dropDir: string | null;
  /** ⌘V — 클립보드에 파일이 있으면 가져온다. 글자만 있으면 조용히 지나간다. */
  pasteFiles: () => void;
}

export function useCodeImport({
  projectId,
  isVisible,
  selected,
  rootName,
  onImported,
}: UseCodeImportArgs): UseCodeImportResult {
  const [dropDir, setDropDir] = useState<string | null>(null);
  // 콜백들이 늘 최신 값을 보게 한다 — 구독은 한 번만 걸고 유지한다
  // (드래그 도중 재구독되면 그 드래그의 enter/over 사슬이 끊긴다).
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;
  const rootNameRef = useRef(rootName);
  rootNameRef.current = rootName;
  const busyRef = useRef(false);

  const runImport = useCallback(
    async (destDir: string, sources: string[]) => {
      if (!sources.length || busyRef.current) return;
      busyRef.current = true;
      try {
        const res = await commands.codeImport(projectId, destDir, sources);
        if (res.status === "error") {
          toast.destructive(t("code.import.failed", { error: tError(res.error) }));
          return;
        }
        const { imported, skipped, truncated } = res.data;
        if (imported.length) {
          toast.info(
            t("code.import.done", {
              count: imported.length,
              dir: destLabel(destDir, rootNameRef.current),
            }),
          );
          onImportedRef.current(destDir, imported);
        }
        // 잘림과 건너뜀은 각각 다른 사실이라 따로 알린다 — 하나로 뭉치면
        // "왜 일부만 왔는지" 를 사용자가 되짚을 수 없다.
        if (truncated) toast.warning(t("code.import.truncated"));
        else if (skipped.length) toast.warning(t("code.import.skipped", { count: skipped.length }));
        else if (!imported.length) toast.warning(t("code.import.nothing"));
      } finally {
        busyRef.current = false;
      }
    },
    [projectId],
  );

  // ── OS 드래그 드롭 ────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const off = await getCurrentWebview().onDragDropEvent((event) => {
          if (!isVisible()) return;
          const payload = event.payload;
          if (payload.type === "leave") {
            setDropDir(null);
            return;
          }
          // 좌표는 물리 픽셀이다 — CSS 픽셀로 되돌려야 elementFromPoint 가 맞는다.
          const dpr = window.devicePixelRatio || 1;
          const hit =
            "position" in payload
              ? hitAt(payload.position.x / dpr, payload.position.y / dpr)
              : null;
          if (payload.type === "enter" || payload.type === "over") {
            // 트리 밖이면 null — 어디에 놓일지 모르는 채로 표시하지 않는다.
            setDropDir(hit ? importDestDir(hit, null) : null);
            return;
          }
          setDropDir(null);
          if (payload.type !== "drop" || !payload.paths.length) return;
          // 트리 밖에 떨어뜨린 것은 받지 않는다 — 에디터에 떨군 것을 조용히
          // 어딘가로 복사해 버리면 그게 더 나쁘다.
          if (!hit) return;
          void runImport(importDestDir(hit, null), payload.paths);
        });
        if (disposed) off();
        else unlisten = off;
      } catch {
        // 웹뷰 밖(테스트·브라우저) — 드롭만 없는 채로 산다.
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isVisible, runImport]);

  const pasteFiles = useCallback(() => {
    void (async () => {
      const res = await commands.codeClipboardFiles();
      // 글자를 복사해 둔 상태의 ⌘V — 아무 일도 없는 것이 맞다.
      if (res.status !== "ok" || !res.data.length) return;
      void runImport(importDestDir(null, selectedRef.current), res.data);
    })();
  }, [runImport]);

  return { dropDir, pasteFiles };
}
