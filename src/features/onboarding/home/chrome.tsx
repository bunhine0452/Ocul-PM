/**
 * 화면 크롬 — 상단 레일 / 원장 머리(검색) / 흐름 머리 / 키 힌트.
 */
import { Folder, Plus, Search, Settings } from "@/components/Icons";

import { BriefFootnote } from "./atoms";
import { useT } from "@/i18n";

// ── 상단 레일 ──────────────────────────────────────────────────────────

/**
 * macOS 는 `titleBarStyle: Overlay` 라 웹뷰가 창 최상단까지 올라오고 잡을
 * 타이틀바가 없다. 상단 레일 자체가 드래그 영역이고, 그 안의 버튼·입력만
 * 예외가 된다 (Tauri 는 `data-tauri-drag-region` 이 붙은 엘리먼트에서만
 * 드래그를 시작하고 자식 인터랙티브 요소는 자기 이벤트를 먼저 가져간다).
 */
export function HomeTopRail({
  isMac,
  dateline,
  failed,
  onRetry,
  onManage,
  onOpenSettings,
  onAdd,
}: {
  isMac: boolean;
  dateline: string;
  failed: boolean;
  onRetry: () => void;
  /** 프로젝트 관리 화면 열기. */
  onManage: () => void;
  onOpenSettings: () => void;
  onAdd: () => void;
}) {
  const { t } = useT();
  return (
    <div className="home-rail" data-mac={isMac ? "1" : undefined} data-tauri-drag-region>
      <h1 className="home-wordmark" data-tauri-drag-region>
        Ocul-PM
      </h1>
      <p className="home-dateline" data-tauri-drag-region>
        {dateline}
      </p>

      <span className="home-rail-actions">
        {failed && <BriefFootnote onRetry={onRetry} />}
        {/* 관리는 **글자**로 둔다. 아이콘 하나로는 "설정"과 구별되지 않고,
            프로젝트를 지우러 오는 사람이 아이콘 수수께끼를 풀 이유가 없다. */}
        <button type="button" onClick={onManage} className="btn ghost sm">
          <Folder size={15} />
          {t("home.manageProjects")}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="home-iconbtn"
          aria-label={t("home.openSettings")}
        >
          <Settings size={15} />
        </button>
        <button type="button" onClick={onAdd} className="btn primary sm">
          <Plus size={15} />
          {t("home.addProject")}
        </button>
      </span>
    </div>
  );
}

// ── 원장 머리 — 검색 ───────────────────────────────────────────────────

/**
 * 검색은 원장의 머리다. 전폭 밴드였던 것을 왼쪽 칸 머리로 내렸다 — 오른쪽
 * 흐름 레일 위까지 뻗은 입력은 폭만 먹고 아무것도 거르지 않았다. 타입어헤드
 * (아무 데서나 글자를 치면 여기로 흘러든다)는 그대로라 발견성은 잃지 않는다.
 */
export function HomeSearch({
  value,
  onChange,
  inputRef,
  matchCount,
  total,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  matchCount: number;
  total: number;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { t } = useT();
  const searching = value.trim().length > 0;
  return (
    <div className="home-search">
      <Search size={15} className="home-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("home.searchProjects")}
        aria-label={t("home.searchProjects")}
        autoComplete="off"
        spellCheck={false}
      />
      <span className="home-count">
        {searching ? t("home.matchCount", { n: matchCount }) : t("home.totalCount", { n: total })}
      </span>
      <kbd className="home-kbd" aria-hidden="true">
        /
      </kbd>
    </div>
  );
}

// ── 키 힌트 ────────────────────────────────────────────────────────────

/**
 * 키보드 지도 — **고정 문구**다. 예전 액션 바는 커서 항목의 이름을 앞에
 * 세웠는데, 이름 길이가 바뀔 때마다 바닥 띠의 폭이 변해 줄바꿈이 생기고
 * 그 높이가 원장에서 빠져나갔다. 커서가 어디 있는지는 행의 강조가 이미
 * 말하므로 여기서는 손이 할 수 있는 일만 적는다.
 */
export function HomeKeyHints() {
  const { t } = useT();
  const items: Array<[string, string]> = [
    ["↑↓", t("home.kbdMove")],
    ["⏎", t("home.kbdOpen")],
    ["⌘E", t("home.kbdRename")],
    ["⌘⌫", t("home.kbdRemove")],
    ["⌘K", t("home.kbdPalette")],
  ];
  return (
    <span className="home-hints" aria-hidden="true">
      {items.map(([k, label]) => (
        <span key={k} className="home-hint">
          <kbd className="home-kbd">{k}</kbd> {label}
        </span>
      ))}
    </span>
  );
}
