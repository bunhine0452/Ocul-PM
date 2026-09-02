import type { I18nKey } from "@/i18n";
import { NAV_ENTRIES, navShortcutLabel } from "@/lib/navRegistry";

// 키보드 단축키의 단일 목록 (완성도 라운드 Phase 2, 2026-08-30).
//
// 화면 이동(⌘1~⌘0)은 `navRegistry` 배열 순서에서 **계산**하므로 사이드바·
// 팔레트·치트시트가 어긋날 수 없다. 나머지는 각 화면의 keydown 핸들러가
// 실제로 듣는 키를 여기 옮겨 적은 것이다 — 핸들러를 바꾸면 이 표도 같이
// 바꾼다 (`src/__tests__/polish_phase2.test.tsx` 가 중복 조합을 잡는다).
//
// 앱 메뉴 가속키(⌘T·⇧⌘N·⌘W·⇧⌘W)는 Rust `menu.rs` 가 정본이다. 프런트에서
// 읽을 수 없어 값을 옮겨 적었다.

export interface ShortcutRow {
  /** 표시용 키 — `⌘K`, `⇧⌘F`, `⌃Tab`, `j / k`. */
  keys: string;
  labelKey: I18nKey;
}

export interface ShortcutGroup {
  id: string;
  titleKey: I18nKey;
  rows: ShortcutRow[];
}

const GLOBAL: ShortcutGroup = {
  id: "global",
  titleKey: "keys.g.global",
  rows: [
    { keys: "⌘K", labelKey: "keys.palette" },
    { keys: "⌘P", labelKey: "keys.switchProject" },
    { keys: "⌘J", labelKey: "keys.dock" },
    { keys: "⌘,", labelKey: "keys.settings" },
    { keys: "⌘\\", labelKey: "keys.ai" },
    { keys: "⌘/", labelKey: "keys.cheatsheet" },
  ],
};

const WINDOW: ShortcutGroup = {
  id: "window",
  titleKey: "keys.g.window",
  rows: [
    { keys: "⌘T", labelKey: "keys.newTab" },
    { keys: "⇧⌘N", labelKey: "keys.newWindow" },
    { keys: "⌘W", labelKey: "keys.closeTab" },
    { keys: "⇧⌘W", labelKey: "keys.closeWindow" },
    { keys: "⌃Tab / ⌃⇧Tab", labelKey: "keys.cycleTabs" },
    { keys: "⌘⌥← / ⌘⌥→", labelKey: "keys.moveTabs" },
  ],
};

const TERMINAL: ShortcutGroup = {
  id: "terminal",
  titleKey: "keys.g.terminal",
  rows: [
    { keys: "⌘T", labelKey: "keys.termNewTab" },
    { keys: "⌘D", labelKey: "keys.termSplit" },
    { keys: "⇧⌘D", labelKey: "keys.termSplitDown" },
    { keys: "⌘F", labelKey: "keys.termFind" },
    { keys: "⌘L", labelKey: "keys.termClear" },
    { keys: "⌘↑ / ⌘↓", labelKey: "keys.termBlocks" },
    { keys: "⌘= / ⌘−", labelKey: "keys.termFont" },
    { keys: "⇧⌘0", labelKey: "keys.termFontReset" },
  ],
};

const CODE: ShortcutGroup = {
  id: "code",
  titleKey: "keys.g.code",
  rows: [
    { keys: "⇧⌘F", labelKey: "keys.codeSearch" },
    { keys: "⌘N", labelKey: "keys.codeNew" },
    { keys: "⌘S", labelKey: "keys.codeSave" },
    { keys: "⇧⌘O", labelKey: "keys.codeGotoSymbol" },
    { keys: "⌃G", labelKey: "keys.codeGotoLine" },
    { keys: "F12", labelKey: "keys.codeDef" },
    { keys: "⇧F12", labelKey: "keys.codeRefs" },
    { keys: "F2", labelKey: "keys.codeRename" },
    { keys: "⇧⌥F", labelKey: "keys.codeFormat" },
    { keys: "⌘.", labelKey: "keys.codeAction" },
    { keys: "⇧⌘T", labelKey: "keys.codeReopen" },
    { keys: "⇧⌘] / ⇧⌘[", labelKey: "keys.codeCycle" },
  ],
};

const JOURNAL: ShortcutGroup = {
  id: "journal",
  titleKey: "keys.g.journal",
  rows: [
    { keys: "⌘F", labelKey: "keys.journalFind" },
    { keys: "⌘N", labelKey: "keys.journalNew" },
    { keys: "Esc", labelKey: "keys.entryBack" },
    { keys: "j / k", labelKey: "keys.entryMove" },
    { keys: "/", labelKey: "keys.entryFilter" },
  ],
};

const SEARCH: ShortcutGroup = {
  id: "search",
  titleKey: "keys.g.search",
  rows: [
    { keys: "⌘F", labelKey: "keys.searchFocus" },
    { keys: "⌘N", labelKey: "keys.searchReset" },
  ],
};

const DIFF: ShortcutGroup = {
  id: "diff",
  titleKey: "keys.g.diff",
  rows: [
    { keys: "/", labelKey: "keys.diffFind" },
    { keys: "n / N", labelKey: "keys.diffNext" },
    { keys: "j / k", labelKey: "keys.diffFiles" },
    { keys: "f", labelKey: "keys.diffFilter" },
  ],
};

const START: ShortcutGroup = {
  id: "start",
  titleKey: "keys.g.start",
  rows: [
    { keys: "⌘O", labelKey: "keys.startAdd" },
    { keys: "⌘N", labelKey: "keys.startNew" },
    { keys: "⇧⌘M", labelKey: "keys.startManage" },
    { keys: "⌘E", labelKey: "keys.startRename" },
    { keys: "⌘⌫", labelKey: "keys.startDelete" },
    { keys: "⌘F", labelKey: "keys.startFind" },
  ],
};

/** 화면 이동 그룹 — navRegistry 에서 파생. ⌘번호가 없는 11번째 이후 화면은 뺀다. */
export function navShortcutGroup(): ShortcutGroup {
  return {
    id: "nav",
    titleKey: "keys.g.nav",
    rows: NAV_ENTRIES.flatMap((e) => {
      const keys = navShortcutLabel(e.id);
      return keys ? [{ keys, labelKey: e.labelKey }] : [];
    }),
  };
}

/** 치트시트가 그리는 순서 — 전역과 화면 이동이 먼저, 화면별 로컬 키가 뒤. */
export function buildShortcutGroups(): ShortcutGroup[] {
  return [navShortcutGroup(), GLOBAL, WINDOW, TERMINAL, CODE, JOURNAL, SEARCH, DIFF, START];
}
