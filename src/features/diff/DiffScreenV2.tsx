import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { LoadingState } from "@/components/LoadingState";
import { RadioSeg } from "@/components/RadioSeg";
import { SkeletonList } from "@/components/ui/Skeleton";
import { Toolbar } from "@/components/Toolbar";
import { fileOpenApi } from "@/api/fileOpen";
import { errorDetail, toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { projectFileApi } from "@/api/projectFile";
import { useWorkspace, type DiffMode } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { ManualEntryModalV2 } from "@/features/oculpm/ManualEntryModalV2";
import { useJournalEvents } from "@/features/oculpm/useOculpmLive";
import { requestSendToClaude } from "@/features/terminal/sendToClaude";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toast } from "@/lib/toast";
import { localWorkdayKey } from "@/lib/workday";
import { ChangeFileList } from "./ChangeFileList";
import { DiffBody } from "./DiffBody";
import { DiffEntryFooter } from "./DiffEntryFooter";
import { DiffFileHead } from "./DiffFileHead";
import { UnrecordedBanner } from "./UnrecordedBanner";
import { firstPick, groupKey, missingGroupKeys, recordRequestText, sortGroups, splitChanges } from "./changeGroups";
import { generatedSet, type DiffBaseline } from "./changeList";
import {
  applyResolution,
  clearNotes,
  composeNotes,
  hydrateNotes,
  isJudged,
  isNotFoundError,
  markSent,
  restoreNotes,
  useDiffNotes,
} from "./diffNoteStore";
import {
  ignoreWhitespaceStore,
  markAsked,
  patchHash,
  setViewed,
  useAskedKey,
  useViewed,
  viewStateOf,
  viewedKey,
} from "./diffSessionStore";
import { buildReceipt } from "./receipt";
import { useDiffChanges } from "./useDiffChanges";
import { useDiffFile } from "./useDiffFile";
import { useDiffHandoff } from "./useDiffHandoff";
import { useDiffKeys } from "./useDiffKeys";
import { useGroupEntries } from "./useGroupEntries";
import "./changes.css";

// 변경 화면 (4.0) — 왼쪽 목록 + 오른쪽 diff. 목록은 「일지 없음」(어느 일지에도 없는 변경)이 먼저이고
// 그다음 「일지에 있음」 이 일지별이다(검증 없는 묶음이 앞). 일지 없는 파일을 고르면 diff 위에 띠가 서서
// 에이전트에게 맡기거나 직접 한 건 남기게 한다.
//
// 이 파일은 배치와 화면 동작만 갖는다: 목록·기준선은 `useDiffChanges`, 고른 파일 한 장은 `useDiffFile`,
// 건너온 지정은 `useDiffHandoff`, 키는 `useDiffKeys`, 머리줄은 `DiffFileHead`, 본문 분기는 `DiffBody`.
// 키는 컨테이너가 듣는다 — 전역 keydown 이 아니다.
//
// 채운 단추는 하나다(영수증 규칙 3): 보낼 메모가 있으면 「메모 N개 맡기기」, 없으면 띠의 「Claude 에게
// 맡기기」. 세 흐름(메모 · 일지 없는 변경 · 이 파일)이 같은 작성기(`requestSendToClaude` — 미리보기와
// 받는 세션)를 지난다 — 맡기기만 미리보기 없이 바로 넣던 때가 있었다.

interface DiffScreenV2Props {
  projectId: number;
  /** Absolute project root — required by fileOpenApi.inExternalEditor. */
  projectRoot: string | null;
  /** 윗줄이 넘기지만 쓰지 않는다 — 걷은 부제(브랜치 · 커밋)의 자리. 커밋은 목록 머리가 말한다. */
  branch?: string | null;
  /** Jump to a journal entry (path relative to the journal root). */
  onOpenEntry?: (relativePath: string) => void;
}

/** 처음 고를 파일을 묶음이 오기까지 기다리는 최대 시간. */
const FIRST_PICK_WAIT_MS = 300;

