/**
 * 설정 검색 — 탭 줄 옆의 작은 입력 하나 (3.0 {#settings-search}).
 *
 * 히어로 검색창을 만들지 않은 이유: 이 집의 어휘는 밀도다. 검색은 설정을
 * 여는 첫 동작이 아니라 **탭을 훑다 포기하는 순간**에 손이 가는 것이라,
 * 탭 줄과 같은 높이에 나란히 서는 게 맞다. 질의가 있으면 탭 내용 자리에
 * 결과 목록이 대신 뜬다 — 탭과 결과를 동시에 보여 주면 어느 쪽이 지금
 * 보고 있는 것인지 흐려진다.
 */
import { Search } from "@/components/Icons";
import { useT, type I18nKey } from "@/i18n";
import { entryLabel, searchSettings, type SettingsEntry, type SettingsTab } from "./settingsIndex";

/** 탭 id → 탭 이름 사전 키. `SettingsPanel.TABS` 와 같은 표. */
const TAB_LABEL: Record<SettingsTab, I18nKey> = {
  appearance: "settings.tab.appearance",
  llm: "settings.tab.llm",
  code: "settings.tab.code",
  indexing: "settings.tab.indexing",
  graph: "settings.tab.graph",
  data: "settings.tab.data",
  oculpm: "settings.tab.oculpm",
  context: "settings.tab.context",
  automation: "settings.tab.automation",
  mobile: "settings.tab.mobile",
  diagnostics: "settings.tab.diagnostics",
  update: "settings.tab.update",
};

export function SettingsSearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useT();
  return (
    // 크기는 인라인이다: `.search-box` 는 layer 밖(primitives.css)이라 Tailwind
    // 유틸리티(@layer utilities)로는 못 이긴다 — h-7/min-w-0 이 조용히 무시된다.
    <div className="search-box" style={{ height: 26, minWidth: 0, width: 176, flex: "none" }}>
      <Search style={{ width: 13, height: 13, flex: "none" }} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Esc 는 질의를 지우고 탭으로 돌아간다 — 모달을 닫지 않는다.
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={t("settings.search.placeholder")}
        aria-label={t("settings.search.placeholder")}
      />
    </div>
  );
}

export function SettingsSearchResults({
  query,
  onPick,
}: {
  query: string;
  onPick: (entry: SettingsEntry) => void;
}) {
  const { t } = useT();
  const hits = searchSettings(query);

  if (hits.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("settings.search.empty")}
      </p>
    );
  }

  return (
    <div className="subnav vertical">
      {hits.map((entry) => (
        <button
          key={`${entry.tab}:${entry.key}`}
          type="button"
          className="subnav-item"
          onClick={() => onPick(entry)}
        >
          <span className="truncate">{entryLabel(entry.key)}</span>
          <span className="ml-auto flex-none text-xs text-muted-foreground">
            {t(TAB_LABEL[entry.tab])}
            {entry.section ? ` · ${entryLabel(entry.section)}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
