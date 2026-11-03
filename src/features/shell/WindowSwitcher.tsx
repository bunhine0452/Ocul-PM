/**
 * 창 전환기 (2026-11-04) — 여러 프로젝트 창 사이를 Alt-Tab 손버릇으로.
 *
 * macOS ⌥Tab · Windows·Linux Ctrl+` 를 **누르고 있는 동안** 열린 프로젝트 창이 최근에 쓴 순서로 서고,
 * Tab(⇧Tab)으로 고른 뒤 손을 떼면 그 창이 앞으로 온다. 한 번 톡 누르면 직전 창이다 — 목록이 뜨기 전에 손을
 * 떼면 목록 없이 바로 간다. 순서는 백엔드 창 레지스트리의 포커스 기록(`recent_window_projects`).
 *
 * 키는 창(window)의 캡처 단계에서 받는다 — 터미널(xterm)이 포커스를 쥐고 있어도 먼저 본다. ⌘` 은 macOS 가
 * 만든 순서로 창을 돌 뿐이라 최근 순이 아니었고, ⌥⌘1~9 는 목록 순서(기다림이 앞)라 번호가 자꾸 바뀌었다.
 */
import { useEffect, useRef, useState } from "react";

import { windowApi } from "@/api/window";
import { useT } from "@/i18n";
import { kbd } from "@/lib/kbd";
import { isMac } from "@/lib/platform";
import { tildePath } from "@/lib/osPath";
import { toast } from "@/lib/toast";
import type { Project, ProjectAttention } from "@/lib/bindings";
import { projectColorOf } from "./projectColor";

/** 목록을 띄우기까지 — 이보다 빨리 손을 떼면 목록 없이 직전 창으로 간다(⌘Tab 과 같은 손맛). */
const SHOW_AFTER_MS = 140;

type Phase = "idle" | "loading" | "open";

interface Machine {
  phase: Phase;
  list: number[];
  index: number;
  /** 목록이 오기 전에 더 누른 Tab 수(⇧Tab 은 음수). */
  pending: number;
  /** 목록이 오기 전에 손을 뗐다 — 오면 곧장 그 창으로. */
  released: boolean;
}

const IDLE: Machine = { phase: "idle", list: [], index: 0, pending: 0, released: false };

/** 전환기를 부르는 키인가 — macOS ⌥Tab, 그 밖 Ctrl+`. */
export function isSwitchKey(e: Pick<KeyboardEvent, "code" | "altKey" | "ctrlKey" | "metaKey">): boolean {
  if (isMac()) return e.code === "Tab" && e.altKey && !e.metaKey && !e.ctrlKey;
  return e.code === "Backquote" && e.ctrlKey && !e.altKey && !e.metaKey;
}

/** 손을 뗀 키가 전환기를 붙들던 수식키인가. */
function isHoldRelease(e: KeyboardEvent): boolean {
  return isMac() ? e.key === "Alt" : e.key === "Control";
}

/** 최근 순 목록에서 처음 고를 줄 — 지금 창(맨 앞) 다음, ⇧ 면 맨 끝. 창이 하나면 그것. */
export function firstPick(n: number, dir: number): number {
  if (n <= 1) return 0;
  return dir < 0 ? n - 1 : 1;
}

