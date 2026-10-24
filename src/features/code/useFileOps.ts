/**
 * 트리의 파일 조작 — 만들기·이름 바꾸기·**옮기기**·삭제, 그리고 되돌리기.
 *
 * `CodeScreenV2` 안에 있던 것을 그대로 떼어 왔다. 화면 파일이 파일 크기 래칫에
 * 걸려 한 줄도 늘릴 수 없었고, 이 여섯 동작은 "경로가 바뀌면 탭·버퍼·펼침이
 * 따라간다" 는 하나의 관심사라 화면에 매여 있을 이유가 없다.
 *
 * ## 되돌리기의 범위
 *
 * 옮기기·이름 바꾸기는 `code_rename` 한 번이고 **역연산이 정확히 자기 자신**이라
 * 토스트의 [되돌리기] 가 진짜로 되돌린다. 삭제는 그렇지 않다: OS 휴지통으로
 * 보내는데 macOS 에서는 프로그램이 휴지통을 되짚을 수 없다 (`trash` 크레이트의
 * `os_limited` 는 Windows·Linux 전용이다). 그래서 삭제에는 [되돌리기] 를 달지
 * **않는다** — 눌러도 안 되는 버튼을 다느니 "휴지통으로 보냈다"고 말하는 편이
 * 정직하고, 그 문장이 이미 복구 경로다.
 */
import { useCallback, useState } from "react";

import { codeFileApi } from "@/api/code";
import { toAppError } from "@/api/invoke";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";

import { dropBuffersUnder, renameBufferPath } from "./codeBuffers";
import { baseName, joinPath, moveTarget, parentDir, renameTarget, validateName } from "./fileOps";
import { destLabel } from "./importTarget";
import { closeOpenPath, openPathsUnder, renameOpenPath, type CodeTabsState } from "./codeTabs";
import { pruneNested } from "./treeSelection";
import type { TreeDraft } from "./CodeTree";

/** 옮기기 한 건 — 되돌리기는 이것의 `from`/`to` 를 뒤집기만 하면 된다. */
export interface MovePair {
  from: string;
  to: string;
}

/** 삭제 확인에 걸린 대상들. 함께 닫히는 탭을 **누르기 전에** 열거한다. */
export interface PendingDelete {
  targets: { path: string; isDir: boolean }[];
  openTabs: string[];
}

export interface UseFileOpsArgs {
  projectId: number;
  /** 루트 폴더 이름 — 경로가 빈 문자열이라 토스트가 쓸 이름이 따로 필요하다. */
  rootName: string;
  tabsRef: { current: CodeTabsState };
  setTabs: (fn: (prev: CodeTabsState) => CodeTabsState) => void;
  setExpanded: (fn: (prev: Set<string>) => Set<string>) => void;
  refreshDirtyPaths: () => void;
  /** 조작이 끝난 폴더들을 다시 읽는다. */
  reloadAfterOp: (...dirs: string[]) => void;
  loadDir: (dirPath: string, force?: boolean) => void;
  openPath: (path: string, line: number | null, pane?: number) => void;
  /** 조작이 끝나면 트리 다중 선택을 비운다 — 사라진 경로가 남아 있으면 안 된다. */
  clearMarks: () => void;
}

