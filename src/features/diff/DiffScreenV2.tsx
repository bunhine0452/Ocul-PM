import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { SkeletonList } from "@/components/ui/Skeleton";
import { Toolbar } from "@/components/Toolbar";
import { ExternalLinkIcon, Loader } from "@/components/Icons";
import { fileOpenApi } from "@/api/fileOpen";
import { errorDetail, toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { useWorkspace, type DiffMode } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { ManualEntryModalV2 } from "@/features/oculpm/ManualEntryModalV2";
import { useJournalEvents } from "@/features/oculpm/useOculpmLive";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { toast } from "@/lib/toast";
import { localWorkdayKey } from "@/lib/workday";
import { ChangeFileList } from "./ChangeFileList";
import { DiffBody } from "./DiffBody";
import { DiffEntryFooter } from "./DiffEntryFooter";
import { UnrecordedBanner } from "./UnrecordedBanner";
import { groupKey, recordRequestText, splitChanges, visiblePaths } from "./changeGroups";
import type { DiffBaseline } from "./changeList";
import { useDiffChanges } from "./useDiffChanges";
import { useDiffFile } from "./useDiffFile";
import { useGroupEntries } from "./useGroupEntries";
import "./changes.css";
import { requestSendToClaude, sendOrRun } from "@/features/terminal/sendToClaude";
import { clearNotes, composeNotes, useDiffNotes } from "./diffNoteStore";
import { tError } from "@/i18n/errors";

// 변경 화면 (4.0) — 왼쪽 340px 목록 + 오른쪽 diff. 목록은 「기록 없음」(어느 일지에도 없는 변경)이
// 먼저이고 그다음 「일지에 있음」 이 일지별이다. 기록 없는 파일을 고르면 diff 위에 배너가 서서
// 에이전트에게 맡기거나(요청 복사) 직접 한 건 남기게 한다.
//
// 이 파일은 배치와 화면 동작만 갖는다: 목록·기준선은 `useDiffChanges`, 고른 파일 한 장은
// `useDiffFile`, 일지 요약은 `useGroupEntries`, 본문 분기는 `DiffBody` 가 소유한다.
// 키는 컨테이너가 듣는다 (j/k 파일 이동) — 전역 keydown 이 아니다.

interface DiffScreenV2Props {
  projectId: number;
  /** Absolute project root — required by fileOpenApi.inExternalEditor. */
  projectRoot: string | null;
  branch: string | null;
  /** Jump to a journal entry (path relative to the journal root). */
  onOpenEntry?: (relativePath: string) => void;
}

export function DiffScreenV2({ projectId, projectRoot, branch, onOpenEntry }: DiffScreenV2Props) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const { diffMode } = state;
  const { settings } = useSettings();

  const list = useDiffChanges(projectId);
  const { changes, baseline, lastCommit, lastCommitChanges, workingChanges } = list;
  const file = useDiffFile(projectId, changes, baseline);
  const { selected } = file;
  const buckets = useMemo(() => splitChanges(list.groups, changes), [list.groups, changes]);
  const entries = useGroupEntries(projectId, list.groups);

  // 에이전트가 방금 일지를 남겼으면 「기록 없음」 이 풀려야 한다 — 일지 이벤트에 묶음을 다시 받는다.
  const regroup = list.retryEnrich;
  useJournalEvents(projectId, changes.length > 0, regroup);

  const setMode = (mode: DiffMode) => setState((prev) => ({ ...prev, diffMode: mode }));

  // 펼친 묶음. 고른 파일이 든 묶음은 늘 펼쳐져 있다 (보이지 않는 파일이 선택돼 있으면 안 된다).
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set<string>());
  const selectedGroup = useMemo(
    () => (selected ? buckets.groups.find((g) => g.files.includes(selected)) ?? null : null),
    [selected, buckets.groups],
  );
  useEffect(() => {
    if (!selectedGroup) return;
    const key = groupKey(selectedGroup);
    setOpen((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [selectedGroup]);
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

  // 처음 열 때는 예외부터 — 기록 없는 파일이 있으면 그 첫 파일을 고른다. 일지에서 건너온 한 번짜리
  // 지정(`diffActivePath`)이 있으면 그쪽이 이긴다. 기준선이 바뀌면 다시 한 번.
  const handoff = useRef(state.diffActivePath != null);
  const pickedFor = useRef<DiffBaseline | null>(null);
  const select = file.select;
  useEffect(() => {
    if (handoff.current || !buckets.known || pickedFor.current === baseline) return;
    pickedFor.current = baseline;
    if (buckets.unrecorded.length > 0) select(buckets.unrecorded[0]);
  }, [buckets, baseline, select]);

  const splitRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = document.activeElement as HTMLElement | null;
    const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    if (!typing) splitRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!selected) return;
    for (const row of listRef.current?.querySelectorAll<HTMLElement>(".chg-item") ?? []) {
      if (row.dataset.path === selected) row.scrollIntoView?.({ block: "nearest" });
    }
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
    if (e.key !== "j" && e.key !== "k") return;
    e.preventDefault();
    const paths = visiblePaths(buckets, changes, open);
    if (paths.length === 0) return;
    const cur = selected ? paths.indexOf(selected) : -1;
    const next = e.key === "j" ? Math.min(cur + 1, paths.length - 1) : Math.max(cur - 1, 0);
    select(paths[next]);
    // 포커스도 따라간다 — 안 그러면 이전 줄에 남은 포커스에서 Enter 가 옛 줄을 다시 고른다.
    requestAnimationFrame(() => {
      for (const row of listRef.current?.querySelectorAll<HTMLElement>(".chg-item") ?? []) {
        if (row.dataset.path === paths[next]) row.focus({ preventScroll: true });
      }
    });
  };

  const onOpenEditor = useCallback(async () => {
    if (!selected || !projectRoot) return;
    await fileOpenApi
      .inExternalEditor(projectRoot, selected, settings.externalEditorCommand, null)
      .catch((e: unknown) => toast.destructive(t("diff.editorFailed", { error: errorDetail(e) })));
  }, [projectRoot, selected, settings.externalEditorCommand, t]);

  // 기록 없는 변경을 남기는 두 길. 둘 다 「기록 없음」 묶음 전체를 다룬다 — 한 번의 작업이 여러 파일을
  // 고친 경우가 대부분이고, 에이전트는 한 건으로 묶어 쓰는 편이 낫다.
  const unrecorded = buckets.unrecorded;
  // 「Claude 에게 맡기기」 — 기록 요청을 앱 안 터미널의 claude 에 (클립보드 경로는 걷었다, #diff-rows).
  const askClaude = () => {
    const text = recordRequestText(unrecorded, t("diff.unrecorded.prompt"), (n) => t("diff.unrecorded.promptMore", { n }));
    void sendOrRun(projectId, text)
      .then((n) => {
        if (n != null) toast.info(t("send.sent", { n }));
      })
      .catch((e) => toast.destructive(t("send.failed", { error: tError(toAppError(e)) })));
  };
  const [manual, setManual] = useState<{ workday: string; files: string[] } | null>(null);
  const openManual = async () => {
    // 일지는 프로젝트의 workday 에 쓰인다 — 모르면 로컬 달력으로.
    const status = await oculpmApi.getStatus(projectId).catch(() => null);
    setManual({ workday: status?.current_workday || localWorkdayKey(), files: unrecorded });
  };

  const sub =
    baseline === "last_commit"
      ? t("diff.summaryLast", { n: changes.length, sha: lastCommit?.short_sha ?? "", subject: lastCommit?.subject ?? "" })
      : branch
        ? t("diff.summaryBranch", { n: changes.length, branch })
        : t("diff.summaryWorking", { n: changes.length });
  const selectedUnrecorded = buckets.known && selected != null && unrecorded.includes(selected);

  // 줄 메모 (Orca 「Annotate AI Diffs」) — 고른 파일의 줄마다 달고, 다 달면 한 번에 Claude 에게.
  const noteState = useDiffNotes(projectId);
  const noteTarget = useMemo(() => (selected ? { projectId, file: selected } : null), [projectId, selected]);
  const noteCount = noteState.notes.length;
  const sendNotes = () =>
    requestSendToClaude({
      kind: "notes",
      label: t("diff.notes.count", { n: noteCount }),
      ref: "",
      prefill: composeNotes(noteState.notes, t),
      onSent: () => clearNotes(projectId),
    });

  return (
    <>
      <Toolbar title={t("nav.diff")} sub={sub}>
        {noteCount > 0 ? (
          <>
            <button type="button" className="btn ghost sm" onClick={() => clearNotes(projectId)}>
              {t("diff.notes.clearAll")}
            </button>
            <button type="button" className="btn primary sm" onClick={sendNotes}>
              {t("diff.notes.send", { n: noteCount })}
            </button>
          </>
        ) : null}
        {lastCommitChanges.length > 0 ? (
          <div className="seg" role="tablist" title={t("diff.modeTitle")} aria-label={t("diff.modeTitle")}>
            {(
              [
                ["working", t("diff.modeWorking")],
                ["last_commit", t("diff.lastCommit")],
              ] as [DiffBaseline, string][]
            ).map(([b, label]) => (
              <button
                key={b}
                type="button"
                role="tab"
                aria-selected={baseline === b}
                className="seg-item"
                onClick={() => list.pinBaseline(b)}
              >
                {label}
                {b === "working" && workingChanges.length > 0 ? ` ${workingChanges.length}` : ""}
              </button>
            ))}
          </div>
        ) : null}
      </Toolbar>

      {changes.length === 0 ? (
        <div className="scroll">
          <div className={"page" + (list.listLoading ? "" : " fade-in")}>
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
            onSelect={select}
            listRef={listRef}
          />
          <div className="chg-main">
            {list.enrichError ? (
              <ErrorCard title={t("diff.enrichFailed")} error={list.enrichError} onRetry={list.retryEnrich} style={{ margin: 12 }} />
            ) : null}
            {selectedUnrecorded ? (
              <UnrecordedBanner count={unrecorded.length} onAsk={askClaude} onManual={() => void openManual()} />
            ) : null}
            <div className="chg-fh">
              <b className="chg-fname" title={selected ?? undefined}>
                {selected ?? "—"}
              </b>
              {file.current ? (
                <span className="chip sm">
                  {file.current.op === "A"
                    ? t("diff.opAdded")
                    : file.current.op === "D"
                      ? t("diff.opDeleted")
                      : t("diff.opModified")}
                </span>
              ) : null}
              {file.stats ? (
                <span className="diff-stat" title={t("diff.statsTitle")}>
                  <span className="add">+{file.stats.add}</span>
                  <span className="del">−{file.stats.del}</span>
                </span>
              ) : null}
              <span className="chg-sp" />
              {selected ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() =>
                    requestSendToClaude({
                      kind: "file",
                      label: selected,
                      ref: selected,
                      note: selectedUnrecorded ? t("today.check.kind.unrecorded") : undefined,
                    })
                  }
                >
                  {t("send.title")}
                </button>
              ) : null}
              <div className="seg" role="tablist" aria-label={t("diff.viewAria")}>
                {(["unified", "split"] as DiffMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={diffMode === m}
                    className="seg-item"
                    onClick={() => setMode(m)}
                  >
                    {m === "unified" ? t("diff.viewUnified") : t("diff.viewSplit")}
                  </button>
                ))}
              </div>
              <button
                className="iconbtn"
                onClick={onOpenEditor}
                {...blocked(selected ? null : t("diff.blockedNoFile"), t("diff.openEditor"))}
                aria-label={t("diff.openEditor")}
              >
                <ExternalLinkIcon size={15} />
              </button>
            </div>

            <div className="diff-code">
              {file.loading ? (
                <EmptyState>
                  <Loader size={15} /> {t("diff.computing")}
                </EmptyState>
              ) : file.error ? (
                // 「다시 시도」 버튼이 안 그려지고 있었다 — ErrorCard 는 onRetry 가 있어야 버튼을 낸다.
                <ErrorCard title={t("diff.failed")} error={file.error} style={{ margin: 16 }} onRetry={file.retry} />
              ) : file.diff ? (
                <DiffBody
                  result={file.diff}
                  mode={diffMode}
                  newFilePatch={file.newFilePatch}
                  newFileError={file.newFileError}
                  deleted={file.current?.op === "D"}
                  baseline={baseline}
                  projectId={projectId}
                  notes={noteTarget}
                />
              ) : (
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
