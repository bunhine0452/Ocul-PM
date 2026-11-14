import { memo, useMemo, type Ref } from "react";
import { ChevronDown, ChevronRight } from "@/components/Icons";
import { evidenceStateOf } from "@/features/oculpm/evidenceState";
import { timeLabel } from "@/features/oculpm/JournalRow";
import { TRIGGER_META } from "@/features/oculpm/triggerMeta";
import { normalizeJournalRef } from "@/features/oculpm/useJournalPlanLinks";
import { useT } from "@/i18n";
import type { ChangeGroup, EntryType, JournalEntrySummary } from "@/lib/bindings";
import { splitPath } from "@/lib/filePath";
import type { ChangeOp, RecentChange } from "@/lib/recentChangesStore";
import { cleanTitle, generatedPaths, groupKey, type ChangeBuckets } from "./changeGroups";
import type { ViewState } from "./diffSessionStore";

// 변경 화면의 왼쪽 목록 (4.0). 「기록 없음」 이 먼저다 — 어느 일지에도 없는 변경이 이 화면의 예외이고,
// 사람이 먼저 봐야 하는 것이다. 그다음 「일지에 있음」 이 일지별로 묶여 선다 (펼치면 그 파일들).
// 11-15: 검증 없는 묶음이 먼저 펼쳐져 서고(차례는 화면이 정한다), 잠금 · 생성 파일은 끝의 접힌 한 줄로
// 가고, 행 끝이 메모 수와 「본 뒤 바뀜」 을 말한다. 본 파일은 흐리게 선다.

const OP_KEY = { A: "diff.opAdded", M: "diff.opModified", D: "diff.opDeleted" } as const;

type T = ReturnType<typeof useT>["t"];

interface ChangeFileListProps {
  changes: readonly RecentChange[];
  buckets: ChangeBuckets;
  /** 일지 요약 (증거 등급) — 키는 일지의 저널 기준 경로. */
  entries: ReadonlyMap<string, JournalEntrySummary>;
  selected: string | null;
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onSelect: (path: string) => void;
  listRef: Ref<HTMLDivElement>;
  /** 잠금 · 생성 파일 — 자리에서 빠져 끝의 「생성된 파일 N개」 로. */
  generated: ReadonlySet<string>;
  generatedOpen: boolean;
  onToggleGenerated: () => void;
  viewStateOf: (path: string) => ViewState;
  noteCounts: ReadonlyMap<string, number>;
  /** 최근 커밋을 보는 중이면 그 커밋 — 목록 머리에 「a1b2c3d · 제목」. */
  commit: { short_sha: string; subject: string } | null;
  /** 본 것 n/m — 하나라도 봤을 때만. */
  viewedCount: { n: number; m: number } | null;
}

/** 오늘이면 시각만, 아니면 날짜와 시각. */
function stamp(iso: string | null, t: T): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(iso);
  if (!m) return "";
  const today = new Date();
  const same =
    Number(m[1]) === today.getFullYear() && Number(m[2]) === today.getMonth() + 1 && Number(m[3]) === today.getDate();
  const time = timeLabel(iso);
  return same ? time : `${t("journal.dayMd", { m: String(Number(m[2])), d: String(Number(m[3])) })} ${time}`;
}

