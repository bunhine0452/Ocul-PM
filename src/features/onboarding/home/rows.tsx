/**
 * 바닥 띠의 행들 — 초안 / 명령.
 *
 * 프로젝트 행·조용한 색인 행·섹션 헤더는 2026-08-12 대격변에서 제거됐다:
 * 프로젝트는 전부 같은 크기의 `ProjectCard` 격자에 그려지고, 초안·명령만
 * 바닥에 한 줄로 남는다.
 *
 * 공통 규약 2가지:
 *  1. **로빙 tabindex** — 커서 행만 `tabIndex=0`, 나머지는 `-1`. 항목이 몇
 *     개든 목록 전체의 탭 스톱은 1개다.
 *  2. 행 전체를 `<button>` 으로 감싸지 않는다 — 안의 아이콘 버튼이 중첩
 *     인터랙티브(axe 위반)가 되기 때문이다.
 */
import { useEffect, useRef, useState } from "react";

import { FolderOpen, FolderPlus, Settings, Trash2, Clock } from "@/components/Icons";
import type { ProjectBlueprint } from "@/lib/bindings";

import { Mark } from "./atoms";
import { useT } from "@/i18n";
import { type CommandRowT, type DraftRowT } from "./homeModel";

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
  const { t } = useT();
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

  const name = bp.name || bp.idea_text?.slice(0, 20) || t("home.newProjectFallback");

  return (
    <li
      className={"home-row home-in-row" + (wiring.isCursor ? " is-cursor" : "")}
      onMouseMove={w.onMouseMove}
      style={{ gridTemplateColumns: "26px minmax(0,1fr) auto" }}
    >
      <Mark text="✎" />
      <span className="home-drafttext min-w-0 flex flex-col gap-0.5 py-2">
        <button
          type="button"
          ref={w.ref as (el: HTMLButtonElement | null) => void}
          tabIndex={w.tabIndex}
          onKeyDown={w.onKeyDown}
          onFocus={w.onFocus}
          onClick={() => onResume(bp)}
          className="home-open text-[14px] font-[650] text-[var(--text)] truncate text-left cursor-pointer bg-transparent border-0 p-0"
          aria-label={t("home.draftResumeAria", { name, step: row.stepLabel })}
        >
          {name}
        </button>
        <span className="text-[11px] text-[var(--text-2)]">{t("home.draftStoppedAt", { step: row.stepLabel })}</span>
      </span>

      <span className="home-above flex items-center gap-1.5 justify-end min-w-[168px]">
        {confirming ? (
          <>
            <span className="text-[11px] text-[var(--text-2)]">{t("home.discardConfirm")}</span>
            <button
              type="button"
              className="home-chipbtn home-chipbtn--danger"
              onClick={(e) => {
                e.stopPropagation();
                onDiscard(bp.id);
              }}
            >
              {t("home.yes")}
            </button>
            <button
              type="button"
              className="home-chipbtn"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
              }}
            >
              {t("home.no")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="home-iconbtn home-iconbtn--danger"
            aria-label={t("home.draftDiscardAria", { name })}
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
  "cmd:new": FolderPlus,
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
