import { useEffect, useRef, useState } from "react";
import {
  MoonIcon,
  SunIcon,
  SettingsIcon,
  FolderGit2,
  ChevronsUpDown,
  PanelLeft,
  SquareTerminal,
} from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_ENTRIES, NAV_BUS, navShortcutLabel, type NavEntry } from "@/lib/navRegistry";
import { useAcpAttentionCount, useAcpWorkingCount } from "@/features/chat/acpBusyBus";
import { useSessionAttention } from "@/features/sessions/sessionAttention";
import { useT } from "@/i18n";

// Final UI Update (ui_v2) — 248px sidebar (01-ia-and-shell.md §5,
// Ocul-PM1.0/src/shell.jsx). Rendered as <nav> + <button>s for a11y; the
// mockup used <div onClick>. Dogfooding 2026-06-07: now collapsible — a
// brand-row button toggles `sidebarCollapsed`; ShellV2 owns the hover-reveal.
// v2: nav 항목은 navRegistry 단일 소스에서 파생 (docs/20260706_v2/01-ux-spec.md §1).
//
// 2026-09-05 — **넘치면 잘리는 게 아니라 스크롤된다.** 화면이 16개(+설정)로 늘면서
// 사이드바 전체 높이가 900px 을 넘었는데 `.app` 이 overflow:hidden 이라 낮은
// 창에서는 발밑(터미널 도크·테마·설정)이 통째로 잘려 나갔다 — 있는 줄도 모르는
// 상태. 구조를 세 층으로 나눈다:
//
//   고정 머리(드래그 스트립·브랜드·프로젝트 스위처)
//   → `.side-nav-scroll` (넘치는 만큼만 스크롤)
//   → 고정 발(.side-foot — 언제나 바닥에 보인다)
//
// 스크롤은 안전망이고, 보통 창 높이에서는 스크롤 없이 다 보이는 게 낫다.
// 그래서 세로 여백을 vh 로 눌러 두었다 (shell.css 의 --side-gap / .nav-item).

const MAIN_NAV = NAV_ENTRIES.filter((e) => e.group === "main");
const TOOL_NAV = NAV_ENTRIES.filter((e) => e.group === "tools");
const AI_NAV = NAV_ENTRIES.filter((e) => e.group === "ai");

interface SidebarProps {
  view: UiV2View;
  onNavigate: (view: UiV2View) => void;
  projectName: string | null;
  projectPath: string | null;
  /** Focuses the launcher window (project manage / add / rename / delete). */
  onOpenProjectSwitcher: () => void;
  /** Projects for the inline quick-switcher popover (Dogfooding 2026-06-14c). */
  projects?: { id: number; name: string; root_path: string }[];
  /** Currently-open project id — highlighted in the switcher. */
  currentProjectId?: number | null;
  /**
   * 다른 프로젝트로 이동. 멀티 창(I3) 이후 이건 제자리 전환이 아니라 **그
   * 프로젝트의 창을 열거나 포커스**하는 동작이다.
   */
  onSwitchProject?: (id: number) => void;
  /** 이미 창이 떠 있는 프로젝트 id — 팝오버에 "열림" 표시. */
  openWindows?: number[];
  isDark: boolean;
  onToggleTheme: () => void;
  /**
   * macOS `titleBarStyle: "Overlay"` floats the native traffic lights over the
   * top-left of the content. ShellV2 (full-screen, no legacy TitleBar) passes a
   * top inset so the brand clears the lights; the strip is a drag region.
   */
  macTopInset?: number;
  /**
   * 터미널 도크 토글 (2026-08-15). 화면 이동이 아니라 **지금 화면 위에**
   * 셸을 여는 것이라 nav 목록이 아니라 발밑(side-foot)에 둔다 — 목록에 끼면
   * ⌘번호가 밀리고 "다른 화면으로 간다"는 신호가 되어버린다.
   */
  terminalDockOpen?: boolean;
  onToggleTerminalDock?: () => void;
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
  working = 0,
  attention = 0,
}: {
  slot: NavEntry;
  active: boolean;
  /** 셸 진입 캐스케이드(--i) 순번 — shell.css .nav-item 의 animation-delay. */
  index: number;
  onNavigate: (view: UiV2View) => void;
  /**
   * 이 화면에서 **지금 돌고 있는** 일의 수 (0 이면 아무 표시도 없다).
   * 화면을 옮겨도 에이전트는 계속 도는데, 떠난 뒤로는 아무 기별이 없었다.
   */
  working?: number;
  /**
   * **승인을 기다리며 멈춰 있는** 일의 수. 작업 중과 다르다 — 이건 기다린다고
   * 안 풀리고 사용자가 눌러야 풀린다. 그래서 작업 배지보다 우선해 보인다.
   */
  attention?: number;
}) {
  const Icon = slot.icon;
  const shortcut = navShortcutLabel(slot.id);
  const { t } = useT();
  const label = t(slot.labelKey);
  const busy = working > 0;
  const waiting = attention > 0;
  const title = waiting
    ? `${label} — ${t("nav.attention", { n: attention })}`
    : busy
      ? `${label} — ${t("nav.working", { n: working })}`
      : shortcut
        ? `${label} (${shortcut})`
        : label;
  return (
    <button
      type="button"
      className={"nav-item" + (active ? " active" : "")}
      style={{ "--i": index } as React.CSSProperties}
      aria-current={active ? "page" : undefined}
      title={title}
      onClick={() => onNavigate(slot.id)}
    >
      {/* 도는 동안에는 아이콘 둘레가 돈다 — 숫자만으로는 "멈춘 채 N 개"인지
          "지금 일하는 중"인지 구분되지 않는다. */}
      <span className={"nav-ico" + (busy ? " working" : "")}>
        <Icon size={17} strokeWidth={active ? 2 : 1.8} />
      </span>
      <span>{label}</span>
      {waiting ? (
        <span className="nav-badge attention" aria-label={t("nav.attention", { n: attention })}>
          {attention}
        </span>
      ) : busy ? (
        <span className="nav-badge working" aria-label={t("nav.working", { n: working })}>
          {working}
        </span>
      ) : shortcut ? (
        <kbd className="nav-kbd">{shortcut}</kbd>
      ) : null}
    </button>
  );
}

