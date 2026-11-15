/**
 * 윗줄 머리 — 프로젝트 이름 버튼(⌘O)과 최근 프로젝트 목록.
 *
 * 창 하나가 프로젝트 하나라(4.0) 목록에서 고르는 것은 **그 프로젝트의 창**을 여는
 * 것이다. 이미 다른 창에 열려 있으면 그 창이 앞으로 온다(I1). 이 창의 프로젝트는
 * 바뀌지 않는다(I3). 「폴더 열기…」는 폴더를 들여 새 창으로 연다.
 * 「VS Code 에서 열기」는 이 창의 프로젝트 폴더를 설정 「파일 열기」 의 편집기로 연다(2026-11-02).
 *
 * 11-15: 거르기 칸이 콤보박스, 목록이 리스트박스다. 포커스는 칸에 머물고 ↑↓ 는 프로젝트 줄만 옮긴다(예전엔
 * 색 견본 · 창 정리 칸까지 돌았다). ↩ 가 열 줄은 늘 면(--bg-active)으로 보인다. 아래 묶음(색 · 동작)은 Tab 으로
 * 들어가 화살표로 돈다.
 * 줄은 `ProjectRow` 한 벌 — 시작 창 · ⌥Tab · ⌘K 와 같은 칩을 단다.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { projectsApi } from "@/api/projects";
import { windowApi } from "@/api/window";
import { TileChoices } from "./TileChoices";
import { useOpenInEditor } from "./useOpenInEditor";
import { addProjectFromFolder } from "@/features/start/addFolder";
import { PROJECT_COLORS, projectColorOf } from "./projectColor";
import { byAttention, projectSlotLabel, projectSlotOf, slotsOf } from "./projectKeys";
import { HereMark, ProjectRow, distinctWhere } from "./ProjectRow";
import { useTermOverview } from "@/features/terminal/status";
import { orderRecent } from "@/features/start/useRecentProjects";
import { ChevronDown, Code2, FolderPlus, SearchIcon } from "@/components/Icons";
import { useT } from "@/i18n";
import type { HomeBrief, Project, ProjectAttention } from "@/lib/bindings";
import { NAV_BUS } from "@/lib/navRegistry";
import { isImeComposing } from "@/lib/ime";
import { isModalOpen, kbd } from "@/lib/kbd";
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

/** 목록을 여는 요청 — 팔레트의 「프로젝트 색 바꾸기」 는 색 칸에 포커스를 둔다(`detail.focus`). */
export interface OpenSwitcherDetail {
  focus?: "colors";
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
  // 목록 거르기 (2026-11-03) — 열면 바로 쳐서 이름 · 경로로 좁히고 ↩ 로 고른 줄을 연다.
  const [query, setQuery] = useState("");
  // 고른 줄은 자리가 아니라 **프로젝트**로 쥔다 — 연 동안 기다림이 바뀌거나 브리프가 늦게 와 줄 순서가 바뀌면,
  // 자리로 쥔 선택은 소리 없이 다른 프로젝트로 옮겨 갔다(↓↓ 로 c 를 골랐는데 d 가 맨 위로 오면 ↩ 가 b 를 열었다).
  // `null` 이면 맨 윗줄.
  const [activePid, setActivePid] = useState<number | null>(null);
  const [brief, setBrief] = useState<HomeBrief | null>(null);
  const [openWindows, setOpenWindows] = useState<number[]>([]);
  const [attention, setAttention] = useState<Map<number, ProjectAttention>>(new Map());
  const terms = useTermOverview(open);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const colorsRef = useRef<HTMLDivElement>(null);
  const focusColors = useRef(false);
  const listId = useId();

