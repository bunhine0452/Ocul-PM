// 인라인 비교 (Cursor 식) — HEAD·일지·로컬 히스토리 판을 원본으로 들고 나기,
// 판 되돌리기·잊기, 일지 화면 점프. `CodePane.tsx` 에서 그대로 들어냈다 (순수 이동).
import { useCallback, useState } from "react";
import type React from "react";

import { commands, type FileJournalEntry } from "@/lib/bindings";
import { NAV_BUS } from "@/lib/navRegistry";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import { codeHistoryApi, type CodeHistoryVersion } from "@/api/codeHistory";
import { toAppError } from "@/api/invoke";
import type { ConfirmOptions } from "@/hooks/useConfirm";

import { reverseApplyPatch } from "../patchReverse";
import { versionTimeLabel } from "../CodeHistory";
import { normalizeEol, type CodeBuffer } from "../codeBuffers";
import type { DiffMode, PendingJump } from "./types";

interface Args {
  projectId: number;
  pathRef: React.RefObject<string | null>;
  bufferRef: React.RefObject<CodeBuffer | null>;
  cursorRef: React.RefObject<{ line: number; col: number }>;
  setPendingJump: React.Dispatch<React.SetStateAction<PendingJump | null>>;
  setEditorEpoch: React.Dispatch<React.SetStateAction<number>>;
  setConflict: React.Dispatch<React.SetStateAction<{ diskHash: string } | null>>;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  loadFile: (path: string, opts?: { discardBuffer?: boolean }) => Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  refreshHistory: () => Promise<void>;
  refreshHistorySoon: () => void;
  forgetVersions: () => Promise<void>;
}

