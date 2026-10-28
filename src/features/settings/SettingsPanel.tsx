import { useEffect, useMemo, useRef, useState } from "react";
import { consumeSettingsTab, onOpenSettingsRequest } from "@/lib/settingsNav";
import { OculSpinner } from "@/components/OculSpinner";
import {
  Sun,
  Cpu,
  Database,
  Settings as SettingsIcon,
  FileCode,
  Clock,
  Download,
  Search,
  X,
  ChevronRight,
  type IconComponent,
} from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { AppearanceTab } from "./tabs/AppearanceTab";
import { LlmTab } from "./tabs/LlmTab";
import { IndexingTab } from "./tabs/IndexingTab";
import { DataTab } from "./tabs/DataTab";
import { DiagnosticsTab } from "./tabs/DiagnosticsTab";
import { UpdateTab } from "./tabs/UpdateTab";
// 상수·클램프만 있는 모듈이다 — TerminalSurface 에서 가져오면 설정 청크가
// xterm 을 통째로 끌고 온다.
import { useDensity } from "@/hooks/useDensity";
import { useT, type I18nKey } from "@/i18n";
import { OculpmSettings } from "./OculpmSettings";
import { AutomationTab } from "./automation/AutomationTab";
import { SettingsSearchResults } from "./SettingsSearch";
import { searchSettings } from "./settingsIndex";
import type { SettingsTab } from "./settingsIndex";
import "./settings.css";

/** 탭 목록의 정본은 아래 `GROUPS`, 이름의 정본은 `settingsIndex.SettingsTab` 이다 —
 *  검색 색인이 없는 탭이 생기지 않게 한쪽에서만 정의한다. */
type TabId = SettingsTab;

interface TabDef {
  id: TabId;
  labelKey: I18nKey;
  /** 탭을 열었을 때 "여기가 무엇을 정하는 자리인가" 를 말하는 한 문장. */
  descKey: I18nKey;
  icon: IconComponent;
}

/**
 * 열 탭을 다섯 묶음으로 (2026-09-09 재설계 · 모바일·그래프 탭은 2026-10-24 제거).
 *
 * 예전엔 그룹 없이 한 줄에 섰다 — 「그래프」와 「모바일」과 「진단」이 같은
 * 위계로 읽혔고, 좁은 창에서는 그 줄이 가로 스크롤로 도망가 대여섯만 보였다.
 * 묶음의 기준은 **사용자가 무엇을 고치러 왔는가** 다: 앱의 겉모습이냐(일반),
 * 모델이냐(AI), 기록 방식이냐(작업 기록), 코드를 읽는 방식이냐(코드),
 * 기계·데이터냐(시스템).
 */
const GROUPS: Array<{ labelKey: I18nKey; tabs: TabDef[] }> = [
  {
    labelKey: "settings.group.general",
    tabs: [
      { id: "appearance", labelKey: "settings.tab.appearance", descKey: "settings.tabDesc.appearance", icon: Sun },
      { id: "update", labelKey: "settings.tab.update", descKey: "settings.tabDesc.update", icon: Download },
    ],
  },
  {
    labelKey: "settings.group.ai",
    tabs: [
      { id: "llm", labelKey: "settings.tab.llm", descKey: "settings.tabDesc.llm", icon: Cpu },
      // 컨텍스트 경제학 (Osaurus 라운드 Phase 5) — 항상 가는 것 · 매니페스트 ·
      // 회상 후보 · 예산. 데이터는 다 갖고 있었는데 볼 창이 없던 자리다.
    ],
  },
  {
    labelKey: "settings.group.journal",
    tabs: [
      { id: "oculpm", labelKey: "settings.tab.oculpm", descKey: "settings.tabDesc.oculpm", icon: FileCode },
      // 자동화 — 스케줄·감시 (Osaurus 라운드 Phase 1). 새 화면을 만들지 않고
      // "설정에 가까운 관리면" 이라 여기 산다 (01-automation.md §1.3).
      { id: "automation", labelKey: "settings.tab.automation", descKey: "settings.tabDesc.automation", icon: Clock },
    ],
  },
  {
    labelKey: "settings.group.code",
    tabs: [
      // 코드 화면 — 편집기 동작 + 언어 서버 (ide-completion #lsp-settings-screen).
      { id: "indexing", labelKey: "settings.tab.indexing", descKey: "settings.tabDesc.indexing", icon: FileCode },
    ],
  },
  {
    labelKey: "settings.group.system",
    tabs: [
      { id: "data", labelKey: "settings.tab.data", descKey: "settings.tabDesc.data", icon: Database },
      // Diagnostics absorbed from the old separate sidebar tab (MASTER-GUIDE §5.1).
      { id: "diagnostics", labelKey: "settings.tab.diagnostics", descKey: "settings.tabDesc.diagnostics", icon: SettingsIcon },
    ],
  },
];

// GitHub PAT 탭은 감사(2026-07-16)에서 제거 — 소비처가 verify 뿐이라 vestigial
// 이었고, 로컬 git 은 토큰 없이 동작한다 (git_log/status 는 git CLI).
const ALL_TABS: TabDef[] = GROUPS.flatMap((g) => g.tabs);
/** 간단 밀도가 처음부터 보여 주는 탭 — 겉모습 · 기록 방식 · 데이터. 나머지는 「전문」 뒤. */
const SIMPLE_TABS: ReadonlySet<TabId> = new Set<TabId>(["appearance", "oculpm", "data"]);

