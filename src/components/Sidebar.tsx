import {
  Sunrise,
  NotebookText,
  GitCompareArrows,
  TargetIcon,
  SearchIcon,
  SquareTerminal,
  SparklesIcon,
  MoonIcon,
  SunIcon,
  SettingsIcon,
  FolderGit2,
  ChevronsUpDown,
} from "@/components/Icons";
import { BrandMark } from "@/components/BrandMark";
import type { UiV2View } from "@/contexts/WorkspaceContext";

// Final UI Update (ui_v2) — 248px fixed sidebar (01-ia-and-shell.md §5,
// Ocul-PM1.0/src/shell.jsx). 9 slots: 4 main + 3 tools + 2 footer
// (dark toggle / settings). Rendered as <nav> + <button>s for a11y; the
// mockup used <div onClick>. Not collapsible (00-master-plan §6).

type IconComp = React.ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  color?: string;
}>;

interface NavSlot {
  id: UiV2View;
  label: string;
  icon: IconComp;
  /** Optional count chip (populated by PR-UI 2 backend brief; omitted now). */
  badge?: number;
}

const MAIN_NAV: NavSlot[] = [
  { id: "today", label: "Today", icon: Sunrise },
  { id: "journal", label: "작업 일지", icon: NotebookText },
  { id: "diff", label: "변경 diff", icon: GitCompareArrows },
  { id: "planner", label: "Planner", icon: TargetIcon },
];

const TOOL_NAV: NavSlot[] = [
  { id: "search", label: "코드 검색", icon: SearchIcon },
  { id: "terminal", label: "터미널", icon: SquareTerminal },
  { id: "ai", label: "AI 패널", icon: SparklesIcon },
];

interface SidebarProps {
  view: UiV2View;
  onNavigate: (view: UiV2View) => void;
  projectName: string | null;
  projectPath: string | null;
  onOpenProjectSwitcher: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  /**
   * macOS `titleBarStyle: "Overlay"` floats the native traffic lights over the
   * top-left of the content. ShellV2 (full-screen, no legacy TitleBar) passes a
   * top inset so the brand clears the lights; the strip is a drag region.
   */
  macTopInset?: number;
}

function NavRow({
  slot,
  active,
  onNavigate,
}: {
  slot: NavSlot;
  active: boolean;
  onNavigate: (view: UiV2View) => void;
}) {
  const Icon = slot.icon;
  return (
    <button
      type="button"
      className={"nav-item" + (active ? " active" : "")}
      aria-current={active ? "page" : undefined}
      onClick={() => onNavigate(slot.id)}
    >
      <span className="nav-ico">
        <Icon size={17} strokeWidth={active ? 2 : 1.8} />
      </span>
      <span>{slot.label}</span>
      {slot.badge != null ? <span className="nav-badge">{slot.badge}</span> : null}
    </button>
  );
}

export function Sidebar({
  view,
  onNavigate,
  projectName,
  projectPath,
  onOpenProjectSwitcher,
  isDark,
  onToggleTheme,
  macTopInset = 0,
}: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="메인 내비게이션">
      {macTopInset > 0 ? (
        <div className="side-drag-strip" data-tauri-drag-region style={{ height: macTopInset }} />
      ) : null}
      <div className="side-brand" data-tauri-drag-region>
        <BrandMark size={28} />
        <div>
          <div className="brand-name">Ocul-PM</div>
          <div className="brand-sub">로컬-우선 · v1.0</div>
        </div>
      </div>

      <button
        type="button"
        className="proj-switch"
        onClick={onOpenProjectSwitcher}
        title="프로젝트 전환 (⌘P)"
      >
        <div className="proj-icon">
          <FolderGit2 size={15} strokeWidth={2} />
        </div>
        <div className="proj-meta">
          <div className="proj-name">{projectName ?? "프로젝트 선택"}</div>
          <div className="proj-path">{projectPath ?? "—"}</div>
        </div>
        <ChevronsUpDown size={14} color="var(--text-3)" />
      </button>

      {MAIN_NAV.map((slot) => (
        <NavRow key={slot.id} slot={slot} active={view === slot.id} onNavigate={onNavigate} />
      ))}

      <div className="nav-section-label">도구</div>
      {TOOL_NAV.map((slot) => (
        <NavRow key={slot.id} slot={slot} active={view === slot.id} onNavigate={onNavigate} />
      ))}

      <div className="side-spacer" />

      <div className="side-foot">
        <button type="button" className="nav-item" onClick={onToggleTheme}>
          <span className="nav-ico">
            {isDark ? <SunIcon size={17} strokeWidth={1.8} /> : <MoonIcon size={17} strokeWidth={1.8} />}
          </span>
          <span>{isDark ? "라이트 모드" : "다크 모드"}</span>
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
          <span>설정</span>
        </button>
      </div>
    </nav>
  );
}