// original 이 있으면 에디터가 그 텍스트와의 차이를 본문 안에 그린다.
// 두 원본이 있다: HEAD(마지막 커밋 이후 = 지금 에이전트가 한 일 전부)와
// 특정 일지(그 작업 단위가 바꾼 것만 — 사이드카 패치를 거꾸로 물려 얻는다).
export function useDiffModes({
  projectId,
  pathRef,
  bufferRef,
  cursorRef,
  setPendingJump,
  setEditorEpoch,
  setConflict,
  setHistoryOpen,
  loadFile,
  confirm,
  refreshHistory,
  refreshHistorySoon,
  forgetVersions,
}: Args) {
  const [diffMode, setDiffMode] = useState<DiffMode | null>(null);
  const [diffOriginal, setDiffOriginal] = useState<string | null>(null);

  // ── 비교 모드 들고 나기 — 에디터는 key 재마운트로 갈아탄다 ──────────────
  const enterHeadDiff = useCallback(async () => {
    const path = pathRef.current;
    const buf = bufferRef.current;
    if (!path || !buf) return;
    const res = await commands.codeHeadContent(projectId, path);
    if (pathRef.current !== path) return;
    if (res.status !== "ok" || res.data == null) {
      toast.info(t("code.diff.noHead"));
      return;
    }
    setDiffOriginal(normalizeEol(res.data));
    setDiffMode({ kind: "head" });
    setPendingJump({ line: cursorRef.current.line });
    setEditorEpoch((n) => n + 1);
  }, [projectId, pathRef, bufferRef, cursorRef, setPendingJump, setEditorEpoch]);

  const enterEntryDiff = useCallback(
    async (entry: FileJournalEntry) => {
      const path = pathRef.current;
      const buf = bufferRef.current;
      if (!path || !buf) return;
      const res = await commands.oculpmGetEntryDiffs(projectId, entry.journal_path);
      if (pathRef.current !== path) return;
      const filePatch =
        res.status === "ok" ? res.data.find((d) => d.path === path)?.patch : undefined;
      const before = filePatch ? reverseApplyPatch(buf.text, filePatch) : null;
      if (before == null) {
        // 파일이 그 일지 이후로 더 바뀌어 문맥이 안 맞는다 — 거짓 비교 대신
        // 일지 화면의 diff 모달로 안내한다.
        toast.info(t("code.diff.entryStale"));
        return;
      }
      setDiffOriginal(before);
      setDiffMode({ kind: "entry", title: entry.title, journalPath: entry.journal_path });
      setPendingJump({ line: cursorRef.current.line });
      setEditorEpoch((n) => n + 1);
    },
    [projectId, pathRef, bufferRef, cursorRef, setPendingJump, setEditorEpoch],
  );

  /** 판 하나와 비교하기. HEAD·일지 비교와 **같은 기계**를 쓴다 — 원본을
   *  `diffOriginal` 에 넣고 에디터를 다시 마운트하면 끝이다. */
  const enterHistoryDiff = useCallback(
    async (version: CodeHistoryVersion) => {
      const path = pathRef.current;
      if (!path || !bufferRef.current) return;
      try {
        const text = await codeHistoryApi.read(projectId, path, version.ts);
        if (pathRef.current !== path) return;
        setDiffOriginal(normalizeEol(text));
        setDiffMode({
          kind: "history",
          ts: version.ts,
          label: versionTimeLabel(version.ts, Date.now()),
        });
        setPendingJump({ line: cursorRef.current.line });
        setEditorEpoch((n) => n + 1);
      } catch {
        // 캡·예산 정리가 그 사이 그 판을 걷어 갔다 — 목록을 새로 읽어 맞춘다.
        toast.info(t("code.hist.gone"));
        void refreshHistory();
      }
    },
    [projectId, refreshHistory, pathRef, bufferRef, cursorRef, setPendingJump, setEditorEpoch],
  );

  /**
   * 이 판으로 되돌리기. `code_write` 와 **같은 낙관적 잠금**을 통과한다 —
   * 판을 되살리는 것이 남의 최신 작업을 조용히 덮는 창구가 되면 안 된다.
   */
  const restoreVersion = useCallback(async () => {
    const path = pathRef.current;
    const buf = bufferRef.current;
    if (!path || !buf || diffMode?.kind !== "history") return;
    const isDirty = buf.text !== buf.baseText;
    const ok = await confirm({
      title: t("code.hist.restoreTitle", { time: diffMode.label }),
      message: isDirty ? t("code.hist.restoreDirty") : t("code.hist.restoreBody"),
      confirmLabel: t("code.hist.restore"),
      danger: isDirty,
    });
    if (!ok) return;
    try {
      const outcome = await codeHistoryApi.restore(projectId, path, diffMode.ts, buf.baseHash);
      if (pathRef.current !== path) return;
      if (outcome.kind === "conflict") {
        setConflict({ diskHash: outcome.disk_hash });
        return;
      }
      setDiffMode(null);
      setDiffOriginal(null);
      // 되돌리기는 디스크를 갈아 끼운다 — 버퍼도 그 자리에서 새로 읽는다.
      await loadFile(path, { discardBuffer: true });
      toast.info(t("code.hist.restored", { time: diffMode.label }));
      refreshHistorySoon();
    } catch (e) {
      toast.destructive(t("code.hist.restoreFailed", { error: tError(toAppError(e)) }));
    }
  }, [projectId, diffMode, confirm, loadFile, refreshHistorySoon, pathRef, bufferRef, setConflict]);

  /** 이 파일의 판 전부 지우기 — 민감한 파일이 한 번 들어왔을 때의 문. */
  const forgetHistory = useCallback(async () => {
    const path = pathRef.current;
    if (!path) return;
    const ok = await confirm({
      title: t("code.hist.forgetTitle"),
      message: t("code.hist.forgetBody", { path }),
      confirmLabel: t("code.hist.forget"),
      danger: true,
    });
    if (!ok) return;
    setHistoryOpen(false);
    try {
      await forgetVersions();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    }
  }, [confirm, forgetVersions, pathRef, setHistoryOpen]);

  const exitDiff = useCallback(() => {
    setDiffMode(null);
    setDiffOriginal(null);
    setPendingJump({ line: cursorRef.current.line });
    setEditorEpoch((n) => n + 1);
  }, [cursorRef, setPendingJump, setEditorEpoch]);

  /** 일지 화면으로 점프 — 팔레트와 같은 전역 버스를 쓴다 (화면 결합 없음). */
  const openJournal = useCallback((journalPath: string) => {
    window.dispatchEvent(
      new CustomEvent(NAV_BUS.openEntity, { detail: { kind: "journal", id: journalPath } }),
    );
  }, []);

  return {
    diffMode,
    setDiffMode,
    diffOriginal,
    setDiffOriginal,
    enterHeadDiff,
    enterEntryDiff,
    enterHistoryDiff,
    restoreVersion,
    forgetHistory,
    exitDiff,
    openJournal,
  };
}
