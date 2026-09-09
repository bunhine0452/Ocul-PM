/**
 * 설정 검색 결과 — 레일의 검색 입력이 질의를 갖는 동안 본문 자리에 뜬다
 * (3.0 {#settings-search}).
 *
 * 탭과 결과를 동시에 보여 주지 않는 것은 그대로다 — 어느 쪽이 지금 보고 있는
 * 것인지 흐려진다. 2026-09-09 재설계에서 입력만 `SettingsPanel` 의 레일 머리로
 * 옮겼다: 예전엔 가로 탭 줄 **끝**에 붙은 176px 짜리라, 탭이 넘쳐 가로
 * 스크롤이 생기는 좁은 창에서 검색창이 화면 밖으로 밀려나 있었다 — 정확히
 * 검색이 가장 필요한 폭에서.
 *
 * 커서(`cursor`)는 패널이 소유한다. 입력에 포커스가 있는 채로 ↑↓ 를 눌러야
 * 하므로 상태가 입력과 같은 컴포넌트에 있어야 한다.
 */
import { useT, type I18nKey } from "@/i18n";
import { entryLabel, searchSettings, type SettingsEntry, type SettingsTab } from "./settingsIndex";

/** 탭 id → 탭 이름 사전 키. `SettingsPanel.GROUPS` 와 같은 표. */
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

export function SettingsSearchResults({
  query,
  cursor,
  onPick,
}: {
  query: string;
  /** 키보드 커서의 위치 — 입력이 포커스를 쥔 채 ↑↓ 로 움직인다. */
  cursor?: number;
  onPick: (entry: SettingsEntry) => void;
}) {
  const { t } = useT();
  const hits = searchSettings(query);

  if (hits.length === 0) {
    return <p className="cfg-empty">{t("settings.search.empty")}</p>;
  }

  return (
    <div className="cfg-results">
      {hits.map((entry, i) => (
        <button
          key={`${entry.tab}:${entry.key}`}
          type="button"
          className="cfg-result"
          data-active={i === cursor ? "true" : undefined}
          onClick={() => onPick(entry)}
        >
          <span className="cfg-result-name">{entryLabel(entry.key)}</span>
          <span className="cfg-result-where">
            {t(TAB_LABEL[entry.tab])}
            {entry.section ? ` · ${entryLabel(entry.section)}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