export function DiffScreenV2({ projectId, projectRoot, onOpenEntry }: DiffScreenV2Props) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const { diffMode } = state;
  const { settings } = useSettings();
  const ignoreWhitespace = ignoreWhitespaceStore.useValue();

  const list = useDiffChanges(projectId);
  const { changes, baseline, lastCommit, lastCommitChanges, workingChanges } = list;
  const { entries, ready: entriesReady } = useGroupEntries(projectId, list.groups);
  const buckets = useMemo(() => {
    const b = splitChanges(list.groups, changes);
    return { ...b, groups: sortGroups(b.groups, entries) };
  }, [list.groups, changes, entries]);
  const generated = useMemo(() => generatedSet(changes, list.marked), [changes, list.marked]);
  const missing = useMemo(() => new Set(missingGroupKeys(buckets.groups, entries)), [buckets.groups, entries]);

  // 처음 고르기는 묶음 · 생성 표지가 올 때까지(최대 300ms) 미룬다 — 가장 최근 파일을 먼저 골랐다가 일지
  // 없는 첫 파일로 다시 튀며 첫 진입이 세 번 흔들렸다. 표지를 안 기다리면 `bindings.ts` 를 처음 골랐다.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), FIRST_PICK_WAIT_MS);
    return () => clearTimeout(id);
  }, []);
  const file = useDiffFile(projectId, changes, baseline, {
    autoSelect: (buckets.known && entriesReady && list.markedReady) || waited,
    ignoreWhitespace,
  });
  const { selected, select } = file;
  // 사람이 고른 횟수 — 일지에서 건너온 늦은 답이 그 사이 사람이 고른 파일을 덮지 않게(목록 · 키가 이것으로 고른다).
  const handPicks = useRef(0);
  const pick = useCallback(
    (path: string) => {
      handPicks.current += 1;
      select(path);
    },
    [select],
  );
  const diffPath = file.diff?.path ?? null;
  const diffPatch = file.diff && "patch" in file.diff.source ? file.diff.source.patch : null;

  // 에이전트가 방금 일지를 남겼으면 「일지 없음」 이 풀려야 한다 — 일지 이벤트에 묶음을 다시 받는다.
  useJournalEvents(projectId, changes.length > 0, list.retryEnrich);

  const setMode = (mode: DiffMode) => setState((prev) => ({ ...prev, diffMode: mode }));

  // 펼친 묶음. 고른 파일이 든 묶음은 늘 펼친다(보이지 않는 파일이 선택돼 있으면 안 된다). 검증 없는
  // 묶음은 처음 한 번 펼쳐 둔다 — 사람이 접으면 다시 펼치지 않는다.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set<string>());
  const expand = useCallback(
    (key: string) => setOpen((prev) => (prev.has(key) ? prev : new Set(prev).add(key))),
    [],
  );
  const autoOpened = useRef(new Set<string>());
  useEffect(() => {
    const fresh = [...missing].filter((k) => !autoOpened.current.has(k));
    if (fresh.length === 0) return;
    for (const k of fresh) autoOpened.current.add(k);
    setOpen((prev) => new Set([...prev, ...fresh]));
  }, [missing]);
  const selectedGroup = useMemo(
    () => (selected ? buckets.groups.find((g) => g.files.includes(selected)) ?? null : null),
    [selected, buckets.groups],
  );
  useEffect(() => {
    if (selectedGroup) expand(groupKey(selectedGroup));
  }, [selectedGroup, expand]);
  const toggleGroup = useCallback(
    (key: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  const [genOpen, setGenOpen] = useState(false);
  useEffect(() => {
    if (selected && generated.has(selected)) setGenOpen(true);
  }, [selected, generated]);

  // 건너온 한 번짜리 지정(`diffActivePath`)이 있으면 그쪽이 처음 고르기를 이긴다 — 고른 것은 기준선이 바뀌어도
  // 덮지 않는다. 아무 파일도 못 골랐을 때만(「이 일지의 파일은 지금 변경에 없어요」) 처음 고르기가 돈다 — 풀지
  // 않던 때는 예외 먼저 고르기 대신 가장 최근 파일이 섰다.
  const [handingOff, setHandingOff] = useState(() => state.diffActivePath != null);
  const onHandoffDone = useCallback((picked: boolean) => {
    if (!picked) setHandingOff(false);
  }, []);
  useDiffHandoff({
    projectId,
    buckets,
    changes,
    ready: !list.listLoading && (buckets.known || waited || list.enrichError != null),
    select,
    expand,
    handPicks,
    onDone: onHandoffDone,
  });

  // 처음 고르기 — 일지 없는 첫 파일, 없으면 검증 없는 첫 묶음의 첫 파일. 기준선이 바뀌면 다시 한 번.
  const pickedFor = useRef<DiffBaseline | null>(null);
  useEffect(() => {
    if (handingOff || !buckets.known || !entriesReady || !list.markedReady || pickedFor.current === baseline) return;
    pickedFor.current = baseline;
    const first = firstPick(buckets, missing, generated, changes);
    if (first) select(first);
  }, [handingOff, buckets, baseline, entriesReady, list.markedReady, missing, generated, changes, select]);

  const splitRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 포커스는 목록이 처음 생긴 순간에 — 마운트 때는 아직 목록이 없어(git status · 워처를 기다린다)
  // 포커스가 갈 곳이 없었고, 그래서 j/k 가 먹지 않았다. 입력칸에 쓰는 중이거나 대화상자 안이면 그대로 둔다:
  // 워처가 늦게 목록을 채울 때 열린 치트시트 · 확인 창의 포커스가 뒤 화면으로 빠지면 포커스 가둠이 깨진다.
  const hasList = changes.length > 0;
  useEffect(() => {
    if (!hasList) return;
    const el = document.activeElement as HTMLElement | null;
    const busy =
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable ||
        el.closest('[role="dialog"], [aria-modal="true"], dialog') != null);
    if (!busy) splitRef.current?.focus({ preventScroll: true });
  }, [hasList]);
  useEffect(() => {
    if (!selected) return;
    for (const row of listRef.current?.querySelectorAll<HTMLElement>(".chg-item") ?? []) {
      if (row.dataset.path === selected) row.scrollIntoView?.({ block: "nearest" });
    }
  }, [selected]);

  const openFile = useCallback(
    (path: string | null, line: number | null) => {
      if (!path || !projectRoot) return;
      void fileOpenApi
        .inExternalEditor(projectRoot, path, settings.externalEditorCommand, line)
        .catch((e: unknown) => toast.destructive(t("diff.editorFailed", { error: errorDetail(e) })));
    },
    [projectRoot, settings.externalEditorCommand, t],
  );
  const onOpenEditor = useCallback(() => openFile(selected, null), [openFile, selected]);
  // 줄은 보이는 본문의 것이다 — 파일을 넘기는 동안의 이전 본문이면 그 파일로 연다.
  const openLine = useCallback((line: number) => openFile(diffPath, line), [openFile, diffPath]);
  const openBodyAt = useCallback((line: number | null) => openFile(diffPath ?? selected, line), [openFile, diffPath, selected]);

  // 일지 없는 변경을 남기는 두 길. 둘 다 「일지 없음」 묶음 전체를 다룬다 — 한 번의 작업이 여러 파일을
  // 고친 경우가 대부분이고, 에이전트는 한 건으로 묶어 쓰는 편이 낫다.
  const unrecorded = buckets.unrecorded;
  const unrecordedKey = unrecorded.join("\n");
  const askedKey = useAskedKey(projectId);
  const asked = unrecorded.length > 0 && askedKey === unrecordedKey;
  const askClaude = () => {
    const [first] = unrecorded;
    requestSendToClaude({
      kind: "file",
      label: t("diff.fileCount", { n: unrecorded.length }),
      ref: unrecorded.length > 1 ? `${first} ${t("diff.unrecorded.promptMore", { n: unrecorded.length - 1 })}` : first,
      note: t("today.check.kind.unrecorded"),
      prefill: recordRequestText(unrecorded, t("diff.unrecorded.prompt"), (n) => t("diff.unrecorded.promptMore", { n })),
      onSent: () => markAsked(projectId, unrecordedKey),
    });
  };
  const [manual, setManual] = useState<{ workday: string; files: string[] } | null>(null);
  const openManual = async () => {
    // 일지는 프로젝트의 workday 에 쓰인다 — 모르면 로컬 달력으로.
    const status = await oculpmApi.getStatus(projectId).catch(() => null);
    setManual({ workday: status?.current_workday || localWorkdayKey(), files: unrecorded });
  };
  const selectedUnrecorded = buckets.known && selected != null && unrecorded.includes(selected);

  // 줄 메모 (Orca 「Annotate AI Diffs」) — 고른 파일의 줄마다 달고, 다 달면 한 번에 Claude 에게.
  // 보낸 메모는 남아 바뀌었는지를 저절로 보인다(#notes-track) — 영속은 WorkspaceContext(diffNotes).
  const noteState = useDiffNotes(projectId);
  // 메모의 자리는 보이는 본문의 파일이다 — 넘기는 동안 이전 본문의 줄에 새 파일 이름으로 달리지 않게.
  const noteTarget = useMemo(() => (diffPath ? { projectId, file: diffPath } : null), [projectId, diffPath]);
  const drafts = noteState.notes.filter((n) => !n.sent);
  const sentNotes = noteState.notes.filter((n) => n.sent);
  // 「바뀜 k/n」 은 가릴 수 있는 메모만 센다 — 지운 줄 · 흔한 줄의 메모는 「보냄」 으로 따로 둔다.
  const judged = sentNotes.filter(isJudged);
  const fixedCount = judged.filter((n) => n.fixed).length;
  const noteCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of noteState.notes) m.set(n.file, (m.get(n.file) ?? 0) + 1);
    return m;
  }, [noteState.notes]);
  const notedFiles = useMemo(() => new Set(noteCounts.keys()), [noteCounts]);
  // PR 영수증 — 이 가지의 일지 · 확인 명령 결과 · 일지 없는 변경을 마크다운으로 (11-02).
  const copyReceipt = () =>
    void buildReceipt(projectId, t)
      .then((md) => navigator.clipboard.writeText(md))
      .then(() => toast.info(t("diff.receipt.copied")))
      .catch((e) => toast.destructive(t("diff.receipt.failed", { error: tError(toAppError(e)) })));

  const sendNotes = () =>
    requestSendToClaude({
      kind: "notes",
      label: t("diff.notes.count", { n: drafts.length }),
      ref: "",
      prefill: composeNotes(drafts, t),
      onSent: () => markSent(projectId),
    });
  // 다 지우기는 확인 없이, 대신 되돌릴 수 있게 — 채운 단추 바로 옆에서 실수로 눌리는 자리다.
  const clearAll = () => {
    const removed = clearNotes(projectId);
    if (removed.length === 0) return;
    toast.info(t("diff.notes.cleared", { n: removed.length }), {
      actions: [{ label: t("diff.notes.undo"), onClick: () => restoreNotes(projectId, removed) }],
    });
  };
  useEffect(() => {
    hydrateNotes(projectId, state.diffNotes ?? []);
    // 창이 열린 뒤 처음 한 번 — 그 뒤로는 저장소가 원본이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => {
    if (noteState.notes !== state.diffNotes) setState((prev) => ({ ...prev, diffNotes: noteState.notes }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteState.notes]);
  // 보낸 메모의 판정 — 파일의 지금 내용과 견준다. 그 파일의 변경 시각이 바뀔 때만 다시 읽는다(워처
  // 이벤트마다 보낸 파일을 전부 다시 읽던 것).
  const changeByPath = useMemo(() => new Map(changes.map((c) => [c.path, c] as const)), [changes]);
  const sentKey = [...new Set(sentNotes.filter((n) => n.side === "new").map((n) => n.file))]
    .sort()
    .map((f) => `${f}\t${changeByPath.get(f)?.ts ?? "-"}`)
    .join("\n");
  useEffect(() => {
    if (!sentKey) return;
    let alive = true;
    const files = sentKey.split("\n").map((row) => row.split("\t")[0]);
    void Promise.all(
      files.map((f) =>
        projectFileApi.read(projectId, f).then(
          (text) => [f, text] as const,
          // 없으면(지워졌으면) 줄이 사라진 것 — 그 밖의 읽기 오류(권한 · 잠금)는 판정을 바꾸지 않는다.
          (e: unknown) => (isNotFoundError(errorDetail(e)) ? ([f, null] as const) : null),
        ),
      ),
    ).then((pairs) => {
      if (alive) applyResolution(projectId, new Map(pairs.filter((p): p is readonly [string, string | null] => p != null)));
    });
    return () => {
      alive = false;
    };
  }, [projectId, sentKey]);

  // 봤음 — (경로, 그때 패치 해시). 다시 바뀌면 풀려 예외로 다시 선다. 공백 무시는 본문을 읽은 때의 값이다
  // (토글 직후 다시 읽기 전의 본문을 새 토글 값의 해시로 견주면 「본 뒤 바뀜」 이 한 번 깜빡였다).
  const viewedMap = useViewed(projectId);
  const currentHash = useMemo(
    () => (diffPatch != null && !file.loading ? { hash: patchHash(diffPatch), ws: file.diffWs } : null),
    [diffPatch, file.loading, file.diffWs],
  );
  const viewStateFor = useCallback(
    (path: string) =>
      viewStateOf(viewedMap.get(viewedKey(baseline, path)), changeByPath.get(path), path === diffPath ? currentHash : null),
    [viewedMap, baseline, changeByPath, diffPath, currentHash],
  );
  const viewedN = changes.filter((c) => viewStateFor(c.path) === "viewed").length;
  const selectedViewed = selected ? viewStateFor(selected) === "viewed" : false;
  const toggleViewed = useCallback(() => {
    if (!selected) return;
    const key = viewedKey(baseline, selected);
    if (viewStateFor(selected) === "viewed") {
      setViewed(projectId, key, null);
      return;
    }
    const hash = diffPath === selected && diffPatch != null ? patchHash(diffPatch) : "";
    setViewed(projectId, key, { hash, ts: changeByPath.get(selected)?.ts ?? 0, ws: file.diffWs });
  }, [selected, baseline, viewStateFor, projectId, diffPath, diffPatch, changeByPath, file.diffWs]);

  // 공백 무시는 git 갈래에만 걸린다 — 스냅샷 · 기준본 없는 새 파일 · 바이너리를 보는 중이면 막고 이유를 말한다.
  const wsBlocked =
    file.diff && file.diff.path === selected && file.diff.source.source !== "git" ? t("diff.ignoreWhitespaceGitOnly") : null;

  const onKeyDown = useDiffKeys({
    buckets,
    changes,
    open,
    expand,
    generated,
    generatedOpen: genOpen,
    selected,
    select: pick,
    patch: diffPatch,
    notedFiles,
    toggleViewed,
    openEditorAt: openBodyAt,
    listRef,
    bodyRef,
  });

  const askFile = () =>
    selected &&
    requestSendToClaude({
      kind: "file",
      label: selected,
      ref: selected,
      note: selectedUnrecorded ? t("today.check.kind.unrecorded") : undefined,
    });

  return (
    <>
      <Toolbar title={t("nav.diff")}>
        <button type="button" className="btn ghost sm" title={t("diff.receipt.copyTitle")} onClick={copyReceipt}>
          {t("diff.receipt.copy")}
        </button>
        {noteState.notes.length > 0 ? (
          <>
            {judged.length > 0 ? (
              <span className={"chip sm " + (fixedCount === judged.length ? "ok" : "warn")} title={t("diff.notes.progressTitle")}>
                {t("diff.notes.progress", { fixed: fixedCount, n: judged.length })}
              </span>
            ) : null}
            <button type="button" className="btn ghost sm" onClick={clearAll}>
              {t("diff.notes.clearAll")}
            </button>
            {drafts.length > 0 ? (
              <button type="button" className="btn primary sm" onClick={sendNotes}>
                {t("diff.notes.send", { n: drafts.length })}
              </button>
            ) : null}
          </>
        ) : null}
        {lastCommitChanges.length > 0 ? (
          <RadioSeg<DiffBaseline>
            label={t("diff.modeTitle")}
            title={t("diff.modeTitle")}
            value={baseline}
            options={[
              {
                id: "working",
                label: workingChanges.length > 0 ? `${t("diff.modeWorking")} ${workingChanges.length}` : t("diff.modeWorking"),
              },
              { id: "last_commit", label: t("diff.lastCommit") },
            ]}
            onChange={list.pinBaseline}
          />
        ) : null}
      </Toolbar>

      {changes.length === 0 ? (
        <div className="scroll">
          <div className="page">
            {/* 세 상태를 가른다: 아직 모름 / 못 물어봄 / 정말 없음. */}
            {list.listLoading ? (
              <SkeletonList rows={4} height={44} />
            ) : list.listError ? (
              <ErrorCard title={t("diff.listFailed")} error={list.listError} onRetry={list.retryList} />
            ) : (
              /* 직전 커밋으로 가는 길을 글이 아니라 버튼으로 (v3-surface). */
              <EmptyState
                density="rich"
                actions={
                  list.hasLastCommit ? (
                    <button className="btn primary sm" onClick={() => list.pinBaseline("last_commit")}>
                      {t("diff.lastCommit")}
                    </button>
                  ) : null
                }
              >
                {list.hasLastCommit ? t("diff.emptyWorking") : t("diff.emptyBranch")}
              </EmptyState>
            )}
          </div>
        </div>
      ) : (
        <div className="chg-split" ref={splitRef} tabIndex={-1} onKeyDown={onKeyDown}>
          <ChangeFileList
            changes={changes}
            buckets={buckets}
            entries={entries}
            selected={selected}
            open={open}
            onToggle={toggleGroup}
            onSelect={pick}
            listRef={listRef}
            generated={generated}
            generatedOpen={genOpen}
            onToggleGenerated={() => setGenOpen((v) => !v)}
            viewStateOf={viewStateFor}
            noteCounts={noteCounts}
            commit={baseline === "last_commit" && lastCommit ? lastCommit : null}
            viewedCount={viewedN > 0 ? { n: viewedN, m: changes.length } : null}
          />
          <div className="chg-main">
            {list.enrichError ? (
              <ErrorCard title={t("diff.enrichFailed")} error={list.enrichError} onRetry={list.retryEnrich} style={{ margin: 12 }} />
            ) : null}
            {selectedUnrecorded ? (
              <UnrecordedBanner
                count={unrecorded.length}
                asked={asked}
                primary={drafts.length === 0}
                onAsk={askClaude}
                onManual={() => void openManual()}
              />
            ) : null}
            <DiffFileHead
              selected={selected}
              current={file.current}
              stats={diffPath === selected ? file.stats : null}
              changedAt={file.changedAt}
              slow={file.slow && file.diff != null}
              viewed={selectedViewed}
              mode={diffMode}
              ignoreWhitespace={ignoreWhitespace}
              wsBlocked={wsBlocked}
              onToggleViewed={toggleViewed}
              onAsk={() => void askFile()}
              onMode={setMode}
              onIgnoreWhitespace={(next) => ignoreWhitespaceStore.set(next)}
              onOpenEditor={onOpenEditor}
            />
            <div className={"diff-code" + (file.slow && diffPath !== selected ? " is-stale" : "")} ref={bodyRef}>
              {file.error ? (
                // 「다시 시도」 버튼이 안 그려지고 있었다 — ErrorCard 는 onRetry 가 있어야 버튼을 낸다.
                <ErrorCard title={t("diff.failed")} error={file.error} style={{ margin: 16 }} onRetry={file.retry} />
              ) : file.diff ? (
                <DiffBody
                  result={file.diff}
                  mode={diffMode}
                  deleted={changeByPath.get(file.diff.path)?.op === "D"}
                  baseline={baseline}
                  projectId={projectId}
                  notes={noteTarget}
                  ignoreWhitespace={file.diffWs}
                  onOpenLine={openLine}
                  onOpenEditor={onOpenEditor}
                />
              ) : file.slow ? (
                <LoadingState align="start" density="compact">
                  {t("diff.computing")}
                </LoadingState>
              ) : selected ? null : (
                <EmptyState>{t("diff.pickFile")}</EmptyState>
              )}
            </div>
            {/* 이 파일을 적은 일지의 검증 — 일지가 말한 것과 바뀐 것을 한 화면에. 일지가 없는 파일에는 안 그린다. */}
            {selectedGroup?.entry_path ? (
              <DiffEntryFooter
                projectId={projectId}
                group={selectedGroup}
                onToggleVerified={(path, next) => void list.toggleVerified(path, next)}
                onOpenEntry={onOpenEntry}
              />
            ) : null}
          </div>
        </div>
      )}

      {manual ? (
        <ManualEntryModalV2
          projectId={projectId}
          workday={manual.workday}
          seedFiles={manual.files}
          onCreated={(entry) => {
            toast.info(t("journal.written", { title: entry.title }));
            list.retryEnrich();
          }}
          onClose={() => setManual(null)}
        />
      ) : null}
    </>
  );
}
