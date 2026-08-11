/**
 * 화면 크롬 — 상단 레일(밴드 0) / 검색 밴드(밴드 1) / 액션 바(밴드 4).
 */
import { Folder, Plus, Search, Settings } from "@/components/Icons";

import { BriefFootnote } from "./atoms";
import { useT } from "@/i18n";
import type { HomeRow } from "./homeModel";

// ── 밴드 0 — 상단 레일 ──────────────────────────────────────────────────

/**
 * macOS 는 `titleBarStyle: Overlay` 라 웹뷰가 창 최상단까지 올라오고 잡을
 * 타이틀바가 없다. 예전 화면은 34px 투명 스트립을 `fixed` 로 덮어 뒀는데,
 * 그건 `pointer-events` 해제가 없어 그 아래 클릭을 전부 삼키는 데드존이었다.
 * 이제 상단 레일 자체가 드래그 영역이고, 그 안의 버튼·입력만 예외가 된다
 * (Tauri 는 `data-tauri-drag-region` 이 붙은 엘리먼트에서만 드래그를 시작하고
 * 자식 인터랙티브 요소는 자기 이벤트를 먼저 가져간다).
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
      <span className="home-rule" aria-hidden="true" data-tauri-drag-region />
      <p className="home-dateline" data-tauri-drag-region>
        {dateline}
      </p>

      <span className="ml-auto flex items-center gap-2">
        {failed && <BriefFootnote onRetry={onRetry} />}
        {/* 관리는 **글자**로 둔다. 아이콘 하나로는 "설정"과 구별되지 않고,
            프로젝트를 지우러 오는 사람이 아이콘 수수께끼를 풀 이유가 없다. */}
        <button type="button" onClick={onManage} className="home-chipbtn">
          <Folder className="w-3.5 h-3.5" />
          {t("home.manageProjects")}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="home-iconbtn"
          aria-label={t("home.openSettings")}
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-s)] bg-[var(--accent)] text-[var(--text-on-accent)] text-[12px] font-bold hover:bg-[var(--accent-strong)] transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("home.addProject")}
        </button>
      </span>
    </div>
  );
}

// ── 밴드 1 — 검색 ──────────────────────────────────────────────────────

/**
 * 검색을 상단 레일에서 꺼내 **전용 밴드**로 승격했다. 프로젝트가 10개를
 * 넘어가면 목록을 눈으로 훑는 것보다 세 글자 치는 게 빠른데, 검색이 툴바
 * 구석의 작은 입력이면 그 사실이 발견되지 않는다.
 */
export function HomeSearchBand({
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
      <Search className="w-[18px] h-[18px] text-[var(--text-3)] shrink-0" aria-hidden="true" />
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
      <span className="home-count">{searching ? t("home.matchCount", { n: matchCount }) : t("home.totalCount", { n: total })}</span>
      <kbd className="home-kbd" aria-hidden="true">
        /
      </kbd>
    </div>
  );
}

// ── 밴드 4 — 액션 바 ───────────────────────────────────────────────────

/**
 * 커서 항목에 무엇을 할 수 있는지 **상시** 노출한다. 인타일 버튼을 대체하는
 * 것이 아니라 보조한다 — 포인터가 이 바로 내려가는 동안 커서가 재할당돼
 * 대상이 바뀌면 안 되므로, 여기 있는 것은 안내이지 버튼이 아니다.
 */
export function HomeActionBar({ row }: { row: HomeRow | null }) {
  const { t } = useT();
  const name =
    row?.kind === "project"
      ? row.project.name
      : row?.kind === "draft"
        ? row.bp.name || t("home.stepDraft")
        : row?.kind === "command"
          ? row.label
          : null;

  return (
    <div className="home-actionbar" role="status" aria-live="off">
      <span className="font-semibold text-[var(--text)] truncate max-w-[220px]">
        {name ?? t("home.pickProject")}
      </span>
      <span className="home-actionbar-item">
        <kbd className="home-kbd">⏎</kbd> {t("home.kbdOpen")}
      </span>
      {row?.kind === "project" && (
        <>
          <span className="home-actionbar-item">
            <kbd className="home-kbd">⌘E</kbd> {t("home.kbdRename")}
          </span>
          <span className="home-actionbar-item">
            <kbd className="home-kbd">⌘⌫</kbd> {t("home.kbdRemove")}
          </span>
        </>
      )}
      <span className="ml-auto flex items-center gap-4">
        <span className="home-actionbar-item">
          <kbd className="home-kbd">↑↓</kbd> {t("home.kbdMove")}
        </span>
        <span className="home-actionbar-item">
          <kbd className="home-kbd">⌘K</kbd> {t("home.kbdPalette")}
        </span>
      </span>
    </div>
  );
}
