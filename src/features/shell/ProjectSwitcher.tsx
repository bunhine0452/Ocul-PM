/**
 * 사이드바 머리 — 프로젝트 이름 버튼(⌘O)과 최근 프로젝트 목록.
 *
 * 창 하나가 프로젝트 하나라(4.0) 목록에서 고르는 것은 **그 프로젝트의 창**을 여는
 * 것이다. 이미 다른 창에 열려 있으면 그 창이 앞으로 온다(I1). 이 창의 프로젝트는
 * 바뀌지 않는다(I3). 「폴더 열기…」는 폴더를 들여 새 창으로 연다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { projectsApi } from "@/api/projects";
import { windowApi } from "@/api/window";
import { addProjectFromFolder } from "@/features/start/addFolder";
import { PROJECT_SLOTS, projectSlotLabel, projectSlotOf } from "./projectKeys";
import { TermsChip } from "@/features/terminal/TermsChip";
import { useTermOverview } from "@/features/terminal/status";
import { orderRecent } from "@/features/start/useRecentProjects";
import { ChevronDown } from "@/components/Icons";
import { useT } from "@/i18n";
import type { HomeBrief, Project } from "@/lib/bindings";
import { NAV_BUS } from "@/lib/navRegistry";
import { tildePath } from "@/lib/osPath";
import { kbd } from "@/lib/kbd";
import { toast } from "@/lib/toast";

interface ProjectSwitcherProps {
  projectName: string | null;
  currentProjectId: number | null;
  projects: Project[];
  /** 다른 프로젝트의 창을 연다 (이미 열려 있으면 그 창이 앞으로). */
  onOpenProject: (projectId: number) => void;
  /** 폴더를 새로 들였다 — 창의 목록을 다시 읽게 한다. */
  onProjectsChanged?: () => void;
}

export function ProjectSwitcher({
  projectName,
  currentProjectId,
  projects,
  onOpenProject,
  onProjectsChanged,
}: ProjectSwitcherProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<HomeBrief | null>(null);
  const [openWindows, setOpenWindows] = useState<number[]>([]);
  const terms = useTermOverview(open);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ⌘O (useGlobalShortcuts) · 팔레트 → 목록 열기.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(NAV_BUS.openProjectSwitcher, onOpen);
    return () => window.removeEventListener(NAV_BUS.openProjectSwitcher, onOpen);
  }, []);

  // 열 때마다 최근 순서와 「열림」을 새로 읽는다 — 다른 창의 일은 이 창에 오지 않는다.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void projectsApi
      .brief(1)
      .then((b) => alive && setBrief(b))
      .catch(() => {});
    void windowApi
      .openProjectIds()
      .then((ids) => alive && setOpenWindows(ids))
      .catch(() => {});
    // 첫 항목에 포커스 — 키보드로 연 사람이 바로 고를 수 있게.
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    return () => {
      alive = false;
    };
  }, [open]);

  // ⌥⌘1~9 (Alt+1~9) — 목록을 열지 않고 그 번호의 프로젝트 창으로. 번호는 목록과 같은 최근 순서.
  // 캡처 단계 — ⌘숫자(화면 전환) 처리기보다 먼저, 터미널보다 먼저 받는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slot = projectSlotOf(e);
      if (slot == null) return;
      e.preventDefault();
      e.stopPropagation();
      void projectsApi
        .brief(1)
        .catch(() => null)
        .then((b) => {
          const target = orderRecent(projects, b)[slot];
          if (target && target.id !== currentProjectId) onOpenProject(target.id);
        });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projects, currentProjectId, onOpenProject]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // 바깥 클릭 · Esc 로 닫는다. ↑↓ 로 항목 사이를 옮긴다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      if (items.length === 0) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const addFolder = async () => {
    close(false);
    const result = await addProjectFromFolder();
    if (result.kind === "cancelled") return;
    if (result.kind === "error") {
      toast.destructive(result.message);
      return;
    }
    onProjectsChanged?.();
    onOpenProject(result.project.id);
  };

  const ordered = orderRecent(projects, brief);
  const shortcut = kbd("⌘O");

  return (
    <div className="proj-switch-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="proj-switch"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("sidebar.switchProjectAria", { name: projectName ?? "" })}
        title={t("sidebar.switchProjectTitle", { key: shortcut })}
      >
        <span className="proj-name">{projectName ?? t("sidebar.selectProject")}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open ? (
        <div className="proj-pop" role="menu" aria-label={t("sidebar.switchProjectMenu")} ref={menuRef}>
          {ordered.map((p, i) => {
            const isCurrent = p.id === currentProjectId;
            const elsewhere = !isCurrent && openWindows.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                aria-current={isCurrent ? "true" : undefined}
                className={"proj-pop-item" + (isCurrent ? " on" : "")}
                onClick={() => {
                  close(false);
                  if (!isCurrent) onOpenProject(p.id);
                }}
              >
                <span className="proj-pop-meta">
                  <span className="proj-pop-name">{p.name}</span>
                  <span className="proj-pop-path">{tildePath(p.root_path)}</span>
                </span>
                <TermsChip terms={terms.get(p.id)} />
                {isCurrent ? (
                  <span className="chip sm">{t("sidebar.currentProject")}</span>
                ) : elsewhere ? (
                  <span className="chip sm outline">{t("sidebar.openProject")}</span>
                ) : null}
                {i < PROJECT_SLOTS ? <kbd className="kbd proj-pop-key">{projectSlotLabel(i)}</kbd> : null}
              </button>
            );
          })}
          <button type="button" role="menuitem" className="proj-pop-add" onClick={() => void addFolder()}>
            {t("sidebar.addFolder")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
