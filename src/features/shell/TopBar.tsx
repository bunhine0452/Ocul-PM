import { useEffect, useRef, useState, type Ref } from "react";
import { MoreHorizontal, SettingsIcon } from "@/components/Icons";
import { FindButton } from "@/components/Toolbar";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { ProjectSwitcher } from "@/features/shell/ProjectSwitcher";
import type { NavBadges } from "@/features/shell/useNavBadges";
import { NAV_ENTRIES, navShortcutLabel } from "@/lib/navRegistry";
import { useT } from "@/i18n";
import type { Project } from "@/lib/bindings";
import { kbd } from "@/lib/kbd";
import { dragRegion } from "@/lib/platform";

// 셸 윗줄 (4.0) — 사이드바를 걷고 한 줄에 모은다.
//
//   [신호등 자리] 프로젝트 ▾ · 오늘 · 작업 일지 · 계획 · 변경 ···· [화면 동작] 찾기 ⌘K ⚙
//
// 사이드바 옆에 목록 칸(일지 목록 · 계획 목록 · 파일 목록)이 또 서면 왼쪽에 사이드바가 두
// 겹이었다 (사용자 지적 2026-10-29). 화면이 넷이면 탭 한 줄로 충분하고, 그러면 화면마다
// 왼쪽 칸은 많아야 하나다. 화면 제목은 고른 탭이 대신하므로 화면의 `<Toolbar>` 는 제목 없이
// 동작만 이 줄의 「화면 동작」 자리로 보낸다(`ToolbarSlotContext`).
//
// 탭 옆의 수는 **예외만** — 확인할 것(경고색) 하나.

interface TopBarProps {
  view: UiV2View;
  onNavigate: (view: UiV2View) => void;
  projectName: string | null;
  currentProjectId: number | null;
  projects: Project[];
  /** 다른 프로젝트의 창을 연다 (이미 열려 있으면 그 창이 앞으로 — I1). */
  onOpenProject: (projectId: number) => void;
  onProjectsChanged?: () => void;
  badges?: NavBadges;
  /** 화면 동작이 포털될 자리. */
  slotRef: Ref<HTMLDivElement>;
}

export function TopBar({
  view,
  onNavigate,
  projectName,
  currentProjectId,
  projects,
  onOpenProject,
  onProjectsChanged,
  badges,
  slotRef,
}: TopBarProps) {
  const { t } = useT();
  // 빈 자리는 창을 잡는 띠다 — macOS 오버레이 타이틀바에서만 (`dragRegion`).
  const drag = dragRegion();
  // 좁은 창(≤640)에서 화면 동작은 「⋯」 메뉴로 — 줄 안 스크롤 칸이 29px(480 에선 5px)로 짓눌려 「새 세션 ·
  // 새 일지」 를 누를 수 없었다(레드팀 10-31). 넓은 창에서는 이 단추가 보이지 않고 칸은 늘 그대로다.
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const slotBox = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!more) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (slotBox.current?.contains(target) || moreRef.current?.contains(target)) return;
      setMore(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMore(false);
      moreRef.current?.focus();
    };
    // 열면 첫 동작으로 포커스 — 칸이 「⋯」 앞에 있어 Tab 으로는 닿지 않는다.
    slotBox.current?.querySelector<HTMLElement>("button:not(:disabled), [href]")?.focus();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [more]);
  // 화면을 바꾸면 접는다 — 다른 화면의 동작이 열린 채 남지 않게.
  useEffect(() => setMore(false), [view]);
  return (
    <header className="topbar" {...drag}>
      <ProjectSwitcher
        projectName={projectName}
        currentProjectId={currentProjectId}
        projects={projects}
        onOpenProject={onOpenProject}
        onProjectsChanged={onProjectsChanged}
      />
      <nav className="topnav" aria-label={t("nav.aria.main")}>
        {NAV_ENTRIES.map((e) => {
          const active = view === e.id;
          const label = t(e.labelKey);
          const shortcut = navShortcutLabel(e.id);
          const badge = badges?.[e.id];
          const Icon = e.icon;
          return (
            <button
              key={e.id}
              type="button"
              className={"topnav-item" + (active ? " active" : "")}
              aria-current={active ? "page" : undefined}
              title={shortcut ? `${label} (${shortcut})` : label}
              onClick={() => onNavigate(e.id)}
            >
              {/* 좁은 창(≤640)에서는 아이콘만 — 이름은 화면에서만 감추고 접근명 · 툴팁으로 남는다. */}
              <Icon size={15} className="topnav-ico" aria-hidden="true" />
              <span className="topnav-label">{label}</span>
              {badge ? (
                <span className="nav-badge" aria-label={t("nav.toCheck", { n: badge.n })}>
                  {badge.n}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="topbar-fill" {...drag} />
      <div
        className={"topbar-actions" + (more ? " is-open" : "")}
        ref={(el) => {
          slotBox.current = el;
          if (typeof slotRef === "function") slotRef(el);
          else if (slotRef) (slotRef as { current: HTMLDivElement | null }).current = el;
        }}
        onClick={() => setMore(false)}
      />
      <button
        ref={moreRef}
        type="button"
        className="iconbtn topbar-more"
        aria-expanded={more}
        aria-label={t("toolbar.more")}
        title={t("toolbar.more")}
        onClick={() => setMore((v) => !v)}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      <FindButton />
      <button
        type="button"
        className={"iconbtn topbar-settings" + (view === "settings" ? " active" : "")}
        aria-current={view === "settings" ? "page" : undefined}
        aria-label={t("sidebar.settings")}
        title={`${t("sidebar.settings")} (${kbd("⌘,")})`}
        onClick={() => onNavigate("settings")}
      >
        <SettingsIcon size={15} />
      </button>
    </header>
  );
}
