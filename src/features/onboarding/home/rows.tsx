/**
 * 레일(목록) 행들 — 프로젝트 / 색인 / 초안 / 명령.
 *
 * 공통 규약 3가지:
 *  1. **스트레치 오픈** — 행 전체가 클릭 영역이지만, 실제 인터랙티브 요소는
 *     작은 버튼 하나(`.home-open`)이고 그 `::after` 가 행을 덮는다. 행 전체를
 *     `<button>` 으로 감싸면 안의 ✎/🗑 이 중첩 인터랙티브(axe 위반)가 된다.
 *  2. **로빙 tabindex** — 커서 행만 `tabIndex=0`, 나머지는 `-1`. 프로젝트가
 *     50개여도 목록 전체의 탭 스톱은 1개다.
 *  3. **고정 폭 컬럼** — 내용 길이가 열 폭을 바꾸지 않아 스켈레톤→실물 전환에
 *     리플로우가 없다.
 */
import { useEffect, useRef, useState } from "react";

import { FolderOpen, Sparkles, Settings, Trash2, Clock } from "@/components/Icons";
import type { Project, ProjectBlueprint } from "@/lib/bindings";

import { Highlight, Mark, RowActions, Skel, Sparkline, TriggerKicker } from "./atoms";
import {
  initials,
  relativeTime,
  tildePath,
  type CommandRowT,
  type DraftRowT,
  type ProjectRowT,
} from "./homeModel";

/** 커서/포커스 배선 — 모든 행이 같은 형태로 받는다. */
export interface RowWiring {
  isCursor: boolean;
  /**
   * 이 행이 목록의 탭 스톱인가. 로빙 tabindex 의 핵심: 목록 전체에서 **정확히
   * 하나**가 true 여야 한다. 커서가 있으면 그 행, 아직 없으면(초기 상태)
   * 첫 행 — 둘 다 아니면 Tab 으로 목록에 진입할 방법이 사라진다.
   */
  tabbable: boolean;
  register: (id: string, el: HTMLElement | null) => void;
  onRowKeyDown: (e: React.KeyboardEvent) => void;
  onRowFocus: (id: string) => void;
  onRowPointerMove: (id: string) => void;
}

function wire(row: { id: string }, w: RowWiring) {
  return {
    ref: (el: HTMLElement | null) => w.register(row.id, el),
    tabIndex: w.tabbable ? 0 : -1,
    onKeyDown: w.onRowKeyDown,
    onFocus: () => w.onRowFocus(row.id),
    onMouseMove: () => w.onRowPointerMove(row.id),
  };
}

// ── 프로젝트 행 (56px) ──────────────────────────────────────────────────

export function ProjectRow({
  row,
  query,
  now,
  indexing,
  loading,
  wiring,
  onOpen,
  onRename,
  onDelete,
  index,
}: {
  row: ProjectRowT;
  query: string;
  now: number;
  indexing: boolean;
  loading: boolean;
  wiring: RowWiring;
  onOpen: (p: Project) => void;
  onRename: (p: Project) => void;
  onDelete: (p: Project) => void;
  index: number;
}) {
  const { project: p, snap } = row;
  const when = relativeTime(snap?.lastAt ?? null, now);
  const w = wire(row, wiring);

  return (
    <li
      className={"home-row home-in-row" + (wiring.isCursor ? " is-cursor" : "")}
      style={{ animationDelay: `${Math.min(index, 12) * 14}ms` }}
      onMouseMove={w.onMouseMove}
    >
      <Mark text={initials(p.name)} />

      <span className="min-w-0 flex flex-col gap-0.5 py-2">
        <span className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            ref={w.ref as (el: HTMLButtonElement | null) => void}
            tabIndex={w.tabIndex}
            onKeyDown={w.onKeyDown}
            onFocus={w.onFocus}
            onClick={() => onOpen(p)}
            className="home-open text-[14px] font-[650] text-[var(--text)] truncate text-left cursor-pointer bg-transparent border-0 p-0"
            aria-label={`${p.name} 열기 — 마지막 활동 ${when}`}
          >
            <Highlight text={p.name} query={query} />
          </button>
          {indexing && (
            <span className="home-kbd" role="status">
              인덱싱
            </span>
          )}
        </span>
        {snap?.lastTitle ? (
          <TriggerKicker type={snap.lastType} title={snap.lastTitle} />
        ) : (
          <span className="home-path">{tildePath(p.root_path)}</span>
        )}
      </span>

      <span className="home-row-spark">
        {loading && !snap ? <Skel w="100%" h={14} /> : snap && <Sparkline data={snap.spark} />}
      </span>

      <span className="home-when">{when}</span>

      <span className="home-row-actions flex justify-end">
        <RowActions
          name={p.name}
          onRename={() => onRename(p)}
          onDelete={() => onDelete(p)}
          tabbable={wiring.tabbable}
        />
      </span>
    </li>
  );
}

// ── 색인 행 (40px) — 2주 이상 조용한 프로젝트 ───────────────────────────

