// 컴포저에 얹는 것들 — 파일 붙임(고르기·드롭·멘션)과 붙여넣은 이미지.
//
// `AcpConversation.tsx` 에서 갈라 나온 조각이다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다. 셋을 한 훅에 둔 이유는 들어오는 길이 셋일
// 뿐 **나가는 자리가 하나**(`attachments`·`images`)이기 때문이다.

import { useCallback, useEffect, useRef, useState } from "react";

import { commands, type AcpImage } from "@/lib/bindings";
import { safeUnlisten } from "@/lib/unlisten";
import type { PendingImage } from "./Composer";

export interface ComposerAttachmentsArgs {
  projectId: number;
  /** 프로젝트 루트 — 안쪽 파일은 상대경로로 줄인다. */
  projectRoot: string | null;
  /** 이 화면이 지금 눈에 보이는가 (keep-alive 배경 탭이 드롭을 삼키지 않게). */
  isVisible: () => boolean;
  /** 드롭·붙여넣기 뒤 입력창으로 커서를 돌려보낸다. */
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 이 에이전트가 이미지를 받는가. 안 받으면 붙기 전에 막고 이유를 말한다. */
  supportsImage: () => boolean;
  setError: (message: string) => void;
  /** 이미지를 못 받는다는 문구 (i18n 은 호출부가 푼다). */
  unsupportedMessage: string;
}

export function useComposerAttachments({
  projectId,
  projectRoot,
  isVisible,
  inputRef,
  supportsImage,
  setError,
  unsupportedMessage,
}: ComposerAttachmentsArgs) {
  /** 이번 프롬프트에 함께 보낼 파일 (상대·절대 섞여도 백엔드가 맞춘다). */
  const [attachments, setAttachments] = useState<string[]>([]);
  /**
   * 보낼 이미지. 프로토콜에 보내는 것(`AcpImage`)보다 **더 들고 있는다** —
   * 파일 이름과 픽셀 크기는 어댑터에 보낼 자리가 없지만 화면에는 필요하다
   * ("image.png 1104×172"). 보낼 때 프로토콜 몫만 떼어 낸다.
   */
  const [images, setImages] = useState<PendingImage[]>([]);
  /** 파일을 끌어와 얹으려는 중 — 컴포저에 놓을 자리를 그린다. */
  const [dropActive, setDropActive] = useState(false);

  const addAttachments = useCallback((paths: readonly string[]) => {
    if (!paths.length) return;
    setAttachments((prev) => [...new Set([...prev, ...paths])]);
  }, []);

  const attach = useCallback(async () => {
    const res = await commands.acpPickFiles(projectId);
    if (res.status === "ok" && res.data.length) addAttachments(res.data);
  }, [projectId, addAttachments]);

  /**
   * 파일 드래그&드롭 → 첨부.
   *
   * HTML 드롭은 Tauri 가 가로채므로(웹뷰 기본) OS 드롭은 **Tauri 이벤트**로만
   * 받을 수 있다. 이 화면이 보일 때만 받는다 — keep-alive 로 배경에 살아 있는
   * 다른 프로젝트 탭이 드롭을 삼키면 안 된다.
   */
  const addRef = useRef(addAttachments);
  useEffect(() => {
    addRef.current = addAttachments;
  }, [addAttachments]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const off = await getCurrentWebview().onDragDropEvent((event) => {
          if (!isVisible()) return;
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setDropActive(true);
            return;
          }
          setDropActive(false);
          if (payload.type !== "drop" || !payload.paths.length) return;
          // 프로젝트 안의 파일이면 상대경로로 — 칩과 프롬프트가 짧게 읽힌다.
          const rel = payload.paths.map((path) =>
            projectRoot && path.startsWith(projectRoot + "/")
              ? path.slice(projectRoot.length + 1)
              : path,
          );
          addRef.current(rel);
          inputRef.current?.focus();
        });
        if (disposed) safeUnlisten(off);
        else unlisten = off;
      } catch {
        // 웹뷰 밖(테스트·브라우저)에서는 이 API 가 없다 — 드롭만 없는 채로 산다.
      }
    })();
    return () => {
      disposed = true;
      safeUnlisten(unlisten);
    };
  }, [isVisible, projectRoot, inputRef]);

  /** 클립보드에서 이미지를 받는다. 텍스트 붙여넣기는 기본 동작 그대로. */
  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData.files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (!files.length) return;
      e.preventDefault();

      // 프로토콜은 `promptCapabilities` 에 맞춰 UI 를 바꾸라고 못 박는다. 안 받는
      // 에이전트에게 붙임 하나를 얹으면 **턴 전체가** 실패하므로, 붙기 전에
      // 막고 이유를 말한다 (붙여넣기가 조용히 사라지는 것이 더 나쁘다).
      if (!supportsImage()) {
        setError(unsupportedMessage);
        return;
      }

      for (const file of files) {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          // `data:image/png;base64,AAA…` 에서 본문만 — 접두사를 그대로 보내면
          // 어댑터가 base64 로 못 읽는다.
          const comma = result.indexOf(",");
          if (comma < 0) return;
          const block: AcpImage = {
            mime_type: file.type,
            data_base64: result.slice(comma + 1),
          };
          // 크기는 한 번 그려 봐야 안다. 못 재도 이미지는 보낸다 — 치수는
          // 곁들이는 정보이지 보낼 수 있느냐의 조건이 아니다.
          const probe = new Image();
          const add = (width: number, height: number) =>
            setImages((prev) => [...prev, { block, name: file.name || "image", width, height }]);
          probe.onload = () => add(probe.naturalWidth, probe.naturalHeight);
          probe.onerror = () => add(0, 0);
          probe.src = result;
        };
        reader.readAsDataURL(file);
      }
    },
    [supportsImage, setError, unsupportedMessage],
  );

  return {
    attachments,
    setAttachments,
    addAttachments,
    images,
    setImages,
    dropActive,
    attach,
    onPaste,
  };
}
