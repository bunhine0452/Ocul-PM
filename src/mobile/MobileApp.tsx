// 모바일 셸 (#mb3-tabs, 플랜 D6) — 폰 브라우저(비-웹뷰) 전용 진입점.
//
// ShellV2(데스크톱 밀도)를 반응형으로 욱여넣지 않고 하단탭 5개로 새로 짠다.
// 데이터 층은 bindings(=transport 셤 경유)와 순수 헬퍼를 재사용하고,
// WorkspaceContext/SettingsProvider 는 올리지 않는다 (데스크톱 창 상태·설정
// 커맨드는 모바일 화이트리스트 밖).
import { useCallback, useEffect, useState } from "react";

import "@/App.css";
import "./mobile.css";

import { commands, type JournalEntrySummary, type Project } from "@/lib/bindings";
import { ChevronDown, MessagesSquare, MessageSquareText, NotebookText, Sunrise, TargetIcon } from "@/components/Icons";
import { useT } from "@/i18n";
import { getToken } from "@/lib/transport/http";
import { applyDesktopTheme } from "./theme";
import { EntryDetail } from "./EntryDetail";
import { PairScreen } from "./PairScreen";
import { getSavedProjectId, saveProjectId } from "./storage";
import { AiTab } from "./tabs/AiTab";
import { DiscussionTab } from "./tabs/DiscussionTab";
import { JournalTab } from "./tabs/JournalTab";
import { PlannerTab } from "./tabs/PlannerTab";
import { TodayTab } from "./tabs/TodayTab";

type Boot = "checking" | "pair" | "ready";
type Tab = "today" | "journal" | "planner" | "discussion" | "ai";

// 데스크톱 사이드바(navRegistry)와 **같은 아이콘** — 같은 앱이라는 감각의 축.
const TABS: Array<{
  id: Tab;
  labelKey: "mobile.tab.today" | "mobile.tab.journal" | "mobile.tab.planner" | "mobile.tab.discussion" | "mobile.tab.ai";
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}> = [
  { id: "today", labelKey: "mobile.tab.today", icon: Sunrise },
  { id: "journal", labelKey: "mobile.tab.journal", icon: NotebookText },
  { id: "planner", labelKey: "mobile.tab.planner", icon: TargetIcon },
  { id: "discussion", labelKey: "mobile.tab.discussion", icon: MessagesSquare },
  { id: "ai", labelKey: "mobile.tab.ai", icon: MessageSquareText },
];

export default function MobileApp() {
  const { t } = useT();
  const [boot, setBoot] = useState<Boot>("checking");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const [openEntry, setOpenEntry] = useState<JournalEntrySummary | null>(null);

  // 테마 — 맥의 설정(테마 가족·프리셋·액센트)을 그대로 나른다 (theme.ts).
  // 페어링 전에는 설정 커맨드가 401 이므로 boot 성공 후 적용된다.
  useEffect(() => {
    if (boot !== "ready") return;
    let cleanup: (() => void) | undefined;
    void applyDesktopTheme().then((c) => {
      cleanup = c;
    });
    return () => cleanup?.();
  }, [boot]);

  const boot_ = useCallback(async () => {
    if (!getToken()) {
      setBoot("pair");
      return;
    }
    const ping = await fetch("/api/ping", {
      headers: { authorization: `Bearer ${getToken()}` },
    }).catch(() => null);
    if (!ping?.ok) {
      setBoot("pair"); // 토큰 무효/서버 교체 — 재페어링.
      return;
    }
    const res = await commands.listProjects();
    if (res.status === "ok") {
      setProjects(res.data);
      const saved = getSavedProjectId();
      const valid = res.data.find((p) => p.id === saved) ?? (res.data.length === 1 ? res.data[0] : null);
      setProjectId(valid ? valid.id : null);
    }
    setBoot("ready");
  }, []);

  useEffect(() => {
    void boot_();
  }, [boot_]);

  if (boot === "checking") {
    return (
      <div className="mob-root min-h-dvh flex items-center justify-center">
        <p className="text-sm mob-text-3">{t("mobile.pair.checking")}</p>
      </div>
    );
  }

  if (boot === "pair") {
    return <PairScreen onPaired={() => void boot_()} />;
  }

  const project = projects.find((p) => p.id === projectId) ?? null;

  if (project === null || picking) {
    return (
      <div className="mob-root min-h-dvh p-6 space-y-4">
        <div className="flex items-center gap-2.5 pt-2">
          <img src="/icon.svg" alt="" className="mob-brand" />
          <h1 className="text-base font-semibold">{t("mobile.project.pick")}</h1>
        </div>
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  setProjectId(p.id);
                  saveProjectId(p.id);
                  setPicking(false);
                }}
                className="mob-card w-full text-left px-4 py-3"
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs mob-text-3 truncate mt-0.5">{p.root_path}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="mob-root min-h-dvh flex flex-col">
      <header className="mob-header sticky top-0 z-40 px-4 py-2.5">
        <button onClick={() => setPicking(true)} className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="mob-brand" />
          <span className="mob-header-title text-[15px] font-semibold">{project.name}</span>
          <ChevronDown size={13} className="mob-header-caret" />
          <span className="mob-beta">BETA</span>
        </button>
      </header>

      <main className="flex-1 overflow-y-auto">
        {tab === "today" ? (
          <TodayTab projectId={project.id} onOpenEntry={setOpenEntry} />
        ) : tab === "journal" ? (
          <JournalTab projectId={project.id} onOpenEntry={setOpenEntry} />
        ) : tab === "planner" ? (
          <PlannerTab projectId={project.id} />
        ) : tab === "discussion" ? (
          <DiscussionTab projectId={project.id} />
        ) : (
          <AiTab projectId={project.id} />
        )}
      </main>

      <nav className="mob-tabbar sticky bottom-0 z-40 flex">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? "page" : undefined}
              className="mob-tab flex-1 flex flex-col items-center gap-0.5 pt-1.5 pb-1 text-[10px] font-medium"
            >
              <span className="mob-tab-icon" aria-hidden>
                <Icon size={17} />
              </span>
              {t(entry.labelKey)}
            </button>
          );
        })}
      </nav>

      {openEntry ? (
        <EntryDetail
          projectId={project.id}
          relativePath={openEntry.relative_path}
          title={openEntry.title}
          onClose={() => setOpenEntry(null)}
        />
      ) : null}
    </div>
  );
}
