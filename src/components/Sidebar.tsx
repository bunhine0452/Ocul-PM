import { useEffect, useRef, useState } from "react";
import {
  MoonIcon,
  SunIcon,
  SettingsIcon,
  FolderGit2,
  ChevronsUpDown,
  PanelLeft,
} from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_ENTRIES, NAV_BUS, navShortcutLabel, type NavEntry } from "@/lib/navRegistry";
import { useT } from "@/i18n";

// Final UI Update (ui_v2) — 248px sidebar (01-ia-and-shell.md §5,
// Ocul-PM1.0/src/shell.jsx). Rendered as <nav> + <button>s for a11y; the
// mockup used <div onClick>. Dogfooding 2026-06-07: now collapsible — a
// brand-row button toggles `sidebarCollapsed`; ShellV2 owns the hover-reveal.
// v2: nav 항목은 navRegistry 단일 소스에서 파생 (docs/20260706_v2/01-ux-spec.md §1).

const MAIN_NAV = NAV_ENTRIES.filter((e) => e.group === "main");
const TOOL_NAV = NAV_ENTRIES.filter((e) => e.group === "tools");

interface SidebarProps {
  view: UiV2View;
  onNavigate: (view: UiV2View) => void;
  projectName: string | null;
  projectPath: string | null;
  /** Opens the full main screen (project manage / add / rename / delete). */
  onOpenProjectSwitcher: () => void;
  /** Projects for the inline quick-switcher popover (Dogfooding 2026-06-14c). */
  projects?: { id: number; name: string; root_path: string }[];
  /** Currently-open project id — highlighted in the switcher. */
  currentProjectId?: number | null;
  /** Switch to another project in-place (no return to the main screen). */
  onSwitchProject?: (id: number) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  /**
   * macOS `titleBarStyle: "Overlay"` floats the native traffic lights over the
   * top-left of the content. ShellV2 (full-screen, no legacy TitleBar) passes a
   * top inset so the brand clears the lights; the strip is a drag region.
   */
  macTopInset?: number;
  /** Collapse the sidebar off-screen (hover-to-reveal). Dogfooding 2026-06-07. */
  onToggleCollapse?: () => void;
  /** True when the sidebar is currently collapsed (button shown in the overlay). */
  collapsed?: boolean;
  /** Hide the floating overlay when the cursor leaves it (collapsed mode). */
  onMouseLeave?: () => void;
}

function NavRow({
  slot,
  active,
  index,
  onNavigate,
}: {
  slot: NavEntry;
  active: boolean;
  /** 셸 진입 캐스케이드(--i) 순번 — shell.css .nav-item 의 animation-delay. */
  index: number;
  onNavigate: (view: UiV2View) => void;
}) {
  const Icon = slot.icon;
  const shortcut = navShortcutLabel(slot.id);
  const { t } = useT();
  const label = t(slot.labelKey);
  return (
    <button
      type="button"
      className={"nav-item" + (active ? " active" : "")}
      style={{ "--i": index } as React.CSSProperties}
      aria-current={active ? "page" : undefined}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={() => onNavigate(slot.id)}
    >
      <span className="nav-ico">
        <Icon size={17} strokeWidth={active ? 2 : 1.8} />
      </span>
      <span>{label}</span>
      {shortcut ? <kbd className="nav-kbd">{shortcut}</kbd> : null}
    </button>
  );
}