export function SettingsPanel() {
  const { t } = useT();
  const { density } = useDensity();
  const [moreOpen, setMoreOpen] = useState(false);
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
  // 결과 목록의 키보드 커서. 마우스 없이 ↑↓+Enter 로 항목까지 간다 — 검색은
  // 손이 이미 키보드에 있을 때 쓰는 물건이라, 결과를 마우스로 집게 하면
  // 검색으로 아낀 시간을 거기서 도로 쓴다.
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const { loaded } = useSettings();

  const trimmed = query.trim();
  const hits = useMemo(() => (trimmed ? searchSettings(trimmed) : []), [trimmed]);
  useEffect(() => setCursor(0), [trimmed]);

  const activeTab = useMemo(() => {
    switch (tab) {
      case "appearance":
        return <AppearanceTab />;
      case "llm":
        return <LlmTab onError={setError} />;
      case "indexing":
        return <IndexingTab />;
      case "data":
        return <DataTab onError={setError} />;
      case "oculpm":
        return <OculpmSettings />;
      case "automation":
        return <AutomationTab />;
      case "diagnostics":
        return <DiagnosticsTab onError={setError} />;
      case "update":
        return <UpdateTab />;
    }
  }, [tab]);

  if (!loaded) return <OculSpinner size={22} label={t("common.loading")} />;

  const current = ALL_TABS.find((entry) => entry.id === tab) ?? ALL_TABS[0];
  const pro = density === "pro";

  function pick(next: TabId) {
    setTab(next);
    setQuery("");
    setError(null);
  }

  return (
    // 바깥 껍데기가 컨테이너다 (settings.css `.cfg-shell`). `.cfg` 자신에게
    // container-type 을 주면 `@container cfg` 안의 `.cfg { … }` 는 **자기
    // 자신**을 조회할 수 없어 영영 안 걸린다 — 좁은 창에서 레일만 100% 가
    // 되고 본문은 0px 로 사라지던 버그 (2026-09-11).
    <div className="cfg-shell">
    <div className="cfg">
      {/* 목차 — 채워진 패널이 아니다. 앱 사이드바와 같은 문법을 쓰면 '사이드바
          속 사이드바' 가 되므로 배경 없이 캔버스 위에 얹는다 (settings.css). */}
      <div className="cfg-rail">
        <div className="search-box cfg-search">
          <Search size={13} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                // 질의를 지우고 탭으로 돌아간다 — 모달을 닫지 않는다.
                e.stopPropagation();
                setQuery("");
                return;
              }
              if (!hits.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => (c + 1) % hits.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => (c - 1 + hits.length) % hits.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(hits[cursor].tab);
              }
            }}
            placeholder={t("settings.search.placeholder")}
            aria-label={t("settings.search.placeholder")}
          />
          {query && (
            <button
              type="button"
              className="cfg-search-clear"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              title={t("settings.search.clear")}
              aria-label={t("settings.search.clear")}
            >
              <X size={11} />
            </button>
          )}
        </div>

        <nav className="cfg-nav">
          {GROUPS.map((group) => {
            // 간단 밀도: 세 탭만 보이고 나머지는 「전문 ▸」 뒤에 접힌다. 지금 열린
            // 탭이 접힌 쪽이면 저절로 펼친다 — 지금 있는 곳이 안 보이면 안 된다.
            const tabs = pro || moreOpen ? group.tabs : group.tabs.filter((e) => SIMPLE_TABS.has(e.id) || e.id === tab);
            if (tabs.length === 0) return null;
            return (
            <div key={group.labelKey} className="cfg-group">
              <div className="cfg-group-label">{t(group.labelKey)}</div>
              {tabs.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => pick(entry.id)}
                    aria-current={!trimmed && tab === entry.id ? "page" : undefined}
                    className="cfg-item"
                  >
                    <Icon size={13} />
                    <span>{t(entry.labelKey)}</span>
                  </button>
                );
              })}
            </div>
            );
          })}
          {!pro ? (
            <button
              type="button"
              className="cfg-item cfg-more"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
            >
              <ChevronRight size={11} className={"nav-section-chev" + (moreOpen ? " open" : "")} />
              <span>{t("settings.moreTabs", { n: ALL_TABS.length - SIMPLE_TABS.size })}</span>
            </button>
          ) : null}
          {/* 접힌 탭의 이름 — 「전문 · 7」 만 보면 그 뒤에 무엇이 있는지 모른다 (시안 F). */}
          {!pro && !moreOpen ? (
            <p className="cfg-more-list">
              {ALL_TABS.filter((e) => !SIMPLE_TABS.has(e.id) && e.id !== tab).map((e) => t(e.labelKey)).join(" · ")}
            </p>
          ) : null}
        </nav>
      </div>

      <div className="cfg-main">
        {trimmed ? (
          <>
            <div className="cfg-head">
              <h2>{t("settings.search.placeholder")}</h2>
              <p>{t("settings.search.count", { n: hits.length })}</p>
            </div>
            <SettingsSearchResults query={trimmed} cursor={cursor} onPick={(entry) => pick(entry.tab)} />
          </>
        ) : (
          <>
            <div className="cfg-head">
              <h2>{t(current.labelKey)}</h2>
              <p>{t(current.descKey)}</p>
            </div>
            <div className="cfg-sections">{activeTab}</div>
          </>
        )}
        {error && (
          <div className="cfg-error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn sm" onClick={() => setError(null)}>
              {t("common.dismiss")}
            </button>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