  // ⌘O (useGlobalShortcuts) · 팔레트 → 목록 열기.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const colors = (e as CustomEvent<OpenSwitcherDetail | null>).detail?.focus === "colors";
      // 이미 열려 있으면 여는 효과가 다시 돌지 않는다 — 색 칸으로 바로 간다.
      const swatch = colorsRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (colors && swatch) {
        swatch.focus();
        return;
      }
      focusColors.current = colors;
      setOpen(true);
    };
    window.addEventListener(NAV_BUS.openProjectSwitcher, onOpen);
    return () => window.removeEventListener(NAV_BUS.openProjectSwitcher, onOpen);
  }, []);

  // 열림 전이에서만 — 거르기를 비우고 칸에 포커스, 최근 순서와 「열림」을 새로 읽는다. 목록(`projects`)이
  // 새로 와도 다시 돌지 않는다: 연 채 다른 창의 색이 따라오면 친 글자가 지워지고 포커스가 튀었다(11-15).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setQuery("");
    setActivePid(null);
    void projectsApi
      .brief(1)
      .then((b) => alive && setBrief(b))
      .catch(() => {});
    void windowApi
      .openProjectIds()
      .then((ids) => alive && setOpenWindows(ids))
      .catch(() => {});
    const raf = requestAnimationFrame(() => {
      const swatch = focusColors.current
        ? colorsRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
        : null;
      focusColors.current = false;
      (swatch ?? inputRef.current)?.focus();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [open]);

  // 기다림 · 실패 — 프로젝트 **id** 가 바뀔 때만 다시 묻는다(내용이 같은 새 배열에는 묻지 않는다).
  // 열려 있는 동안 다른 창의 Claude 가 기다리기 시작하면 줄이 따라 바뀐다.
  const idsKey = projects.map((p) => p.id).join(",");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const ids = idsKey ? idsKey.split(",").map(Number) : [];
    const read = () =>
      void windowApi
        .attention(ids)
        .then((a) => alive && setAttention(a))
        .catch(() => {});
    read();
    const off = windowApi.onAttentionChanged(read);
    return () => {
      alive = false;
      void off.then((unlisten) => unlisten());
    };
  }, [open, idsKey]);

  // 열 때 프로젝트 목록도 다시 읽는다 — 다른 창에서 바꾼 색이 이 목록에 따라오게. `projects` 를 바꾸는
  // 일이라 위 효과와 따로 둔다 — 같이 두면 다시 읽기가 끝없이 돈다.
  useEffect(() => {
    if (open) onProjectsChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ⌥⌘1~9 (Alt+1~9) — 목록을 열지 않고 그 번호의 프로젝트 창으로. 번호는 최근 순, 지금 프로젝트는 건너뛴다
  // (`slotsOf`). 캡처 단계 — ⌘숫자(화면 전환) 처리기보다 먼저, 터미널보다 먼저 받는다. 모달이 떠 있으면 둔다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slot = projectSlotOf(e);
      if (slot == null || isModalOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      void projectsApi
        .brief(1)
        .catch(() => null)
        .then((b) => {
          const target = orderRecent(projects, b).filter((p) => p.id !== currentProjectId)[slot];
          if (target) onOpenProject(target.id);
        });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projects, currentProjectId, onOpenProject]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // 바깥 클릭 · Esc 로 닫는다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(true);
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
        // VS Code 쪽은 조용히 — 주석이 있어 못 고쳤을 때만 말한다. 바란 것이 안 됐으니 경고다(11-15).
        if (vscode === "skipped") toast.warning(t("sidebar.projectColorVscodeSkipped"));
      })
      // 앱의 색은 저장됐을 수 있다(VS Code 파일만 실패) — 목록은 늘 다시 읽는다.
      .catch((e) => toast.warning(t("sidebar.projectColorVscodeFailed", { error: String(e?.message ?? e) })))
      .finally(() => onProjectsChanged?.());
  };
  const editor = useOpenInEditor(currentRoot, open);
  const openInEditor = () => {
    close(false);
    // 빈 상대 경로 = 프로젝트 폴더 그 자체 (`open_in_editor`). VS Code · Cursor 는 명령줄 도구로 그 폴더의 창을 연다 — 이미 열려 있으면 그 창이 앞으로 온다.
    editor.open("");
  };

  // 창이 둘 이상이면 최근 창 n 개(2~6)를 칸으로 세운다 (11-04, `TileChoices` · `commands/window/tile.rs`).
  const tileWindows = (n: number) => {
    close(false);
    windowApi.tile(n).catch((e) => toast.warning(t("sidebar.tileWindowsFailed", { error: String(e?.message ?? e) })));
  };

  const recent = orderRecent(projects, brief);
  const slots = slotsOf(recent, currentProjectId);
  const where = distinctWhere(projects);
  const q = query.trim().toLowerCase();
  const shown = byAttention(recent, attention).filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.root_path.toLowerCase().includes(q),
  );
  // 고른 프로젝트가 걸러져 사라졌으면 맨 윗줄.
  const at = Math.max(0, shown.findIndex((p) => p.id === activePid));
  const optionId = (p: Project) => `${listId}-p${p.id}`;
  const shortcut = kbd("⌘O");

  // ↑↓ 로 옮긴 줄이 보이게 — 긴 목록에서 면이 칸 밖으로 나가지 않는다.
  const activeId = shown[at] ? optionId(shown[at]) : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const pick = (p: Project) => {
    close(false);
    if (p.id !== currentProjectId) onOpenProject(p.id);
  };

  const onFindKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 한글 조합 중의 ↩ · ↑↓ 는 조합의 몫이다.
    if (isImeComposing(e)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (shown.length === 0) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActivePid(shown[(at + step + shown.length) % shown.length].id);
      return;
    }
    if (e.key === "Enter") {
      const target = shown[at];
      if (!target) return;
      e.preventDefault();
      pick(target);
    }
  };

  // 아래 묶음(색 · 창 정리 · 편집기 · 폴더)은 메뉴다 — Tab 으로 들어오면 화살표가 그 안의 단추를 돈다. 칸의 ↑↓ 는
  // 프로젝트 줄만 옮기므로, 이것이 없으면 메뉴라고 말하면서 화살표가 먹지 않았다.
  const onFootKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const from = items.indexOf(document.activeElement as HTMLButtonElement);
    if (from < 0) return;
    e.preventDefault();
    items[(from + step + items.length) % items.length].focus();
  };

  return (
    <div className="proj-switch-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="proj-switch"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("sidebar.switchProjectAria", { name: projectName ?? "" })}
        title={t("sidebar.switchProjectTitle", { key: shortcut })}
      >
        {currentColor ? <span className="proj-dot" data-pc={currentColor} aria-hidden="true" /> : null}
        <span className="proj-name">{projectName ?? t("sidebar.selectProject")}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open ? (
        <div className="proj-pop" role="dialog" aria-label={t("sidebar.switchProjectMenu")}>
          {/* 찾기 — 테 없는 한 줄. 열면 바로 친다. */}
          <div className="proj-pop-search">
            <SearchIcon size={15} strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={inputRef}
              className="proj-pop-find"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              value={query}
              placeholder={t("sidebar.findProject")}
              aria-label={t("sidebar.findProject")}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setActivePid(null);
              }}
              onKeyDown={onFindKey}
            />
          </div>
          {/* 맞는 것이 없다는 말은 목록 밖에 — 리스트박스 안에는 옵션만 선다(aria-required-children). */}
          {shown.length === 0 ? <p className="proj-pop-none">{t("sidebar.findProjectNone")}</p> : null}
          <div className="proj-pop-list" role="listbox" id={listId} aria-label={t("nav.projectList")}>
            {shown.map((p, i) => {
              const isCurrent = p.id === currentProjectId;
              const slot = slots.get(p.id);
              return (
                <div
                  key={p.id}
                  id={optionId(p)}
                  role="option"
                  aria-selected={i === at}
                  aria-current={isCurrent ? "true" : undefined}
                  className={"proj-pop-item" + (isCurrent ? " on" : "")}
                  // 포커스는 거르기 칸에 남는다 — 누른 줄로 옮겨 가면 ↑↓ · ↩ 가 끊긴다.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => i !== at && setActivePid(p.id)}
                  onClick={() => pick(p)}
                >
                  <ProjectRow
                    project={p}
                    where={where.get(p.id)}
                    signals={{
                      attention: attention.get(p.id),
                      terms: terms.get(p.id),
                      open: !isCurrent && openWindows.includes(p.id),
                    }}
                    meta={
                      isCurrent ? (
                        <HereMark />
                      ) : slot != null ? (
                        <kbd className="kbd proj-pop-key">{projectSlotLabel(slot)}</kbd>
                      ) : null
                    }
                  />
                </div>
              );
            })}
          </div>
          <div className="proj-pop-foot" role="menu" aria-label={t("nav.projectActions")} onKeyDown={onFootKey}>
            {currentProjectId != null ? (
              <div className="proj-colors" role="group" aria-label={t("sidebar.projectColor")} ref={colorsRef}>
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
            {openWindows.length >= 2 ? <TileChoices open={openWindows.length} onTile={tileWindows} /> : null}
            {currentRoot ? (
              <button type="button" role="menuitem" className="proj-pop-act" onClick={openInEditor}>
                <Code2 size={15} strokeWidth={1.75} aria-hidden="true" />
                <span className="proj-pop-act-label">{editor.label}</span>
              </button>
            ) : null}
            <button type="button" role="menuitem" className="proj-pop-act" onClick={() => void addFolder()}>
              <FolderPlus size={15} strokeWidth={1.75} aria-hidden="true" />
              <span className="proj-pop-act-label">{t("sidebar.addFolder")}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