export function Sidebar({
  view,
  onNavigate,
  projectName,
  projectPath,
  onOpenProjectSwitcher,
  projects,
  currentProjectId,
  onSwitchProject,
  isDark,
  onToggleTheme,
  macTopInset = 0,
  onToggleCollapse,
  collapsed = false,
  onMouseLeave,
}: SidebarProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  // ⌘P (useGlobalShortcuts) / 팔레트 "프로젝트 전환" → 팝오버 열기 (v2 U1).
  useEffect(() => {
    const onOpen = () => setSwitcherOpen(true);
    window.addEventListener(NAV_BUS.openProjectSwitcher, onOpen);
    return () => window.removeEventListener(NAV_BUS.openProjectSwitcher, onOpen);
  }, []);

  // Close the inline switcher on outside-click / Esc.
  useEffect(() => {
    if (!switcherOpen) return;
    const onDown = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSwitcherOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [switcherOpen]);

  const { t } = useT();

  return (
    <nav className="sidebar" aria-label={t("nav.aria.main")} onMouseLeave={onMouseLeave}>
      {macTopInset > 0 ? (
        <div className="side-drag-strip" data-tauri-drag-region style={{ height: macTopInset }} />
      ) : null}
      <div className="side-brand" data-tauri-drag-region>
        {onToggleCollapse ? (
          <button
            type="button"
            className="side-collapse-btn"
            onClick={onToggleCollapse}
            title={collapsed ? t("sidebar.pin") : t("sidebar.collapse")}
            aria-label={collapsed ? t("sidebar.pin") : t("sidebar.collapse")}
          >
            <PanelLeft size={16} />
          </button>
        ) : null}
      </div>

      <div className="proj-switch-wrap" ref={switcherRef}>
        <button
          type="button"
          className="proj-switch"
          onClick={() => setSwitcherOpen((o) => !o)}
          title={t("sidebar.switchProject")}
          aria-haspopup="menu"
          aria-expanded={switcherOpen}
        >
          <div className="proj-icon">
            <FolderGit2 size={15} strokeWidth={2} />
          </div>
          <div className="proj-meta">
            <div className="proj-name">{projectName ?? t("sidebar.selectProject")}</div>
            <div className="proj-path">{projectPath ?? "—"}</div>
          </div>
          <ChevronsUpDown size={14} color="var(--text-3)" />
        </button>

        {switcherOpen ? (
          <div className="proj-pop" role="menu" aria-label={t("sidebar.switchProjectMenu")}>
            {projects && projects.length > 0 ? (
              <div className="proj-pop-list">
                {projects.map((p) => {
                  const isCurrent = p.id === currentProjectId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isCurrent}
                      className={"proj-pop-item" + (isCurrent ? " on" : "")}
                      onClick={() => {
                        if (!isCurrent) onSwitchProject?.(p.id);
                        setSwitcherOpen(false);
                      }}
                    >
                      <FolderGit2 size={14} strokeWidth={2} color="var(--accent)" />
                      <span className="proj-pop-meta">
                        <span className="proj-pop-name">{p.name}</span>
                        <span className="proj-pop-path">{p.root_path}</span>
                      </span>
                      {isCurrent ? <span className="proj-pop-cur">{t("sidebar.currentProject")}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="proj-pop-manage"
              onClick={() => {
                setSwitcherOpen(false);
                onOpenProjectSwitcher();
              }}
            >
              <ChevronsUpDown size={13} /> {t("sidebar.manageProjects")}
            </button>
          </div>
        ) : null}
      </div>

      {MAIN_NAV.map((slot, i) => (
        <NavRow key={slot.id} slot={slot} active={view === slot.id} index={i} onNavigate={onNavigate} />
      ))}

      <div className="nav-section-label">{t("sidebar.toolsSection")}</div>
      {TOOL_NAV.map((slot, i) => (
        <NavRow
          key={slot.id}
          slot={slot}
          active={view === slot.id}
          index={MAIN_NAV.length + i}
          onNavigate={onNavigate}
        />
      ))}

      <div className="side-spacer" />

      <div className="side-foot">
        <button type="button" className="nav-item" onClick={onToggleTheme}>
          <span className="nav-ico">
            {isDark ? <SunIcon size={17} strokeWidth={1.8} /> : <MoonIcon size={17} strokeWidth={1.8} />}
          </span>
          <span>{isDark ? t("sidebar.lightMode") : t("sidebar.darkMode")}</span>
        </button>
        <button
          type="button"
          className={"nav-item" + (view === "settings" ? " active" : "")}
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
        >
          <span className="nav-ico">
            <SettingsIcon size={17} strokeWidth={1.8} />
          </span>
          <span>{t("sidebar.settings")}</span>
        </button>
      </div>
    </nav>
  );
}