export function IndexRow({
  row,
  query,
  wiring,
  onOpen,
}: {
  row: ProjectRowT;
  query: string;
  wiring: RowWiring;
  onOpen: (p: Project) => void;
}) {
  const { project: p, snap } = row;
  const w = wire(row, wiring);
  const total = snap?.totalEntries ?? 0;

  return (
    <div
      className={"home-quiet-row" + (wiring.isCursor ? " is-cursor" : "")}
      onMouseMove={w.onMouseMove}
      style={{ position: "relative" }}
    >
      <button
        type="button"
        ref={w.ref as (el: HTMLButtonElement | null) => void}
        tabIndex={w.tabIndex}
        onKeyDown={w.onKeyDown}
        onFocus={w.onFocus}
        onClick={() => onOpen(p)}
        className="home-open home-quiet-name min-w-0 flex-1 text-left cursor-pointer bg-transparent border-0 p-0"
        aria-label={`${p.name} 열기 — 기록 ${total}건, 2주 이상 활동 없음`}
      >
        <Highlight text={p.name} query={query} />
      </button>
      <span className="home-path flex-1 min-w-0 hidden sm:block">{tildePath(p.root_path)}</span>
      <span className="text-[10.5px] font-mono text-[var(--text-3)] whitespace-nowrap">
        기록 {total}건
      </span>
    </div>
  );
}

// ── 초안 행 — 인라인 2단 확인 ───────────────────────────────────────────

/** 자동 취소까지의 시간 — 확인 상태로 방치되지 않게. */
const CONFIRM_TIMEOUT_MS = 3000;

export function DraftRow({
  row,
  wiring,
  onResume,
  onDiscard,
}: {
  row: DraftRowT;
  wiring: RowWiring;
  onResume: (bp: ProjectBlueprint) => void;
  onDiscard: (id: number) => void;
}) {
  const { bp } = row;
  const w = wire(row, wiring);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 확인 상태를 켜 두고 다른 데로 가버리면 계속 남아 있으므로 자동 취소.
  useEffect(() => {
    if (!confirming) return;
    timer.current = setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [confirming]);

  const name = bp.name || bp.idea_text?.slice(0, 20) || "새 프로젝트";

  return (
    <li
      className={"home-row home-in-row" + (wiring.isCursor ? " is-cursor" : "")}
      onMouseMove={w.onMouseMove}
      style={{ gridTemplateColumns: "26px minmax(0,1fr) auto" }}
    >
      <Mark text="✎" />
      <span className="min-w-0 flex flex-col gap-0.5 py-2">
        <button
          type="button"
          ref={w.ref as (el: HTMLButtonElement | null) => void}
          tabIndex={w.tabIndex}
          onKeyDown={w.onKeyDown}
          onFocus={w.onFocus}
          onClick={() => onResume(bp)}
          className="home-open text-[14px] font-[650] text-[var(--text)] truncate text-left cursor-pointer bg-transparent border-0 p-0"
          aria-label={`${name} 초안 이어서 만들기 — ${row.stepLabel} 단계`}
        >
          {name}
        </button>
        <span className="text-[11px] text-[var(--text-2)]">{row.stepLabel} 단계에서 멈춤</span>
      </span>

      <span className="home-above flex items-center gap-1.5 justify-end min-w-[168px]">
        {confirming ? (
          <>
            <span className="text-[11px] text-[var(--text-2)]">정말 버릴까요?</span>
            <button
              type="button"
              className="home-chipbtn home-chipbtn--danger"
              onClick={(e) => {
                e.stopPropagation();
                onDiscard(bp.id);
              }}
            >
              예
            </button>
            <button
              type="button"
              className="home-chipbtn"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
              }}
            >
              아니오
            </button>
          </>
        ) : (
          <button
            type="button"
            className="home-iconbtn home-iconbtn--danger"
            aria-label={`${name} 초안 버리기`}
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
    </li>
  );
}

// ── 명령 행 ─────────────────────────────────────────────────────────────

const CMD_ICON: Record<string, typeof FolderOpen> = {
  "cmd:add": FolderOpen,
  "cmd:new": Sparkles,
  "cmd:settings": Settings,
};

/**
 * 목록이 **절대 비지 않게** 하는 장치. 프로젝트가 0개거나 검색 결과가 0건이어도
 * 이 섹션이 남아 `⏎` 가 항상 무언가를 한다.
 */
export function CommandRow({
  row,
  wiring,
  index,
}: {
  row: CommandRowT;
  wiring: RowWiring;
  index: number;
}) {
  const w = wire(row, wiring);
  const Icon = CMD_ICON[row.id] ?? Clock;

  return (
    <li
      className={"home-row home-in-row" + (wiring.isCursor ? " is-cursor" : "")}
      style={{ animationDelay: `${Math.min(index, 12) * 14}ms`, gridTemplateColumns: "26px minmax(0,1fr) auto" }}
      onMouseMove={w.onMouseMove}
    >
      <span className="home-mark" aria-hidden="true">
        <Icon className="w-3.5 h-3.5" />
      </span>
      <button
        type="button"
        ref={w.ref as (el: HTMLButtonElement | null) => void}
        tabIndex={w.tabIndex}
        onKeyDown={w.onKeyDown}
        onFocus={w.onFocus}
        onClick={row.run}
        className="home-open text-[13.5px] font-[600] text-[var(--text)] text-left truncate cursor-pointer bg-transparent border-0 p-0"
      >
        {row.label}
      </button>
      <span className="home-kbd" aria-hidden="true">
        {row.hint}
      </span>
    </li>
  );
}

// ── 섹션 헤더 ───────────────────────────────────────────────────────────

export function HomeSection({ title, count }: { title: string; count?: number }) {
  return (
    <div className="home-sechead">
      <span>{title}</span>
      <span className="home-sechead-line" />
      {count !== undefined && <span className="home-sechead-n">{count}</span>}
    </div>
  );
}

