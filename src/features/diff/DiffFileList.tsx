import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckMark,
  ChevronDown,
  ChevronRight,
  GitBranchIcon,
  Search,
  TargetIcon,
  X,
} from "@/components/Icons";
import type { ChangeGroup, EntryType, ImpactReport } from "@/lib/bindings";
import type { ChangeOp, RecentChange } from "@/lib/recentChangesStore";
import { TRIGGER_META } from "@/features/oculpm/triggerMeta";
import { splitPath } from "@/lib/filePath";
import { useT } from "@/i18n";
import {
  AUTO_FOLD_FROM,
  buildGroupViews,
  groupKey,
  visiblePathsOf,
  type GroupView,
} from "./changeGroups";

// 변경 diff 왼쪽 pane — 변경된 파일 목록.
//
// 2026-08-20 도그푸딩: 작업 일지가 쌓이자 이 목록이 무너졌다. 그룹이 전부 펼친
// 채로 세로로 이어 붙어 스크롤이 끝없이 길어지고, 경로는 폭이 모자라 **끝에서**
// 잘려 정작 파일명이 사라졌으며(`src/contexts/WorkspaceCont…`), 제목엔 원문
// 마크다운(`**`, `#`)이 그대로 묻어 나왔다.
//
// 고친 축 넷:
//  1. 경로를 디렉터리 + 파일명으로 갈라, 좁아지면 **디렉터리부터** 줄인다.
//  2. 그룹을 접을 수 있게 하고, 셋 이상이면 처음부터 하나만 펼친다. 접힌
//     머리글은 파일 수와 검토 진행도를 대신 말해 준다.
//  3. 파일 필터 — 목록이 길어지면 스크롤 대신 이름으로 찾는다.
//  4. 머리글/바닥글을 스크롤에서 떼어내고(그룹 머리글은 sticky), 제목의
//     마크다운 마커를 걷어냈다.
//
// 파일 이동 키(j/k/f)는 표시 순서를 아는 이 컴포넌트가 소유한다. diff 본문
// 검색(`/`·n·N)은 DiffScreenV2 가 계속 가진다.

/** 이 개수부터 필터 상자를 띄운다 — 그 아래에선 눈으로 훑는 게 더 빠르다. */
const FILTER_FROM = 8;
/** 영향 받는 파일 목록에서 한 번에 그리는 최대 행. */
const IMPACT_LIMIT = 60;
/** 그룹 머리글에 붙이는 플랜 칩 최대 개수. */
const PLAN_CHIP_LIMIT = 2;

interface DiffFileListProps {
  /** 현재 baseline 의 변경 파일 전체 (op 조회용). */
  changes: RecentChange[];
  /** 일지별 그룹핑. `null` 이면 평면 목록으로 되돌아간다. */
  groups: ChangeGroup[] | null;
  selected: string | null;
  reviewedPaths: string[];
  impact: ImpactReport | null;
  onSelect: (path: string) => void;
  /** 일지 화면으로 점프 (그룹 제목 클릭). */
  onOpenEntry?: (relativePath: string) => void;
  /** 영향 받는 파일을 외부 에디터로 열기. */
  onOpenAffected: (path: string) => void;
}

