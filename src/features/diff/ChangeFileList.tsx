import { useMemo, type Ref } from "react";
import { ChevronDown, ChevronRight } from "@/components/Icons";
import { evidenceStateOf } from "@/features/oculpm/evidenceState";
import { timeLabel } from "@/features/oculpm/JournalRow";
import { TRIGGER_META } from "@/features/oculpm/triggerMeta";
import { normalizeJournalRef } from "@/features/oculpm/useJournalPlanLinks";
import { useT } from "@/i18n";
import type { ChangeGroup, EntryType, JournalEntrySummary } from "@/lib/bindings";
import { splitPath } from "@/lib/filePath";
import type { ChangeOp, RecentChange } from "@/lib/recentChangesStore";
import { cleanTitle, groupKey, type ChangeBuckets } from "./changeGroups";

// 변경 화면의 왼쪽 목록 (4.0). 「기록 없음」 이 먼저다 — 어느 일지에도 없는 변경이 이 화면의 예외이고,
// 사람이 먼저 봐야 하는 것이다. 그다음 「일지에 있음」 이 일지별로 묶여 선다 (펼치면 그 파일들).

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

export function ChangeFileList({ changes, buckets, entries, selected, open, onToggle, onSelect, listRef }: ChangeFileListProps) {
  const { t } = useT();
  const byPath = useMemo(() => new Map(changes.map((c) => [c.path, c] as const)), [changes]);

  const fileRow = (path: string, nested: boolean) => {
    const change = byPath.get(path);
    const op: ChangeOp = change?.op ?? "M";
    const { dir, base } = splitPath(path, "", 3);
    const isActive = path === selected;
    // 시각은 이 앱이 본 변경에만 있다 (`ts: 0` 은 git 이 준 바탕 — 언제인지 모른다).
    const when = change && change.ts > 0 ? new Date(change.ts).toTimeString().slice(0, 5) : "";
    return (
      <button
        type="button"
        key={path}
        className={"chg-item" + (nested ? " nested" : "")}
        data-path={path}
        aria-current={isActive ? "true" : undefined}
        onClick={() => onSelect(path)}
        title={path}
      >
        <span className="chg-r1">
          <span className="chg-name">
            {dir ? <span className="chg-dir">{dir}</span> : null}
            <span className="chg-base">{base}</span>
          </span>
        </span>
        <span className="chg-meta">{[when, t(OP_KEY[op])].filter(Boolean).join(" · ")}</span>
      </button>
    );
  };

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
            <i
              className="chg-dot"
              style={{ "--c": `var(--t-${kind.cssVar})` } as React.CSSProperties}
              role="img"
              aria-label={t(kind.labelKey)}
            />
            <span className="chg-ti">{cleanTitle(g.entry_title ?? "") || g.entry_path}</span>
            <span className="chg-count">{g.files.length}</span>
          </span>
          <span className="chg-meta">
            {when}
            {state === "command" ? <span className="chg-ok"> · ✓ {t("diff.evidence.command")}</span> : null}
            {state === "confirmed" ? <span className="chg-ok"> · ✓ {t("entry.verified")}</span> : null}
            {state === "missing" ? <span className="chg-warn"> · ! {t("journal.evidence.missing")}</span> : null}
          </span>
        </button>
        {isOpen ? g.files.map((p) => fileRow(p, true)) : null}
      </div>
    );
  };

  const recordedFiles = buckets.groups.reduce((n, g) => n + g.files.length, 0);

  return (
    <div className="chg-list" ref={listRef} role="region" aria-label={t("diff.changedFiles")}>
      {buckets.known ? (
        <>
          {buckets.unrecorded.length > 0 ? (
            <section aria-label={t("diff.unrecorded.label")}>
              <h3 className="chg-bh">
                <span className="chip sm warn">{t("diff.unrecorded.label")}</span>
                <span>{t("diff.fileCount", { n: buckets.unrecorded.length })}</span>
              </h3>
              {buckets.unrecorded.map((p) => fileRow(p, false))}
            </section>
          ) : null}
          {buckets.groups.length > 0 ? (
            <section aria-label={t("diff.recorded.label")}>
              <h3 className="chg-bh">
                <span className="chip sm outline">{t("diff.recorded.label")}</span>
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
          {[...changes].reverse().map((c) => fileRow(c.path, false))}
        </section>
      )}
    </div>
  );
}
