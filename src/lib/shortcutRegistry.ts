import type { I18nKey } from "@/i18n";
import { NAV_ENTRIES, navShortcutLabel } from "@/lib/navRegistry";
import { kbd } from "@/lib/kbd";
import { isMac } from "@/lib/platform";

// 키보드 단축키의 단일 목록 (완성도 라운드 Phase 2, 2026-08-30).
//
// 화면 이동(⌘1~⌘0)은 `navRegistry` 배열 순서에서 **계산**하므로 사이드바·
// 팔레트·치트시트가 어긋날 수 없다. 나머지는 각 화면의 keydown 핸들러가
// 실제로 듣는 키를 여기 옮겨 적은 것이다 — 핸들러를 바꾸면 이 표도 같이
// 바꾼다 (`src/__tests__/polish_phase2.test.tsx` 가 중복 조합을 잡는다).
//
// 앱 메뉴 가속키(⌘T·⇧⌘N·⌘W·⇧⌘W)는 Rust `menu.rs` 가 정본이다. 프런트에서
// 읽을 수 없어 값을 옮겨 적었다.
//
// 키는 **맥 표기로 적는다** (크로스플랫폼 라운드 {#ui-labels}). Windows·Linux 는
// `buildShortcutGroups` 가 `kbd()` 로 옮긴다 — 터미널 그룹은 터미널 가족
// (⌘D → Ctrl+Shift+D, 셸이 Ctrl+글자를 갖는다). 그 OS 에 없는 키는 `nonMac`
// 으로 다른 표기를 주거나 `null` 로 뺀다.

export interface ShortcutRow {
  /** 표시용 키 — `⌘K`, `⇧⌘F`, `⌃Tab`, `j / k`. 맥 표기가 정본이다. */
  keys: string;
  labelKey: I18nKey;
  /**
   * Windows·Linux 표기를 따로 줄 때. `null` 이면 그 OS 에서는 줄을 뺀다 — 앱이
   * 그 키를 받을 길이 없다(메뉴 전용). 없으면 `keys` 를 `kbd()` 로 옮긴다.
   */
  nonMac?: string | null;
  /** Windows·Linux 에서만 보이는 줄 — 맥에는 해당 없는 안내(터미널 복사·붙여넣기). */
  nonMacOnly?: true;
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
    { keys: "⌘[ / ⌘]", labelKey: "keys.navHistory" },
    // 터미널 안에서 Ctrl+글자는 셸의 것이다 (lib/kbd.ts) — 그 자리의 앱 단축키.
    { keys: "Ctrl+Shift+…", labelKey: "keys.inTerminal", nonMacOnly: true },
  ],
};

const WINDOW: ShortcutGroup = {
  id: "window",
  titleKey: "keys.g.window",
  rows: [
    { keys: "⌘T", labelKey: "keys.newTab" },
    // 새 창은 앱 메뉴에만 있다 — Windows·Linux 에서 프런트가 받을 길이 없다.
    { keys: "⇧⌘N", labelKey: "keys.newWindow", nonMac: null },
    { keys: "⌘W", labelKey: "keys.closeTab" },
    // Windows·Linux 는 네이티브 제목줄 — 창 닫기는 OS 의 키다.
    { keys: "⇧⌘W", labelKey: "keys.closeWindow", nonMac: "Alt+F4" },
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
    // 맥의 ⌘W·⌘C·⌘V 는 메뉴가 받는다. Windows·Linux 터미널에서는 Ctrl+W·C·V 가
    // 셸의 것이라(단어 지우기·인터럽트·문자 그대로) Shift 가족으로 받는다.
    { keys: "⌘W", labelKey: "keys.termClosePane", nonMacOnly: true },
    { keys: "Ctrl+Shift+C / Ctrl+Shift+V", labelKey: "keys.termCopyPaste", nonMacOnly: true },
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
    // 트리 — 드래그를 못 쓰는 손에게는 이 줄들이 곧 '옮기기 기능'이다.
    { keys: "↑ / ↓", labelKey: "keys.treeMove" },
    { keys: "← / →", labelKey: "keys.treeFold" },
    { keys: "Space", labelKey: "keys.treePick" },
    { keys: "⌘X / ⌘V", labelKey: "keys.treeCutPaste" },
    { keys: "⌫", labelKey: "keys.treeDelete" },
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
  const groups = [navShortcutGroup(), GLOBAL, WINDOW, TERMINAL, CODE, JOURNAL, SEARCH, DIFF, START];
  return groups.map(isMac() ? forMac : forOtherOs);
}

/** macOS — 표기는 적힌 그대로. 맥에 해당 없는 안내 줄만 뺀다. */
function forMac(g: ShortcutGroup): ShortcutGroup {
  return { ...g, rows: g.rows.filter((r) => !r.nonMacOnly) };
}

/** Windows·Linux — 이 OS 의 표기로 옮기고, 그 OS 에 없는 키는 뺀다. */
function forOtherOs(g: ShortcutGroup): ShortcutGroup {
  const context = g.id === "terminal" ? "terminal" : "app";
  const rows: ShortcutRow[] = [];
  for (const r of g.rows) {
    if (r.nonMac === null) continue;
    rows.push({ keys: r.nonMac ?? kbd(r.keys, context), labelKey: r.labelKey });
  }
  return { ...g, rows };
}