/** 파일 한 줄 — 바뀐 종류(M · A · D) · 경로 · 메모 수 · 본 뒤 바뀜 · 시각 (화면 검사 #diff-rows). */
const FileRow = memo(function FileRow({
  path,
  change,
  nested,
  active,
  view,
  notes,
  onSelect,
}: {
  path: string;
  change: RecentChange | undefined;
  nested: boolean;
  active: boolean;
  view: ViewState;
  notes: number;
  onSelect: (path: string) => void;
}) {
  const { t } = useT();
  const op: ChangeOp = change?.op ?? "M";
  const { dir, base } = splitPath(path, "", 3);
  // 시각은 이 앱이 본 변경에만 있다 (`ts: 0` 은 git 이 준 바탕 — 언제인지 모른다).
  const when = change && change.ts > 0 ? new Date(change.ts).toTimeString().slice(0, 5) : "";
  return (
    <button
      type="button"
      className={"chg-item" + (nested ? " nested" : "") + (view === "viewed" ? " is-viewed" : "")}
      data-path={path}
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(path)}
      title={path}
    >
      <span className="chg-r1">
        <span className="chg-op" data-op={op} title={t(OP_KEY[op])} aria-label={t(OP_KEY[op])}>
          {op}
        </span>
        <span className="chg-name">
          {dir ? <span className="chg-dir"><bdi>{dir}</bdi></span> : null}
          <span className="chg-base">{base}</span>
        </span>
        {notes > 0 || view === "changed" || when ? (
          <span className="chg-end">
            {notes > 0 ? (
              <span className="chg-notes" title={t("diff.notes.count", { n: notes })}>
                {notes}
              </span>
            ) : null}
            {view === "changed" ? (
              <span className="chg-changed" role="img" aria-label={t("diff.changedSinceViewed")} title={t("diff.changedSinceViewed")} />
            ) : null}
            {when ? <span className="chg-when">{when}</span> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
});

export function ChangeFileList({
  changes,
  buckets,
  entries,
  selected,
  open,
  onToggle,
  onSelect,
  listRef,
  generated,
  generatedOpen,
  onToggleGenerated,
  viewStateOf,
  noteCounts,
  commit,
  viewedCount,
}: ChangeFileListProps) {
  const { t } = useT();
  const byPath = useMemo(() => new Map(changes.map((c) => [c.path, c] as const)), [changes]);
  const keep = (p: string) => !generated.has(p);
  const genList = generatedPaths(buckets, changes, generated);

  const fileRow = (path: string, nested: boolean) => (
    <FileRow
      key={path}
      path={path}
      change={byPath.get(path)}
      nested={nested}
      active={path === selected}
      view={viewStateOf(path)}
      notes={noteCounts.get(path) ?? 0}
      onSelect={onSelect}
    />
  );

  const groupRow = (g: ChangeGroup) => {
    const key = groupKey(g);
    const isOpen = open.has(key);
    const summary = g.entry_path ? entries.get(normalizeJournalRef(g.entry_path)) : undefined;
    const kind = TRIGGER_META[(g.entry_type ?? "chore") as EntryType] ?? TRIGGER_META.chore;
    const state = summary ? evidenceStateOf(summary) : null;
    const when = stamp(g.created_at, t);
    return (
      <div className="chg-group" key={key}>
        <button type="button" className="chg-item chg-grp" aria-expanded={isOpen} onClick={() => onToggle(key)}>
          <span className="chg-r1">
            {isOpen ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
            <span className="chg-ti">{cleanTitle(g.entry_title ?? "") || g.entry_path}</span>
            <span className="chg-count">{g.files.length}</span>
          </span>
          <span className="chg-meta">
            {t(kind.labelKey)}
            {when ? ` · ${when}` : null}
            {state === "command" ? <span className="chg-ok"> · ✓ {t("diff.evidence.command")}</span> : null}
            {state === "confirmed" ? <span className="chg-ok"> · ✓ {t("entry.verified")}</span> : null}
            {state === "missing" ? <span className="chg-warn"> · {t("journal.evidence.missing")}</span> : null}
          </span>
        </button>
        {isOpen ? g.files.filter(keep).map((p) => fileRow(p, true)) : null}
      </div>
    );
  };

  const recordedFiles = buckets.groups.reduce((n, g) => n + g.files.length, 0);

  return (
    <div className="chg-list" ref={listRef} role="region" aria-label={t("diff.changedFiles")}>
      {commit || viewedCount ? (
        <div className="chg-lh">
          {commit ? (
            <span className="chg-commit" title={commit.subject}>
              <span className="mono">{commit.short_sha}</span>
              <span className="chg-commit-sub"> · {commit.subject}</span>
            </span>
          ) : null}
          {viewedCount ? (
            <span className="chg-viewed">
              {t("diff.viewedHead")} <span className="mono">{viewedCount.n}/{viewedCount.m}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      {buckets.known ? (
        <>
          {buckets.unrecorded.length > 0 ? (
            <section aria-label={t("diff.unrecorded.label")}>
              {/* 수는 일지 없는 변경 전부 — 끝으로 접은 잠금 · 생성 파일도 센다. */}
              <h3 className="chg-bh">
                <span className="chip sm warn">{t("diff.unrecorded.label")}</span>
                <span>{t("diff.fileCount", { n: buckets.unrecorded.length })}</span>
              </h3>
              {buckets.unrecorded.filter(keep).map((p) => fileRow(p, false))}
            </section>
          ) : null}
          {buckets.groups.length > 0 ? (
            <section aria-label={t("diff.recorded.label")}>
              <h3 className="chg-bh">
                <span className="chip sm hairline">{t("diff.recorded.label")}</span>
                <span>{t("diff.recorded.count", { files: recordedFiles, n: buckets.groups.length })}</span>
              </h3>
              {buckets.groups.map(groupRow)}
            </section>
          ) : null}
        </>
      ) : (
        /* 묶음을 아직 모른다 (오는 중이거나 조회가 실패했다) — 어느 쪽이라고도 말하지 않고 평평하게. */
        <section>
          <h3 className="chg-bh">
            <span>{t("diff.changedFiles")}</span>
            <span>{t("diff.fileCount", { n: changes.length })}</span>
          </h3>
          {[...changes].reverse().filter((c) => keep(c.path)).map((c) => fileRow(c.path, false))}
        </section>
      )}
      {genList.length > 0 ? (
        <div className="chg-group">
          <button
            type="button"
            className="chg-item chg-grp chg-gen"
            aria-expanded={generatedOpen}
            onClick={onToggleGenerated}
            title={t("diff.generatedTitle")}
          >
            <span className="chg-r1">
              {generatedOpen ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
              <span className="chg-ti">{t("diff.generated")}</span>
              <span className="chg-count">{genList.length}</span>
            </span>
          </button>
          {generatedOpen ? genList.map((p) => fileRow(p, true)) : null}
        </div>
      ) : null}
      <p className="chg-keys">{t("diff.keysHint")}</p>
    </div>
  );
}
