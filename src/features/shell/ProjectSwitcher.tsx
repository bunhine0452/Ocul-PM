/**
 * 사이드바 머리 — 프로젝트 이름 버튼(⌘O)과 최근 프로젝트 목록.
 *
 * 창 하나가 프로젝트 하나라(4.0) 목록에서 고르는 것은 **그 프로젝트의 창**을 여는
 * 것이다. 이미 다른 창에 열려 있으면 그 창이 앞으로 온다(I1). 이 창의 프로젝트는
 * 바뀌지 않는다(I3). 「폴더 열기…」는 폴더를 들여 새 창으로 연다.
 * 「VS Code 에서 열기」는 이 창의 프로젝트 폴더를 설정 「파일 열기」 의 편집기로 연다(2026-11-02).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { fileOpenApi } from "@/api/fileOpen";
import { projectsApi } from "@/api/projects";
import { windowApi } from "@/api/window";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { choiceOf } from "@/features/settings/EditorRow";
import { addProjectFromFolder } from "@/features/start/addFolder";
import { PROJECT_COLORS, projectColorOf } from "./projectColor";
import { PROJECT_SLOTS, byAttention, projectSlotLabel, projectSlotOf } from "./projectKeys";
import { TermsChip } from "@/features/terminal/TermsChip";
import { useTermOverview } from "@/features/terminal/status";
import { orderRecent } from "@/features/start/useRecentProjects";
import { ChevronDown } from "@/components/Icons";
import { useT } from "@/i18n";
import type { HomeBrief, Project, ProjectAttention } from "@/lib/bindings";
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
  // 목록 거르기 (2026-11-03) — 열면 바로 쳐서 이름 · 경로로 좁히고 ↩ 로 첫 줄을 연다.
  const [query, setQuery] = useState("");
  const [brief, setBrief] = useState<HomeBrief | null>(null);
  const [openWindows, setOpenWindows] = useState<number[]>([]);
  const [attention, setAttention] = useState<Map<number, ProjectAttention>>(new Map());
  const terms = useTermOverview(open);
  const editorCmd = useOptionalSettings()?.settings.externalEditorCommand ?? "auto";
  const [detected, setDetected] = useState<string | null>(null);
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
    if (choiceOf(editorCmd) === "auto") {
      void fileOpenApi
        .detectEditor()
        .then((d) => alive && setDetected(d))
        .catch(() => {});
    }
    void windowApi
      .openProjectIds()
      .then((ids) => alive && setOpenWindows(ids))
      .catch(() => {});
    const readAttention = () =>
      void windowApi
        .attention(projects.map((p) => p.id))
        .then((a) => alive && setAttention(a))
        .catch(() => {});
    readAttention();
    // 열려 있는 동안 다른 창의 Claude 가 기다리기 시작하면 줄이 따라 바뀐다.
    const off = windowApi.onAttentionChanged(readAttention);
    // 거르기 칸에 포커스 — 열자마자 치면 좁혀지고, ↓ 로 목록에 들어간다.
    setQuery("");
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLInputElement>(".proj-pop-find")?.focus());
    return () => {
      alive = false;
      void off.then((unlisten) => unlisten());
    };
  }, [open, projects, editorCmd]);

  // 열 때 프로젝트 목록도 다시 읽는다 — 다른 창에서 바꾼 색이 이 목록에 따라오게. `projects` 를 바꾸는
  // 일이라 위 효과(의존성에 `projects`)와 따로 둔다 — 같이 두면 다시 읽기가 끝없이 돈다.
  useEffect(() => {
    if (open) onProjectsChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ⌥⌘1~9 (Alt+1~9) — 목록을 열지 않고 그 번호의 프로젝트 창으로. 번호는 목록과 같은 최근 순서.
  // 캡처 단계 — ⌘숫자(화면 전환) 처리기보다 먼저, 터미널보다 먼저 받는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slot = projectSlotOf(e);
      if (slot == null) return;
      e.preventDefault();
      e.stopPropagation();
      void Promise.all([
        projectsApi.brief(1).catch(() => null),
        windowApi.attention(projects.map((p) => p.id)).catch(() => new Map<number, ProjectAttention>()),
      ]).then(([b, a]) => {
        // 목록과 같은 순서 — 기다리는 창이 ⌥⌘1 이다.
        const target = byAttention(orderRecent(projects, b), a)[slot];
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

  const current = projects.find((p) => p.id === currentProjectId);
  const currentRoot = current?.root_path ?? null;
  const currentColor = projectColorOf(current?.color);
  const pickColor = (color: string | null) => {
    if (currentProjectId == null) return;
    projectsApi
      .setColor(currentProjectId, color)
      .then((vscode) => {
        // VS Code 쪽은 조용히 — 주석이 있어 못 고쳤을 때만 말한다.
        if (vscode === "skipped") toast.info(t("sidebar.projectColorVscodeSkipped"));
      })
      // 앱의 색은 저장됐을 수 있다(VS Code 파일만 실패) — 목록은 늘 다시 읽는다.
      .catch((e) => toast.warning(t("sidebar.projectColorVscodeFailed", { error: String(e?.message ?? e) })))
      .finally(() => onProjectsChanged?.());
  };
  const editorName = EDITOR_NAMES[choiceOf(editorCmd) === "auto" ? (detected ?? "") : choiceOf(editorCmd)];
  const openInEditor = () => {
    close(false);
    if (!currentRoot) return;
    // 빈 상대 경로 = 프로젝트 폴더 그 자체 (`open_in_editor`). VS Code 는 `vscode://file/<폴더>` 를 새 창으로 연다.
    fileOpenApi
      .inExternalEditor(currentRoot, "", editorCmd, null)
      .catch((e) => toast.destructive(t("sidebar.openInEditorFailed", { error: String(e?.message ?? e) })));
  };

  const ordered = byAttention(orderRecent(projects, brief), attention);
  const q = query.trim().toLowerCase();
  // 번호 키(⌥⌘n)는 거르기 전 순서 그대로 — 좁혀도 같은 프로젝트는 같은 번호다.
  const shown = ordered
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !q || p.name.toLowerCase().includes(q) || p.root_path.toLowerCase().includes(q));
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
        {currentColor ? <span className="proj-dot" data-pc={currentColor} aria-hidden="true" /> : null}
        <span className="proj-name">{projectName ?? t("sidebar.selectProject")}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open ? (
        <div className="proj-pop" role="menu" aria-label={t("sidebar.switchProjectMenu")} ref={menuRef}>
          <input
            className="proj-pop-find"
            type="text"
            value={query}
            placeholder={t("sidebar.findProject")}
            aria-label={t("sidebar.findProject")}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              const first = shown[0]?.p;
              if (!first) return;
              e.preventDefault();
              close(false);
              if (first.id !== currentProjectId) onOpenProject(first.id);
            }}
          />
          {shown.length === 0 ? <p className="proj-pop-none">{t("sidebar.findProjectNone")}</p> : null}
          {shown.map(({ p, i }) => {
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
                <span className="proj-dot" data-pc={projectColorOf(p.color)} aria-hidden="true" />
                <span className="proj-pop-meta">
                  <span className="proj-pop-name">{p.name}</span>
                  <span className="proj-pop-path">{tildePath(p.root_path)}</span>
                </span>
                <AttentionChips attention={attention.get(p.id)} terms={terms.get(p.id)} />
                {isCurrent ? (
                  <span className="chip sm">{t("sidebar.currentProject")}</span>
                ) : elsewhere ? (
                  <span className="chip sm outline">{t("sidebar.openProject")}</span>
                ) : null}
                {i < PROJECT_SLOTS ? <kbd className="kbd proj-pop-key">{projectSlotLabel(i)}</kbd> : null}
              </button>
            );
          })}
          {currentProjectId != null ? (
            <div className="proj-colors" role="group" aria-label={t("sidebar.projectColor")}>
              <span className="proj-colors-label">{t("sidebar.projectColor")}</span>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!currentColor}
                aria-label={t("sidebar.projectColorNone")}
                title={t("sidebar.projectColorNone")}
                className="proj-swatch none"
                onClick={() => pickColor(null)}
              />
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="menuitemradio"
                  aria-checked={currentColor === c}
                  aria-label={t(`projectColor.${c}`)}
                  title={t(`projectColor.${c}`)}
                  className="proj-swatch"
                  data-pc={c}
                  onClick={() => pickColor(c)}
                />
              ))}
            </div>
          ) : null}
          {currentRoot ? (
            <button type="button" role="menuitem" className="proj-pop-add" onClick={openInEditor}>
              {editorName ? t("sidebar.openInEditor", { name: editorName }) : t("sidebar.openInEditorGeneric")}
            </button>
          ) : null}
          <button type="button" role="menuitem" className="proj-pop-add" onClick={() => void addFolder()}>
            {t("sidebar.addFolder")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 「자동」 이 찾은 것 · 고른 것의 이름. 없으면(기본 앱 · 직접 입력) 「편집기에서 열기」. */
const EDITOR_NAMES: Record<string, string> = { vscode: "VS Code", cursor: "Cursor" };

/**
 * 그 프로젝트가 나를 기다리는가 — 기다림(Claude 의 허락 · 입력 · 질문)이 있으면 그것 하나, 아니면 앱 안
 * 터미널 표시(`TermsChip`). 마지막 확인 명령이 실패했으면 그 옆에 하나 더.
 */
function AttentionChips({
  attention,
  terms,
}: {
  attention: ProjectAttention | undefined;
  terms: Parameters<typeof TermsChip>[0]["terms"];
}) {
  const { t } = useT();
  const waiting = Math.max(attention?.waiting ?? 0, terms?.waiting ?? 0);
  return (
    <>
      {waiting > 0 ? (
        <span className="chip sm warn" title={t("sidebar.waitingTitle")}>
          {t("sidebar.waiting", { n: waiting })}
        </span>
      ) : (
        <TermsChip terms={terms} />
      )}
      {attention?.failing ? (
        <span className="chip sm danger" title={t("sidebar.failingTitle")}>
          {t("sidebar.failing")}
        </span>
      ) : null}
    </>
  );
}
