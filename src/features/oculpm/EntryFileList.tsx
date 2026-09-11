import { forwardRef, useMemo, type RefObject } from "react";
import { Search, X } from "@/components/Icons";
import { useT } from "@/i18n";
import { splitPath } from "@/lib/filePath";
import { blocked } from "@/lib/blocked";
import type { mapFileOpToChangeOp } from "@/contexts/WorkspaceContext";

// 작업 일지 열람의 부록 — 변경된 파일 (2026-09-11 원장의 한 장 리디자인).
// 예전엔 왼쪽 칸 **맨 위**에서 절반까지 차지하며 서술을 접힌 곳으로 밀었다.
// 이제 본문 뒤에 온다: 서술이 먼저고 증거가 다음이다. 그래도 파일 사이를
// 오가는 일은 오른쪽 파일 바(앞뒤 · 메뉴 · j/k)가 맡으므로 여기까지 내려올
// 일은 "이 일지가 무엇을 건드렸나" 를 훑을 때뿐이다.

/** A row of the changed-file list: the entry's `files_touched` ∪ recorded diffs. */
export interface FileRow {
  path: string;
  op: ReturnType<typeof mapFileOpToChangeOp>;
  /** Whether a patch was recorded for this path (⇒ the row is selectable). */
  hasDiff: boolean;
  /** Short muted reason shown when there's no patch to open. */
  note: string | null;
}

/** Show the filter box only once the list is actually long. */
export const FILTER_FROM = 8;

/** 배지 순서 — 목록의 `.dstatus` 와 같은 글자·색. */
const OP_ORDER = ["M", "A", "D"] as const;

interface EntryFileListProps {
  rows: FileRow[];
  /** `rows` 를 필터로 좁힌 것. */
  shown: FileRow[];
  /** 앞쪽에서 접은 공통 디렉터리 (commonRoot). */
  root: string;
  filter: string;
  onFilter: (next: string) => void;
  filterRef: RefObject<HTMLInputElement | null>;
  activePath: string | null;
  onSelect: (path: string) => void;
}

export const EntryFileList = forwardRef<HTMLElement, EntryFileListProps>(function EntryFileList(
  { rows, shown, root, filter, onFilter, filterRef, activePath, onSelect },
  ref,
) {
  const { t } = useT();
  const opCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.op, (m.get(r.op) ?? 0) + 1);
    return OP_ORDER.filter((op) => m.has(op)).map((op) => [op, m.get(op) ?? 0] as const);
  }, [rows]);

  return (
    <section className="entry-appendix" ref={ref} aria-label={t("entry.filesChanged", { n: rows.length })}>
      <div className="entry-appendix-head">
        <span className="entry-appendix-title">{t("entry.filesChanged", { n: rows.length })}</span>
        <span className="entry-appendix-ops" aria-hidden="true">
          {opCounts.map(([op, n]) => (
            <span key={op}>
              <span className={"dstatus " + op}>{op}</span>
              {n}
            </span>
          ))}
        </span>
        {rows.length >= FILTER_FROM ? (
          <span className="search-box sm entry-filelist-filter">
            <Search size={13} />
            <input
              ref={filterRef}
              type="text"
              value={filter}
              onChange={(e) => onFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                if (filter) onFilter("");
                else e.currentTarget.blur();
              }}
              placeholder={t("entry.filterFiles")}
              aria-label={t("entry.filterFiles")}
              spellCheck={false}
            />
            {filter ? (
              <button
                type="button"
                className="entry-filelist-clear"
                onClick={() => onFilter("")}
                aria-label={t("entry.filterClear")}
              >
                <X size={11} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="entry-filelist">
        {shown.map((r) => {
          const { dir, base } = splitPath(r.path, root);
          return (
            <button
              key={r.path}
              type="button"
              onClick={() => r.hasDiff && onSelect(r.path)}
              {...blocked(r.hasDiff ? null : t("entry.blockedNoDiff"), r.path)}
              aria-current={activePath === r.path ? "true" : undefined}
              className={
                "dfile" + (activePath === r.path ? " active" : "") + (r.hasDiff ? "" : " muted")
              }
            >
              <span className={"dstatus " + r.op}>{r.op}</span>
              <span className="dfile-name">
                {dir ? <span className="dfile-dir">{dir}</span> : null}
                <span className="dfile-base">{base}</span>
              </span>
              {r.note ? <span className="dfile-note">{r.note}</span> : null}
            </button>
          );
        })}
        {shown.length === 0 ? <div className="entry-filelist-empty">{t("entry.noFileMatch")}</div> : null}
      </div>
    </section>
  );
});
