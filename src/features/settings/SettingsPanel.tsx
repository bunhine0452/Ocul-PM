import { useEffect, useMemo, useState } from "react";
import { consumeSettingsTab, onOpenSettingsRequest } from "@/lib/settingsNav";
import { OculSpinner } from "@/components/OculSpinner";
import {
  Sun,
  Cpu,
  Database,
  Smartphone,
  GitBranch,
  Settings as SettingsIcon,
  FileCode,
  Code2,
  Clock,
  PieChart,
  Download,
  type IconComponent,
} from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { Section, Field, Toggle } from "./tabs/ui";
import { AppearanceTab } from "./tabs/AppearanceTab";
import { LlmTab } from "./tabs/LlmTab";
import { IndexingTab } from "./tabs/IndexingTab";
import { GraphTab } from "./tabs/GraphTab";
import { DataTab } from "./tabs/DataTab";
import { ContextTab } from "./tabs/ContextTab";
import { DiagnosticsTab } from "./tabs/DiagnosticsTab";
import { UpdateTab } from "./tabs/UpdateTab";
export { NotionSection } from "./tabs/DataTab";
// 상수·클램프만 있는 모듈이다 — TerminalSurface 에서 가져오면 설정 청크가
// xterm 을 통째로 끌고 온다.
import { useT, type I18nKey } from "@/i18n";
import { OculpmSettings } from "./OculpmSettings";
import { AutomationTab } from "./automation/AutomationTab";
import { CodeSettings } from "./CodeSettings";
import { MobileSettings } from "./MobileSettings";
import { SettingsSearchBox, SettingsSearchResults } from "./SettingsSearch";
import type { SettingsTab } from "./settingsIndex";

/** 탭 목록의 정본은 아래 `TABS`, 이름의 정본은 `settingsIndex.SettingsTab` 이다 —
 *  검색 색인이 없는 탭이 생기지 않게 한쪽에서만 정의한다. */
type TabId = SettingsTab;

const TABS: Array<{ id: TabId; labelKey: I18nKey; icon: IconComponent }> = [
  { id: "appearance", labelKey: "settings.tab.appearance", icon: Sun },
  { id: "llm", labelKey: "settings.tab.llm", icon: Cpu },
  // GitHub PAT 탭은 감사(2026-07-16)에서 제거 — 소비처가 verify 뿐이라 vestigial
  // 이었고, 로컬 git 은 토큰 없이 동작한다 (git_log/status 는 git CLI).
  // 코드 화면 — 편집기 동작 + 언어 서버 (ide-completion #lsp-settings-screen).
  { id: "code", labelKey: "settings.tab.code", icon: Code2 },
  { id: "indexing", labelKey: "settings.tab.indexing", icon: FileCode },
  { id: "graph", labelKey: "settings.tab.graph", icon: GitBranch },
  { id: "data", labelKey: "settings.tab.data", icon: Database },
  { id: "oculpm", labelKey: "settings.tab.oculpm", icon: FileCode },
  // 컨텍스트 경제학 (Osaurus 라운드 Phase 5) — 항상 가는 것 · 매니페스트 ·
  // 회상 후보 · 예산. 데이터는 다 갖고 있었는데 볼 창이 없던 자리다.
  { id: "context", labelKey: "settings.tab.context", icon: PieChart },
  // 자동화 — 스케줄·감시 (Osaurus 라운드 Phase 1). 새 화면을 만들지 않고
  // "설정에 가까운 관리면" 이라 여기 산다 (01-automation.md §1.3).
  { id: "automation", labelKey: "settings.tab.automation", icon: Clock },
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

export function SettingsPanel() {
  const { t } = useT();
  // 딥링크(`openSettings(tab)`) — 마운트 전에 온 요청은 여기서 회수하고, 떠 있는
  // 동안 온 요청은 구독으로 받는다. 안내 문구가 "설정 → 어디" 라고 말하는 대신
  // 버튼이 바로 그 탭을 연다.
  const [tab, setTab] = useState<TabId>(() => consumeSettingsTab() ?? "appearance");
  useEffect(
    () =>
      onOpenSettingsRequest((requested) => {
        if (requested) setTab(requested);
      }),
    [],
  );
  const [error, setError] = useState<string | null>(null);
  // 질의가 있으면 탭 내용 대신 결과가 뜬다 — 탭 선택은 그대로 살아 있어서
  // 질의를 지우면 보던 자리로 돌아온다.
  const [query, setQuery] = useState("");
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
      case "context":
        return <ContextTab />;
      case "automation":
        return <AutomationTab />;
      case "mobile":
        return <MobileSettings Section={Section} Field={Field} />;
      case "diagnostics":
        return <DiagnosticsTab onError={setError} />;
      case "update":
        return <UpdateTab />;
    }
  }, [tab]);

  if (!loaded) return <OculSpinner size={22} label={t("common.loading")} />;

  // 탭 내비게이션은 가로 스트립 하나다.
  //
  // 세로 192px 열을 세우면 왼쪽에 이미 앱 사이드바가 있는 화면에서 '사이드바
  // 속 사이드바' 가 된다 (2026-07-30 디자인 라운드). 좁은 창에서는 압착 대신
  // 가로 스크롤로 도망가게 한다 — 툴바 액션과 같은 방어책으로, 없으면 flex
  // 압착이 CJK 라벨을 한 글자씩 세로로 꺾는다.
  //
  // 세로 갈래는 2026-09-09 에 지웠다. "사이드바 없는 모달용" 이라는 사유로
  // 남아 있었지만 그 모달(SettingsOverlay)도 가로 스트립을 쓰고 있어서
  // 프로덕션 소비처가 0이었다 — 테스트만 그 갈래를 렌더했다.
  const search = (
    <SettingsSearchBox
      value={query}
      onChange={(v) => {
        setQuery(v);
        setError(null);
      }}
    />
  );

  const tabNav = (
    <div className="mb-5 flex items-center gap-2 border-b border-border/60 px-1 pb-2">
      <nav className="subnav min-w-0 flex-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? "page" : undefined}
            className="subnav-item"
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </nav>
      {search}
    </div>
  );

  const body = (
    <div className="flex flex-col">
      {tabNav}

      {/* Tab content */}
      <div className="flex-1 pb-6">
        {query.trim() ? (
          <SettingsSearchResults
            query={query}
            onPick={(entry) => {
              setTab(entry.tab);
              setQuery("");
            }}
          />
        ) : (
          activeTab
        )}
        {error && (
          <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-xs hover:underline cursor-pointer"
            >
              {t("common.dismiss")}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return <div className="w-full">{body}</div>;
}
