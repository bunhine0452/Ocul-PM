import { SettingsIcon } from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { ProjectSwitcher } from "@/features/shell/ProjectSwitcher";
import type { NavBadges } from "@/features/shell/useNavBadges";
import { NAV_ENTRIES, navShortcutLabel } from "@/lib/navRegistry";
import { useT } from "@/i18n";
import type { Project } from "@/lib/bindings";
import { kbd } from "@/lib/kbd";
import { dragRegion, isMac } from "@/lib/platform";

// 사이드바 (4.0, 시안 Main.dc.html) — 머리 · 행 넷 · 바닥의 설정. 그게 전부다.
//
//   머리: 프로젝트 이름 버튼(⌘O) — 최근 프로젝트 목록을 띄운다 (ProjectSwitcher)
//   행 넷: 오늘 · 작업 일지 · 계획 · 변경 (navRegistry, ⌘1~⌘4)
//   바닥: 설정 (⌘,)
//
// 행 옆의 수는 **예외만** — 확인할 것(경고색)과 오늘 기록 수(조용한 색). 3.x 의 섹션
// 라벨·척추·접기·밀도 단·테마 토글·단축키 재배정 안내는 걷었다: 화면이 다섯이면 한눈에
// 다 보이고, 밝기는 설정에 있다. 접기(⌘\)도 걷었다 — 212px 사이드바는 접을 만큼 크지 않다.

interface SidebarProps {
  view: UiV2View;
  onNavigate: (view: UiV2View) => void;
  projectName: string | null;
  currentProjectId: number | null;
  projects: Project[];
  /** 다른 프로젝트의 창을 연다 (이미 열려 있으면 그 창이 앞으로 — I1). */
  onOpenProject: (projectId: number) => void;
  onProjectsChanged?: () => void;
  badges?: NavBadges;
}

function NavRow({
  id,
  active,
  onNavigate,
  badge,
}: {
  id: UiV2View;
  active: boolean;
  onNavigate: (view: UiV2View) => void;
  badge?: NavBadges[UiV2View];
}) {
  const { t } = useT();
  const entry = NAV_ENTRIES.find((e) => e.id === id);
  if (!entry) return null;
  const Icon = entry.icon;
  const label = t(entry.labelKey);
  const shortcut = navShortcutLabel(id);
  return (
    <button
      type="button"
      className={"nav-item" + (active ? " active" : "")}
      aria-current={active ? "page" : undefined}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={() => onNavigate(id)}
    >
      <span className="nav-ico">
        <Icon size={15} />
      </span>
      <span className="nav-label">{label}</span>
      {badge ? (
        <span
          className={"nav-badge " + badge.tone}
          aria-label={t(badge.tone === "warn" ? "nav.toCheck" : "nav.count", { n: badge.n })}
        >
          {badge.n}
        </span>
      ) : null}
    </button>
  );
}

export function Sidebar({
  view,
  onNavigate,
  projectName,
  currentProjectId,
  projects,
  onOpenProject,
  onProjectsChanged,
  badges,
}: SidebarProps) {
  const { t } = useT();
  // macOS 오버레이 타이틀바 — 신호등이 사이드바 머리 위에 뜬다. 그 자리를 비우고
  // 창을 잡는 띠로 쓴다. Windows·Linux 는 OS 제목줄이 있어 띠가 없다.
  const mac = isMac();
  return (
    <nav className="sidebar" aria-label={t("nav.aria.main")}>
      {mac ? <div className="side-drag-strip" {...dragRegion()} /> : null}
      <ProjectSwitcher
        projectName={projectName}
        currentProjectId={currentProjectId}
        projects={projects}
        onOpenProject={onOpenProject}
        onProjectsChanged={onProjectsChanged}
      />
      <div className="side-nav">
        {NAV_ENTRIES.map((e) => (
          <NavRow key={e.id} id={e.id} active={view === e.id} onNavigate={onNavigate} badge={badges?.[e.id]} />
        ))}
      </div>
      <div className="side-fill" {...dragRegion()} />
      <button
        type="button"
        className={"nav-item" + (view === "settings" ? " active" : "")}
        aria-current={view === "settings" ? "page" : undefined}
        onClick={() => onNavigate("settings")}
        title={`${t("sidebar.settings")} (${kbd("⌘,")})`}
      >
        <span className="nav-ico">
          <SettingsIcon size={15} />
        </span>
        <span className="nav-label">{t("sidebar.settings")}</span>
      </button>
    </nav>
  );
}
