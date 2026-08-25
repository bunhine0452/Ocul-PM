import { useMemo, useState } from "react";
import {
  Sun,
  Sparkles,
  Database,
  Smartphone,
  GitBranch,
  Settings as SettingsIcon,
  FileCode,
  Code2,
  Download,
} from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { Section, Field, Toggle } from "./tabs/ui";
import { AppearanceTab } from "./tabs/AppearanceTab";
import { LlmTab } from "./tabs/LlmTab";
import { IndexingTab } from "./tabs/IndexingTab";
import { GraphTab } from "./tabs/GraphTab";
import { DataTab } from "./tabs/DataTab";
import { DiagnosticsTab } from "./tabs/DiagnosticsTab";
import { UpdateTab } from "./tabs/UpdateTab";
export { NotionSection } from "./tabs/DataTab";
// 상수·클램프만 있는 모듈이다 — TerminalSurface 에서 가져오면 설정 청크가
// xterm 을 통째로 끌고 온다.
import { useT, type I18nKey } from "@/i18n";
import { OculpmSettings } from "./OculpmSettings";
import { CodeSettings } from "./CodeSettings";
import { MobileSettings } from "./MobileSettings";

type TabId =
  | "appearance"
  | "llm"
  | "code"
  | "indexing"
  | "graph"
  | "data"
  | "oculpm"
  | "mobile"
  | "diagnostics"
  | "update";

const TABS: Array<{ id: TabId; labelKey: I18nKey; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "appearance", labelKey: "settings.tab.appearance", icon: Sun },
  { id: "llm", labelKey: "settings.tab.llm", icon: Sparkles },
  // GitHub PAT 탭은 감사(2026-07-16)에서 제거 — 소비처가 verify 뿐이라 vestigial
  // 이었고, 로컬 git 은 토큰 없이 동작한다 (git_log/status 는 git CLI).
  // 코드 화면 — 편집기 동작 + 언어 서버 (ide-completion #lsp-settings-screen).
  { id: "code", labelKey: "settings.tab.code", icon: Code2 },
  { id: "indexing", labelKey: "settings.tab.indexing", icon: FileCode },
  { id: "graph", labelKey: "settings.tab.graph", icon: GitBranch },
  { id: "data", labelKey: "settings.tab.data", icon: Database },
  { id: "oculpm", labelKey: "settings.tab.oculpm", icon: FileCode },
  // 모바일 브리지 — Tailscale 폰 접근 (mobile-bridge #mb0-settings-ui).
  { id: "mobile", labelKey: "settings.tab.mobile", icon: Smartphone },
  // Diagnostics absorbed from the old separate sidebar tab (MASTER-GUIDE §5.1).
  { id: "diagnostics", labelKey: "settings.tab.diagnostics", icon: SettingsIcon },
  // Update surfaced out of the buried 데이터 section into its own tab below 진단.
  { id: "update", labelKey: "settings.tab.update", icon: Download },
];


// ---------- Reusable bits ----------


// ---------- Tabs ----------


// ---------- Diagnostics ----------


// ---------- Root ----------

interface SettingsPanelProps {
  /** When true, render flush with the surrounding page (no card chrome, no
   *  duplicate "Settings" heading). Use this inside a workspace that already
   *  provides its own page header. Defaults to false (modal/standalone). */
  embedded?: boolean;
}

export function SettingsPanel({ embedded = false }: SettingsPanelProps) {
  const { t } = useT();
  const [tab, setTab] = useState<TabId>("appearance");
  const [error, setError] = useState<string | null>(null);
  const { loaded } = useSettings();

  const activeTab = useMemo(() => {
    switch (tab) {
      case "appearance":
        return <AppearanceTab />;
      case "llm":
        return <LlmTab onError={setError} />;
      case "code":
        // 원시 요소는 이 파일이 소유한다 (Section/Field/Toggle) — 새 탭 하나를
        // 위해 디자인 시스템을 복제하지 않고 그대로 내려 준다.
        return <CodeSettings Section={Section} Field={Field} Toggle={Toggle} />;
      case "indexing":
        return <IndexingTab />;
      case "graph":
        return <GraphTab />;
      case "data":
        return <DataTab onError={setError} />;
      case "oculpm":
        return <OculpmSettings />;
      case "mobile":
        return <MobileSettings Section={Section} Field={Field} />;
      case "diagnostics":
        return <DiagnosticsTab onError={setError} />;
      case "update":
        return <UpdateTab />;
    }
  }, [tab]);

  if (!loaded) {
    return (
      <div className={embedded ? "" : "w-full max-w-4xl rounded-xl border bg-card p-6 shadow-sm"}>
        <span className="text-sm text-muted-foreground">Loading settings…</span>
      </div>
    );
  }

  // 탭 내비게이션은 두 진입점에서 모양이 다르다.
  //
  // 프로젝트 안(embedded)에서는 왼쪽에 이미 앱 사이드바가 있어서, 세로 192px
  // 열을 하나 더 세우면 '사이드바 속 사이드바' 가 된다 (2026-07-30 디자인
  // 라운드). embedded 일 때만 가로 스트립으로 눕혀 좌측 열을 없앤다. 좁은
  // 창에서는 압착 대신 가로 스크롤로 도망가게 한다 — 툴바 액션과 같은 방어책
  // 으로, 없으면 flex 압착이 CJK 라벨을 한 글자씩 세로로 꺾는다.
  //
  // 프로젝트 선택 화면(비-embedded)은 사이드바가 없는 모달이라 세로 목록이
  // 여전히 맞다.
  const tabNav = embedded ? (
    <nav
      className="flex items-center gap-1 overflow-x-auto border-b border-border/60 px-1 pb-2 mb-5"
      style={{ scrollbarWidth: "none" }}
    >
      {TABS.map((entry) => {
        const isActive = tab === entry.id;
        return (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            aria-current={isActive ? "page" : undefined}
            className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            }`}
          >
            {t(entry.labelKey)}
          </button>
        );
      })}
    </nav>
  ) : (
    <nav className="w-48 flex-shrink-0 border-r border-border/60 bg-background/40 p-2 space-y-0.5">
      {TABS.map((entry) => {
        const Icon = entry.icon;
        const isActive = tab === entry.id;
        return (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            aria-current={isActive ? "page" : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {t(entry.labelKey)}
          </button>
        );
      })}
    </nav>
  );

  const body = (
    <div className={embedded ? "flex flex-col" : "flex"}>
      {tabNav}

      {/* Tab content */}
      <div
        className={`flex-1 ${
          embedded ? "pb-6" : "p-6 overflow-y-auto max-h-[70vh] scrollbar-thin"
        }`}
      >
        {activeTab}
        {error && (
          <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-xs hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) {
    return <div className="w-full">{body}</div>;
  }

  return (
    <section className="w-full max-w-4xl rounded-xl border bg-card shadow-sm overflow-hidden">
      <header className="px-6 py-4 border-b border-border/60 flex items-center gap-2">
        <SettingsIcon className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-semibold tracking-tight">{t("shell.settings.title")}</h2>
      </header>
      {body}
    </section>
  );
}