export function useFileOps({
  projectId,
  rootName,
  tabsRef,
  setTabs,
  setExpanded,
  refreshDirtyPaths,
  reloadAfterOp,
  loadDir,
  openPath,
  clearMarks,
}: UseFileOpsArgs) {
  const [draft, setDraft] = useState<TreeDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);

  const startCreate = useCallback(
    (parent: string, isDir: boolean) => {
      // 만들 자리가 안 보이면 이름을 넣을 곳도 없다 — 먼저 펼치고 읽는다.
      if (parent) {
        setExpanded((prev) => (prev.has(parent) ? prev : new Set(prev).add(parent)));
        loadDir(parent);
      }
      setDraft({ kind: "create", parent, isDir });
    },
    [loadDir, setExpanded],
  );

  const startRename = useCallback((path: string, isDir: boolean) => {
    setDraft({ kind: "rename", path, isDir, initial: baseName(path) });
  }, []);

  /** 경로가 바뀐 뒤처리 — 탭·버퍼·펼침 상태가 새 경로를 따라간다. */
  const applyRenamed = useCallback(
    (from: string, to: string, isDir: boolean) => {
      renameBufferPath(projectId, from, to, isDir);
      setTabs((prev) => renameOpenPath(prev, from, to, isDir));
      if (isDir) {
        setExpanded((prev) => {
          const next = new Set<string>();
          for (const dir of prev) {
            if (dir === from) next.add(to);
            else if (dir.startsWith(from + "/")) next.add(to + dir.slice(from.length));
            else next.add(dir);
          }
          return next;
        });
      }
      refreshDirtyPaths();
      reloadAfterOp(parentDir(from), parentDir(to));
    },
    [projectId, refreshDirtyPaths, reloadAfterOp, setTabs, setExpanded],
  );

  /**
   * 옮기기를 **차례로** 실행하고 성공한 것만 돌려준다.
   *
   * 병렬로 던지지 않는다: 같은 폴더로 열 개가 동시에 들어가면 트리 캐시 갱신이
   * 서로를 덮어써 목록이 실제 디스크와 어긋난다. 옮긴 것이 폴더였는지는
   * **백엔드가 알려 준다** — 트리 캐시가 낡았을 수 있어 프런트를 믿지 않는다.
   */
  const runMoves = useCallback(
    async (pairs: readonly MovePair[]): Promise<MovePair[]> => {
      const done: MovePair[] = [];
      let failed = 0;
      for (const pair of pairs) {
        if (pair.to === pair.from) continue;
        try {
          const moved = await codeFileApi.rename(projectId, pair.from, pair.to);
          applyRenamed(pair.from, moved.relative_path, moved.is_dir);
          done.push({ from: pair.from, to: moved.relative_path });
        } catch (e) {
          failed += 1;
          // 첫 실패만 이유를 말한다 — 열 개가 같은 이유로 막히면 토스트 열 개는 소음이다.
          if (failed === 1) {
            toast.destructive(t("code.ops.renameFailed", { error: tError(toAppError(e)) }));
          }
        }
      }
      return done;
    },
    [projectId, applyRenamed],
  );

  const undoMoves = useCallback(
    (done: readonly MovePair[]) => {
      // **역순**으로 되돌린다 — a→b, b→c 처럼 사슬이 생겼을 때 앞에서부터 풀면
      // 되돌린 b 를 그 다음 되돌리기가 다시 데려간다.
      const back = [...done].reverse().map((p) => ({ from: p.to, to: p.from }));
      void runMoves(back).then((undone) => {
        if (undone.length) toast.info(t("code.ops.moveUndone", { count: undone.length }));
      });
    },
    [runMoves],
  );

  /** 되돌릴 수 있는 옮기기 — 성공한 만큼만 [되돌리기] 를 단다. */
  const runUndoable = useCallback(
    (pairs: readonly MovePair[], message: (done: MovePair[]) => string) => {
      if (pairs.length === 0) return;
      void runMoves(pairs).then((done) => {
        if (done.length === 0) return;
        clearMarks();
        toast.info(message(done), {
          actions: [{ label: t("common.undo"), onClick: () => undoMoves(done) }],
        });
      });
    },
    [runMoves, undoMoves, clearMarks],
  );

  /** 드래그로 옮기기. 여러 개를 한 번에 받는다 (트리 다중 선택). */
  const moveInto = useCallback(
    (froms: readonly string[], toDir: string) => {
      const pairs: MovePair[] = [];
      let intoSelf = false;
      for (const from of pruneNested(froms)) {
        const result = moveTarget(from, toDir);
        if (result.ok) pairs.push({ from, to: result.to });
        // 같은 폴더로의 드롭은 말없이 넘긴다 (실수가 아니라 취소에 가깝다).
        else if (result.reason === "intoSelf") intoSelf = true;
      }
      if (pairs.length === 0) {
        if (intoSelf) toast.warning(t("code.ops.moveIntoSelf"));
        return;
      }
      const dir = destLabel(toDir, rootName);
      runUndoable(pairs, (done) =>
        done.length === 1
          ? t("code.ops.moved", { name: baseName(done[0].to), dir })
          : t("code.ops.movedMany", { count: done.length, dir }),
      );
    },
    [runUndoable, rootName],
  );

  const submitDraft = useCallback(
    (name: string) => {
      const current = draft;
      setDraft(null);
      if (!current) return;
      const problem = validateName(name);
      if (problem) {
        toast.destructive(t(`code.ops.name.${problem}`));
        return;
      }
      if (current.kind === "rename") {
        const to = renameTarget(current.path, name);
        if (to === current.path) return;
        runUndoable([{ from: current.path, to }], (done) =>
          t("code.ops.renamed", { from: baseName(current.path), to: baseName(done[0].to) }),
        );
        return;
      }
      const target = joinPath(current.parent, name.trim());
      const made = current.isDir
        ? codeFileApi.mkdir(projectId, target)
        : codeFileApi.create(projectId, target);
      void made
        .then((res) => {
          // `a/b/c.ts` 처럼 중간 폴더가 같이 생겼을 수 있다 — 만든 자리와 그
          // 직속 부모를 둘 다 다시 읽는다.
          reloadAfterOp(current.parent, parentDir(res.relative_path));
          if (res.is_dir) {
            setExpanded((prev) => new Set(prev).add(res.relative_path));
            loadDir(res.relative_path, true);
          } else {
            openPath(res.relative_path, null);
          }
        })
        .catch((e: unknown) => {
          toast.destructive(t("code.ops.createFailed", { error: tError(toAppError(e)) }));
        });
    },
    [draft, projectId, runUndoable, reloadAfterOp, loadDir, openPath, setExpanded],
  );

  const askDelete = useCallback(
    (targets: { path: string; isDir: boolean }[]) => {
      if (targets.length === 0) return;
      const kept = new Set(pruneNested(targets.map((x) => x.path)));
      const pruned = targets.filter((x) => kept.has(x.path));
      setPendingDelete({
        targets: pruned,
        openTabs: pruned.flatMap((x) => openPathsUnder(tabsRef.current, x.path, x.isDir)),
      });
    },
    [tabsRef],
  );

  const confirmDelete = useCallback(() => {
    const pending = pendingDelete;
    if (!pending || deleting) return;
    setDeleting(true);
    void (async () => {
      const gone: { path: string; isDir: boolean }[] = [];
      let lost = 0;
      let failed = 0;
      for (const target of pending.targets) {
        try {
          await codeFileApi.delete(projectId, target.path);
        } catch (e) {
          failed += 1;
          if (failed === 1) {
            toast.destructive(t("code.ops.deleteFailed", { error: tError(toAppError(e)) }));
          }
          continue;
        }
        // 탭·버퍼를 같이 정리한다. 미저장 편집이 있었다면 **무엇이 사라졌는지**
        // 말한다 — 확인 창에서 이미 경고했더라도 결과는 다시 알린다.
        lost += dropBuffersUnder(projectId, target.path, target.isDir).length;
        setTabs((prev) => closeOpenPath(prev, target.path, target.isDir));
        gone.push(target);
      }
      setDeleting(false);
      setPendingDelete(null);
      if (gone.length === 0) return;
      refreshDirtyPaths();
      clearMarks();
      setExpanded((prev) => {
        const next = new Set<string>();
        for (const dir of prev) {
          if (!gone.some((g) => g.isDir && (dir === g.path || dir.startsWith(g.path + "/")))) {
            next.add(dir);
          }
        }
        return next;
      });
      reloadAfterOp(...gone.map((g) => parentDir(g.path)));
      // 휴지통으로 갔다는 사실이 곧 복구 경로다 (앱은 되돌릴 수 없다 — 모듈 주석 참고).
      const name = baseName(gone[0].path);
      toast.info(
        gone.length > 1
          ? t("code.ops.deletedMany", { count: gone.length })
          : lost > 0
            ? t("code.ops.deletedWithUnsaved", { name, count: lost })
            : t("code.ops.deleted", { name }),
      );
    })();
  }, [
    pendingDelete,
    deleting,
    projectId,
    refreshDirtyPaths,
    reloadAfterOp,
    setTabs,
    setExpanded,
    clearMarks,
  ]);

  return {
    draft,
    cancelDraft: useCallback(() => setDraft(null), []),
    startCreate,
    startRename,
    submitDraft,
    moveInto,
    pendingDelete,
    setPendingDelete,
    deleting,
    askDelete,
    confirmDelete,
  };
}