/**
 * 스크롤 영역의 위/아래 가장자리 페이드를 켜고 끈다.
 *
 * 스크롤바를 상시 띄우면 소음이라(맥은 기본이 오버레이 스크롤바라 가만히 있으면
 * 아예 안 보인다) "더 있다" 는 사실이 사라진다. 그래서 **넘치는 쪽만** 흐린다 —
 * 위로 더 있으면 위를, 아래로 더 있으면 아래를. 다 보이면 페이드도 없다.
 *
 * 리렌더 없이 DOM 클래스만 토글한다: 스크롤마다 setState 를 돌리면 nav 목록
 * 전체가 통째로 다시 그려진다.
 */
function useEdgeFade(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const slack = el.scrollHeight - el.clientHeight;
      // 1px 여유 — 서브픽셀 반올림 때문에 끝까지 내려도 slack 이 0.5 쯤 남는다.
      el.classList.toggle("fade-top", el.scrollTop > 1);
      el.classList.toggle("fade-bottom", slack > 1 && el.scrollTop < slack - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // 창 높이가 바뀌면 넘치는지 여부도 바뀐다. ResizeObserver 가 없는 환경
    // (jsdom) 에서는 초기 1회 계산만 하고 조용히 넘어간다 — 레이아웃이 없는
    // 곳에서는 어차피 늘 "안 넘침" 이다.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [ref]);
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
  openWindows,
  isDark,
  onToggleTheme,
  macTopInset = 0,
  terminalDockOpen = false,
  onToggleTerminalDock,
  onToggleCollapse,
  collapsed = false,
  onMouseLeave,
}: SidebarProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  /** nav 목록만 담는 스크롤 영역 — 머리(브랜드·프로젝트)와 발(.side-foot)은 밖. */
  const navScrollRef = useRef<HTMLDivElement>(null);
  useEdgeFade(navScrollRef);
  /** 지금 돌고 있는 Claude Code 세션 수 (acpBusyBus — 메모리 버스). */
  const acpWorking = useAcpWorkingCount(currentProjectId ?? null, "claude");
  /** 승인을 기다리며 멈춰 있는 세션 수 — 작업 배지보다 우선해 보인다. */
  const acpAttention = useAcpAttentionCount(currentProjectId ?? null, "claude");
  const codexWorking = useAcpWorkingCount(currentProjectId ?? null, "codex");
  const codexAttention = useAcpAttentionCount(currentProjectId ?? null, "codex");
  /** 세션 화면에서 **사람이 눌러야** 풀리는 것 — 넘어온 작업의 승인 대기. */
  const sessionAttention = useSessionAttention(currentProjectId ?? null);

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
                  const isOpen = !isCurrent && (openWindows?.includes(p.id) ?? false);
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
                      {isCurrent ? (
                        <span className="proj-pop-cur">{t("sidebar.currentProject")}</span>
                      ) : isOpen ? (
                        <span className="proj-pop-cur">{t("sidebar.openProject")}</span>
                      ) : null}
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

      {/* 스크롤 영역. 안의 항목이 전부 <button> 이라 탭 키만으로 끝까지 닿는다
          — 브라우저가 포커스된 행을 스크롤해 들여온다. 그래서 컨테이너 자체에
          tabIndex 를 주지 않았다(axe scrollable-region-focusable 도 포커스 가능한
          자식이 있으면 통과한다). 빈 탭 정거장이 하나 늘 뿐이다.
          aria 도 붙이지 않는다: 바깥 <nav aria-label> 이 이미 이 목록의 이름이고,
          role 없는 div 에 aria-label 을 얹으면 그게 오히려 위반이다. */}
      <div className="side-nav-scroll" ref={navScrollRef}>
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

        <div className="nav-section-label">{t("sidebar.aiSection")}</div>
        {AI_NAV.map((slot, i) => (
          <NavRow
            key={slot.id}
            slot={slot}
            active={view === slot.id}
            index={MAIN_NAV.length + TOOL_NAV.length + i}
            onNavigate={onNavigate}
            working={slot.id === "claudecode" ? acpWorking : slot.id === "codex" ? codexWorking : 0}
            attention={
              slot.id === "claudecode"
                ? acpAttention
                : slot.id === "codex"
                  ? codexAttention
                  : slot.id === "sessions"
                    ? sessionAttention
                    : 0
            }
          />
        ))}
      </div>

      <div className="side-foot">
        {onToggleTerminalDock ? (
          <button
            type="button"
            className={"nav-item" + (terminalDockOpen ? " active" : "")}
            aria-pressed={terminalDockOpen}
            onClick={onToggleTerminalDock}
          >
            <span className="nav-ico">
              <SquareTerminal size={17} strokeWidth={terminalDockOpen ? 2 : 1.8} />
            </span>
            <span>{t("sidebar.terminalDock")}</span>
            <kbd className="nav-kbd">⌘J</kbd>
          </button>
        ) : null}
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