export function DiffFileList({
  changes,
  groups,
  selected,
  reviewedPaths,
  impact,
  onSelect,
  onOpenEntry,
  onOpenAffected,
}: DiffFileListProps) {
  const { t } = useT();
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [impactOpen, setImpactOpen] = useState(true);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const opByPath = useMemo(() => {
    const m = new Map<string, ChangeOp>();
    for (const c of changes) m.set(c.path, c.op);
    return m;
  }, [changes]);
  const reviewedSet = useMemo(() => new Set(reviewedPaths), [reviewedPaths]);

  const views = useMemo(
    () => buildGroupViews({ groups, changes, filter, collapsed, reviewed: reviewedSet }),
    [groups, changes, filter, collapsed, reviewedSet],
  );
  const visiblePaths = useMemo(() => visiblePathsOf(views), [views]);

  // 그룹 구성이 바뀌면 접힘을 다시 잡는다. 셋 이상이면 하나만 펼친 채로 —
  // 지금 보고 있는 파일이 든 그룹, 없으면 가장 최근 일지(백엔드가 created_at
  // 내림차순으로 준다).
  const groupSig = groups ? groups.map((g) => groupKey(g)).join("\n") : "";
  useEffect(() => {
    if (!groups || groups.length <= AUTO_FOLD_FROM) {
      setCollapsed(new Set<string>());
      return;
    }
    const sel = selectedRef.current;
    const open = (sel ? groups.find((g) => g.files.includes(sel)) : undefined) ?? groups[0];
    setCollapsed(new Set(groups.filter((g) => g !== open).map(groupKey)));
    // groupSig 로만 재실행한다 — `groups` 는 매 fetch 마다 새 배열이라 그걸
    // 의존성으로 두면 사용자가 편 그룹을 곧바로 되접는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSig]);

  // 선택이 접힌 그룹으로 넘어가면(일지 카드 → diff 핸드오프 등) 그 그룹을 편다.
  // 활성 그룹을 사용자가 직접 접는 건 그대로 존중된다 — 이 효과는 선택이
  // 바뀔 때만 돈다.
  useEffect(() => {
    if (!selected || !groups) return;
    const g = groups.find((x) => x.files.includes(selected));
    if (!g) return;
    const key = groupKey(g);
    setCollapsed((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, [selected, groups]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const foldable = views.filter((v) => !v.headerless);
  const allFolded = foldable.length > 0 && foldable.every((v) => v.collapsed);
  const toggleAll = useCallback(() => {
    setCollapsed(allFolded ? new Set<string>() : new Set(foldable.map((v) => v.key)));
  }, [allFolded, foldable]);

  // ── 키보드 (v2 U8) — j/k 파일 이동, f 필터 포커스 ────────────────────────
  // 순서는 화면에 보이는 그대로다: 접힌 그룹은 건너뛰고, 필터가 걸려 있으면
  // 남은 행만 오간다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        if (visiblePaths.length === 0) return;
        const cur = selected ? visiblePaths.indexOf(selected) : -1;
        const next =
          e.key === "j"
            ? Math.min(cur + 1, visiblePaths.length - 1)
            : Math.max(cur - 1, 0);
        onSelect(visiblePaths[next]);
      } else if (e.key === "f" && filterRef.current) {
        e.preventDefault();
        filterRef.current.focus();
        filterRef.current.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visiblePaths, selected, onSelect]);

  // 키보드 이동 시 활성 행이 목록 뷰포트를 벗어나지 않게.
  useEffect(() => {
    if (!selected) return;
    bodyRef.current?.querySelector(".dfile.active")?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const renderFile = (path: string) => {
    const op: ChangeOp = opByPath.get(path) ?? "M";
    const { dir, base } = splitPath(path, "", 3);
    const isActive = path === selected;
    return (
      <button
        type="button"
        key={path}
        className={"dfile" + (isActive ? " active" : "")}
        onClick={() => onSelect(path)}
        title={path}
        aria-current={isActive ? "true" : undefined}
      >
        <span className={"dstatus " + op}>{op}</span>
        <span className="dfile-name">
          {dir ? <span className="dfile-dir">{dir}</span> : null}
          <span className="dfile-base">{base}</span>
        </span>
        {reviewedSet.has(path) ? (
          <span className="dfile-read" title={t("diff.reviewed")}>
            <CheckMark size={12} />
          </span>
        ) : null}
      </button>
    );
  };

  const totalFiles = changes.length;
  const noMatch = filter.trim() !== "" && visiblePaths.length === 0;

  return (
    <div className="diff-files">
      <div className="diff-files-head dfl-head">
        <span className="dfl-title">{t("diff.changedFiles")}</span>
        <span className="dfl-count">{totalFiles}</span>
        {foldable.length > 1 ? (
          <button
            type="button"
            className="dfl-foldall"
            onClick={toggleAll}
            title={allFolded ? t("diff.unfoldAll") : t("diff.foldAll")}
          >
            {allFolded ? t("diff.unfoldAll") : t("diff.foldAll")}
          </button>
        ) : null}
      </div>

      {totalFiles >= FILTER_FROM ? (
        <div className="dfl-filter">
          <Search size={12} />
          <input
            ref={filterRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              if (filter) setFilter("");
              else e.currentTarget.blur();
            }}
            placeholder={t("entry.filterFiles")}
            aria-label={t("entry.filterFiles")}
            spellCheck={false}
          />
          {filter ? (
            <button
              type="button"
              className="dfl-filter-clear"
              onClick={() => setFilter("")}
              aria-label={t("entry.filterClear")}
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="dfl-body" ref={bodyRef}>
        {views.map((v) =>
          v.headerless ? (
            <div className="diff-group" key={v.key}>
              {v.files.map(renderFile)}
            </div>
          ) : (
            <GroupSection
              key={v.key}
              view={v}
              onToggle={toggleGroup}
              onOpenEntry={onOpenEntry}
              renderFile={renderFile}
            />
          ),
        )}
        {noMatch ? <div className="dfl-empty">{t("entry.noFileMatch")}</div> : null}

        {impact && impact.affected.length > 0 ? (
          <div className="dfl-impact">
            <button
              type="button"
              className="dfl-impact-head"
              onClick={() => setImpactOpen((o) => !o)}
              aria-expanded={impactOpen}
              title={t("diff.impactTitle")}
            >
              {impactOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <GitBranchIcon size={11} />
              {t("diff.impact")}
              <span className="dfl-count">{impact.affected.length}</span>
            </button>
            {impactOpen ? (
              <div className="dfl-impact-list">
                {impact.affected.slice(0, IMPACT_LIMIT).map((n) => {
                  const { dir, base } = splitPath(n.path, "", 3);
                  return (
                    <button
                      key={n.file_id}
                      type="button"
                      className="dfile"
                      onClick={() => onOpenAffected(n.path)}
                      title={t("diff.impactHop", { path: n.path, n: n.depth })}
                    >
                      <span className={"dstatus hop" + (n.depth === 1 ? " near" : "")}>
                        {n.depth}
                      </span>
                      <span className="dfile-name">
                        {dir ? <span className="dfile-dir">{dir}</span> : null}
                        <span className="dfile-base">{base}</span>
                      </span>
                    </button>
                  );
                })}
                {impact.affected.length > IMPACT_LIMIT ? (
                  <span className="dfl-impact-more">
                    {t("diff.impactMore", { n: impact.affected.length - IMPACT_LIMIT })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="dfl-foot" aria-hidden="true">
        <kbd>j</kbd>
        <kbd>k</kbd> {t("diff.navHint")}
        {totalFiles >= FILTER_FROM ? (
          <>
            <kbd>f</kbd> {t("diff.filterHint")}
          </>
        ) : null}
        <kbd>/</kbd> {t("diff.searchHint")}
      </div>
    </div>
  );
}

/** 일지 하나 = 접히는 구획. 머리글은 스크롤 중에도 위에 붙어 있는다. */
function GroupSection({
  view,
  onToggle,
  onOpenEntry,
  renderFile,
}: {
  view: GroupView;
  onToggle: (key: string) => void;
  onOpenEntry?: (relativePath: string) => void;
  renderFile: (path: string) => React.ReactNode;
}) {
  const { t } = useT();
  const meta = view.entryType
    ? TRIGGER_META[view.entryType as EntryType] ?? null
    : null;
  const TypeIcon = meta?.icon;
  const label = view.title || view.entryPath || t("diff.untracked");
  const done = view.reviewed === view.total && view.total > 0;

  return (
    <div className={"diff-group" + (view.collapsed ? " folded" : "")}>
      <div className="diff-group-head">
        <button
          type="button"
          className="dfl-fold"
          onClick={() => onToggle(view.key)}
          aria-expanded={!view.collapsed}
          aria-label={t("diff.groupToggle")}
          title={t("diff.groupToggle")}
        >
          {view.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        {TypeIcon ? (
          <span className={"dfl-type " + meta!.cls} aria-hidden="true">
            <TypeIcon size={11} strokeWidth={2.2} />
          </span>
        ) : null}
        {view.entryPath ? (
          <button
            type="button"
            className="diff-group-title"
            onClick={() => onOpenEntry?.(view.entryPath!)}
            disabled={!onOpenEntry}
            title={label}
          >
            {label}
          </button>
        ) : (
          <span className="diff-group-title muted" title={label}>
            {label}
          </span>
        )}
        <span
          className={"dfl-progress" + (done ? " done" : "")}
          title={t("diff.groupProgress", { done: view.reviewed, total: view.total })}
        >
          {done ? <CheckMark size={10} /> : null}
          {view.reviewed > 0 && !done ? `${view.reviewed}/${view.total}` : view.total}
        </span>
        {view.date ? <span className="diff-group-time">{view.date}</span> : null}
      </div>

      {view.collapsed ? null : (
        <>
          {view.plans.length > 0 ? (
            <div className="diff-group-plans">
              {view.plans.slice(0, PLAN_CHIP_LIMIT).map((p) => (
                <span
                  className="tag"
                  key={p.planId}
                  title={
                    p.items.length > 1
                      ? `${p.title}\n· ${p.items.join("\n· ")}`
                      : `${p.title} · ${p.items[0]}`
                  }
                >
                  <TargetIcon size={10} />
                  <span className="dfl-plan-title">{p.title}</span>
                  {p.items.length > 1 ? (
                    <span className="dfl-plan-n">·{p.items.length}</span>
                  ) : null}
                </span>
              ))}
              {view.plans.length > PLAN_CHIP_LIMIT ? (
                <span className="tag" title={view.plans.map((p) => p.title).join("\n")}>
                  +{view.plans.length - PLAN_CHIP_LIMIT}
                </span>
              ) : null}
            </div>
          ) : null}
          {view.files.map(renderFile)}
        </>
      )}
    </div>
  );
}
