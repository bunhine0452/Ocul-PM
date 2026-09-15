// 언어 서버가 끼는 편집 동작 — 정의로 이동(F12) · 이름 바꾸기(F2) · 코드 액션(⌘.) ·
// 참조 찾기(⇧F12) 와 두 다이얼로그의 상태. `CodePane.tsx` 에서 그대로 들어냈다 (순수 이동).
import { useCallback, useRef, useState } from "react";
import type React from "react";

import { commands, type LspCodeAction } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";

import type { ReferencesQuery } from "../CodeReferences";
import type { UseLspResult } from "../useLsp";
import type { PendingJump } from "./types";

interface Args {
  projectId: number;
  lsp: UseLspResult;
  dirtyPaths: Set<string>;
  pathRef: React.RefObject<string | null>;
  setPendingJump: React.Dispatch<React.SetStateAction<PendingJump | null>>;
  setEditorEpoch: React.Dispatch<React.SetStateAction<number>>;
  loadFile: (path: string, opts?: { discardBuffer?: boolean }) => Promise<void>;
  onOpenPath: (path: string, line: number | null) => void;
  onReferences: (query: ReferencesQuery) => void;
}

export function useLspActions({
  projectId,
  lsp,
  dirtyPaths,
  pathRef,
  setPendingJump,
  setEditorEpoch,
  loadFile,
  onOpenPath,
  onReferences,
}: Args) {
  // ── 정의로 이동 (F12 · ⌘클릭) ──────────────────────────────────────────
  //
  // 세 갈래다. 셋 다 **말은 한다** — 조용히 아무 일도 안 하면 사용자는 기능이
  // 고장난 줄 안다.
  const goToDefinition = useCallback(
    (line: number, character: number) => {
      void (async () => {
        const loc = await lsp.definition(line, character);
        if (!loc) {
          toast.info(t("code.lsp.noDefinition"));
          return;
        }
        if (!loc.path) {
          // 표준 라이브러리·의존성 — 코드 화면은 프로젝트 안만 연다.
          toast.info(t("code.lsp.definitionOutside", { file: loc.display }));
          return;
        }
        // jumpLine 은 1-based, LSP 는 0-based.
        if (loc.path === pathRef.current) setPendingJump({ line: loc.line + 1 });
        else onOpenPath(loc.path, loc.line + 1);
      })();
    },
    [lsp, onOpenPath, pathRef, setPendingJump],
  );

  // ── 이름 바꾸기 (F2) ───────────────────────────────────────────────────
  //
  // 이 창에서 유일하게 **여러 파일을 한꺼번에 고치는** 동작이다. 백엔드가
  // 전부-아니면-전무로 적용하지만, 그 전에 프런트가 막아야 하는 것이 하나 있다:
  // **미저장 버퍼**. 서버는 didChange 로 받은 버퍼 내용을 보고 편집을 계산하는데
  // 백엔드는 디스크에 적용하므로, 둘이 다르면 엉뚱한 자리를 덮어쓴다.
  const [renameAt, setRenameAt] = useState<{ line: number; character: number } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback(
    (line: number, character: number, word: string) => {
      if (dirtyPaths.size > 0) {
        toast.warning(t("code.lsp.renameNeedsSave"));
        return;
      }
      setRenameName(word);
      setRenameAt({ line, character });
    },
    [dirtyPaths],
  );

  const submitRename = useCallback(() => {
    const at = renameAt;
    const next = renameName.trim();
    const path = pathRef.current;
    if (!at || !next || !path || renaming) return;
    setRenaming(true);
    void (async () => {
      const res = await commands.lspRename(projectId, path, at.line, at.character, next);
      setRenaming(false);
      if (res.status === "error") {
        toast.destructive(tError(res.error));
        return;
      }
      setRenameAt(null);
      toast.info(
        t("code.lsp.renameDone", { files: res.data.files.length, edits: res.data.total_edits }),
      );
      // 열려 있는 파일도 디스크에서 바뀌었다 — 버퍼를 버리고 다시 읽는다.
      void loadFile(path, { discardBuffer: true });
      setEditorEpoch((n) => n + 1);
    })();
  }, [renameAt, renameName, renaming, projectId, loadFile, pathRef, setEditorEpoch]);

  // ── 코드 액션 (⌘.) ─────────────────────────────────────────────────────
  //
  // 이름 바꾸기와 같은 이유로 미저장 게이트를 건다 — 서버는 버퍼를, 백엔드는
  // 디스크를 본다.
  const [actions, setActions] = useState<LspCodeAction[] | null>(null);
  const [actionsBusy, setActionsBusy] = useState(false);

  const openCodeActions = useCallback(
    (sl: number, sc: number, el: number, ec: number) => {
      if (dirtyPaths.size > 0) {
        toast.warning(t("code.lsp.renameNeedsSave"));
        return;
      }
      setActionsBusy(true);
      setActions([]);
      void (async () => {
        const list = await lsp.codeActions(sl, sc, el, ec);
        setActionsBusy(false);
        if (list.length === 0) {
          setActions(null);
          toast.info(t("code.lsp.noActions"));
          return;
        }
        setActions(list);
      })();
    },
    [dirtyPaths, lsp],
  );

  const runCodeAction = useCallback(
    (index: number) => {
      const path = pathRef.current;
      if (!path || actionsBusy) return;
      setActionsBusy(true);
      void (async () => {
        try {
          const res = await lsp.applyCodeAction(index);
          setActions(null);
          if (res) {
            toast.info(
              t("code.lsp.renameDone", { files: res.files.length, edits: res.total_edits }),
            );
            // 열려 있는 파일도 디스크에서 바뀌었다 — 버퍼를 버리고 다시 읽는다.
            void loadFile(path, { discardBuffer: true });
            setEditorEpoch((n) => n + 1);
          }
        } catch (e) {
          toast.destructive(tError(e instanceof Error ? e.message : String(e)));
        } finally {
          setActionsBusy(false);
        }
      })();
    },
    [actionsBusy, lsp, loadFile, pathRef, setEditorEpoch],
  );

  // ── 참조 찾기 (⇧F12) ───────────────────────────────────────────────────
  //
  // 결과는 창이 아니라 **화면**이 그린다 — 편집 영역 전체 폭이 필요하고,
  // 분할 중에도 패널은 하나여야 한다.
  const findReferences = useCallback(
    (line: number, character: number, word: string) => {
      const symbol = word || (pathRef.current ?? "");
      onReferences({ symbol, status: "loading", files: [] });
      void lsp.references(line, character).then((files) => {
        onReferences({ symbol, status: "ready", files });
      });
    },
    [lsp, onReferences, pathRef],
  );

  return {
    goToDefinition,
    renameAt,
    setRenameAt,
    renameName,
    setRenameName,
    renaming,
    renameInputRef,
    startRename,
    submitRename,
    actions,
    setActions,
    actionsBusy,
    openCodeActions,
    runCodeAction,
    findReferences,
  };
}