export function WindowSwitcher({ currentProjectId, projects }: { currentProjectId: number | null; projects: Project[] }) {
  const { t } = useT();
  const m = useRef<Machine>(IDLE);
  const [view, setView] = useState<{ list: number[]; index: number } | null>(null);
  const [attention, setAttention] = useState<Map<number, ProjectAttention>>(new Map());
  const showTimer = useRef<number | undefined>(undefined);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  useEffect(() => {
    const reset = () => {
      window.clearTimeout(showTimer.current);
      m.current = IDLE;
      setView(null);
    };
    const go = (projectId: number | undefined) => {
      reset();
      if (projectId == null || projectId === currentProjectId) return;
      windowApi.openProjectWindow(projectId).catch((e) => toast.destructive(t("switcher.failed", { error: String(e?.message ?? e) })));
    };
    const step = (dir: number) => {
      const s = m.current;
      const n = s.list.length;
      if (n === 0) return;
      s.index = (((s.index + dir) % n) + n) % n;
      setView((v) => (v ? { list: s.list, index: s.index } : v));
    };
    const open = async (dir: number) => {
      m.current = { ...IDLE, phase: "loading" };
      const ids = await windowApi.recentProjects().catch((): number[] => []);
      const s = m.current;
      if (s.phase !== "loading") return; // 그 사이 취소됐다
      // 모르는 프로젝트(목록이 아직 안 읽힌 새 창)는 빼고, 지금 창은 늘 맨 앞.
      const known = new Set(projectsRef.current.map((p) => p.id));
      let list = ids.filter((id) => known.has(id));
      if (currentProjectId != null) list = [currentProjectId, ...list.filter((id) => id !== currentProjectId)];
      s.list = list;
      s.index = firstPick(list.length, dir);
      if (s.pending) step(s.pending);
      if (s.released) {
        go(list[s.index]);
        return;
      }
      s.phase = "open";
      windowApi.attention(list).then(setAttention).catch(() => {});
      showTimer.current = window.setTimeout(() => {
        if (m.current.phase === "open") setView({ list: m.current.list, index: m.current.index });
      }, SHOW_AFTER_MS);
    };

    const onDown = (e: KeyboardEvent) => {
      const s = m.current;
      if (isSwitchKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        const dir = e.shiftKey ? -1 : 1;
        if (s.phase === "idle") void open(dir);
        else if (s.phase === "loading") s.pending += dir;
        else step(dir);
        return;
      }
      if (s.phase === "idle") return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        reset();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        go(s.list[s.index]);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        step(e.key === "ArrowDown" ? 1 : -1);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const s = m.current;
      if (s.phase === "idle" || !isHoldRelease(e)) return;
      if (s.phase === "loading") s.released = true;
      else go(s.list[s.index]);
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", reset);
      window.clearTimeout(showTimer.current);
    };
  }, [currentProjectId, t]);

  if (!view) return null;
  const byId = new Map(projects.map((p) => [p.id, p] as const));
  const hold = isMac() ? kbd("⌥") : "Ctrl";
  const pick = (index: number) => {
    const id = view.list[index];
    window.clearTimeout(showTimer.current);
    m.current = IDLE;
    setView(null);
    if (id != null && id !== currentProjectId) {
      windowApi.openProjectWindow(id).catch((e) => toast.destructive(t("switcher.failed", { error: String(e?.message ?? e) })));
    }
  };
  return (
    <div className="win-switch-scrim" onMouseDown={(e) => e.target === e.currentTarget && pick(-1)}>
      <div className="win-switch" role="listbox" aria-label={t("switcher.title")} aria-activedescendant={`win-switch-${view.index}`}>
        <div className="win-switch-head">
          <span className="win-switch-title">{t("switcher.title")}</span>
          <span className="win-switch-hint">{t("switcher.hint", { hold, prev: kbd("⇧Tab") })}</span>
        </div>
        {view.list.length <= 1 ? <p className="win-switch-alone">{t("switcher.alone", { open: kbd("⌘O") })}</p> : null}
        <ul className="win-switch-list">
          {view.list.map((id, i) => {
            const p = byId.get(id);
            if (!p) return null;
            const a = attention.get(id);
            return (
              <li
                key={id}
                id={`win-switch-${i}`}
                role="option"
                aria-selected={i === view.index}
                className="win-switch-row"
                onMouseEnter={() => {
                  m.current.index = i;
                  setView({ list: view.list, index: i });
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
              >
                <span className="proj-dot" data-pc={projectColorOf(p.color)} aria-hidden="true" />
                <span className="win-switch-name">
                  <span className="win-switch-nm">{p.name}</span>
                  <span className="win-switch-path">{tildePath(p.root_path)}</span>
                </span>
                {a?.waiting ? <span className="chip sm warn">{t("sidebar.waiting", { n: a.waiting })}</span> : null}
                {a?.failing ? <span className="chip sm danger">{t("sidebar.failing")}</span> : null}
                {id === currentProjectId ? <span className="win-switch-here">{t("switcher.here")}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
