/* ============================================================
   App shell — sidebar nav, routing, theme toggle
   ============================================================ */
const { useState, useEffect, useMemo, useRef } = React;

const NAV = [
  { id: "today",   label: "Today",   icon: "Sunrise",       badge: () => TODAY.changedToday },
  { id: "journal", label: "작업 일지", icon: "NotebookText",  badge: () => JOURNAL.length },
  { id: "diff",    label: "변경 diff", icon: "GitCompareArrows" },
  { id: "planner", label: "Planner", icon: "Target" },
];
const NAV2 = [
  { id: "search",   label: "코드 검색", icon: "Search" },
  { id: "terminal", label: "터미널",   icon: "SquareTerminal" },
  { id: "ai",       label: "AI 패널",   icon: "Sparkles" },
];

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("oculpm-theme") || "light");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("oculpm-theme", theme);
  }, [theme]);
  return [theme, setTheme];
}

function Sidebar({ route, go, theme, setTheme }) {
  const NavRow = ({ item }) => (
    <div
      className={"nav-item" + (route.screen === item.id ? " active" : "")}
      onClick={() => go(item.id)}
    >
      <span className="nav-ico"><Icon name={item.icon} size={17} sw={route.screen === item.id ? 2 : 1.8} /></span>
      <span>{item.label}</span>
      {item.badge ? <span className="nav-badge">{item.badge()}</span> : null}
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="side-brand">
        <div className="brand-mark"><Icon name="Eye" size={17} sw={2.2} /></div>
        <div>
          <div className="brand-name">Ocul-PM</div>
          <div className="brand-sub">로컬-우선 · v1.0</div>
        </div>
      </div>

      <div className="proj-switch" onClick={() => go("today")} title="프로젝트 전환">
        <div className="proj-icon"><Icon name="FolderGit2" size={15} sw={2} /></div>
        <div className="proj-meta">
          <div className="proj-name">{PROJECT.name}</div>
          <div className="proj-path">{PROJECT.path}</div>
        </div>
        <Icon name="ChevronsUpDown" size={14} color="var(--text-3)" />
      </div>

      {NAV.map((i) => <NavRow key={i.id} item={i} />)}

      <div className="nav-section-label">도구</div>
      {NAV2.map((i) => <NavRow key={i.id} item={i} />)}

      <div className="side-spacer" />

      <div className="side-foot">
        <div className="nav-item" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <span className="nav-ico"><Icon name={theme === "dark" ? "Sun" : "Moon"} size={17} sw={1.8} /></span>
          <span>{theme === "dark" ? "라이트 모드" : "다크 모드"}</span>
        </div>
        <div className="nav-item" onClick={() => go("settings")}>
          <span className="nav-ico"><Icon name="Settings" size={17} sw={1.8} /></span>
          <span>설정</span>
        </div>
      </div>
    </aside>
  );
}

function Toolbar({ title, sub, children }) {
  return (
    <div className="toolbar">
      <div>
        <div className="toolbar-title">{title}</div>
      </div>
      {sub ? <span className="toolbar-sub">{sub}</span> : null}
      <div className="toolbar-spacer" />
      {children}
    </div>
  );
}

function App() {
  const [theme, setTheme] = useTheme();
  const [route, setRoute] = useState({ screen: "today", params: {} });
  const go = (screen, params = {}) => setRoute({ screen, params });

  const Screen = {
    today: TodayScreen,
    journal: JournalScreen,
    diff: DiffScreen,
    planner: PlannerScreen,
    search: SearchScreen,
    terminal: TerminalScreen,
    ai: AIPanelScreen,
    settings: SettingsScreen,
  }[route.screen] || TodayScreen;

  return (
    <div className="app">
      <Sidebar route={route} go={go} theme={theme} setTheme={setTheme} />
      <main className="content">
        <Screen key={route.screen} route={route} go={go} theme={theme} setTheme={setTheme} />
      </main>
    </div>
  );
}

Object.assign(window, { App, Toolbar, useTheme });
