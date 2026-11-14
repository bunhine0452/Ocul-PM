import type { I18nKey } from "@/i18n";
import { NAV_ENTRIES, navShortcutLabel } from "@/lib/navRegistry";
import { kbd } from "@/lib/kbd";
import { isMac } from "@/lib/platform";

// 키보드 단축키의 단일 목록 (완성도 라운드 Phase 2, 2026-08-30).
//
// 화면 이동(⌘1~⌘4)은 `navRegistry` 배열 순서에서 **계산**하므로 사이드바·
// 팔레트·치트시트가 어긋날 수 없다. 나머지는 각 화면의 keydown 핸들러가
// 실제로 듣는 키를 여기 옮겨 적은 것이다 — 핸들러를 바꾸면 이 표도 같이
// 바꾼다 (`src/__tests__/polish_phase2.test.tsx` 가 중복 조합을 잡는다).
//
// 앱 메뉴 가속키(⇧⌘N·⌘W)는 Rust `menu.rs` 가 정본이다. 프런트에서
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
    // 기다리는 세션으로 — 다시 누르면 다음 (features/shell/jumpWaiting.ts). 터미널 안의 그 밖 OS 는 Ctrl+Shift+J.
    { keys: "⌘J", labelKey: "keys.jumpWaiting" },
    { keys: "⌘O", labelKey: "keys.switchProject" },
    // ⌃숫자 · ⇧⌘숫자는 화면 전환 · 스크린샷과 겹친다 (features/shell/projectKeys.ts).
    // 누르고 있으면 최근 순 창 목록, 톡 누르면 직전 창 (features/shell/WindowSwitcher.tsx).
    { keys: "⌥Tab", nonMac: "Ctrl+`", labelKey: "keys.windowSwitch" },
    { keys: "⌥⌘1~9", nonMac: "Alt+1~9", labelKey: "keys.projectSlot" },
    { keys: "⌘,", labelKey: "keys.settings" },
    { keys: "⌘/", labelKey: "keys.cheatsheet" },
    { keys: "⌘[ / ⌘]", labelKey: "keys.navHistory" },
    // 탭과 함께 걷었던 ⌃Tab 은 화면 순환으로 돌아왔다 (ocul-next #nav-cycle).
    { keys: "⌃Tab / ⌃⇧Tab", labelKey: "keys.screenCycle" },
  ],
};

// 창 하나 = 프로젝트 하나 (4.0) — 탭 키(⌘T·⌘⌥←→)는 탭과 함께 걷었다.
const WINDOW: ShortcutGroup = {
  id: "window",
  titleKey: "keys.g.window",
  rows: [
    // 맥은 앱 메뉴, Windows·Linux 는 `useWindowKeys` 가 키다운으로 받는다 ({#os-new-window}).
    { keys: "⇧⌘N", labelKey: "keys.newWindow" },
    { keys: "⌘W", labelKey: "keys.closeWindow" },
  ],
};

// 오늘 (11-15) — `TodayScreenV2` 의 keydown 이 듣는 키. 화면 안에서만, v · r · ↩ 는 포커스가 행 안일 때만.
const TODAY: ShortcutGroup = {
  id: "today",
  titleKey: "keys.todayGroup",
  rows: [
    { keys: "j / k", labelKey: "keys.todayMove" },
    { keys: "↑ / ↓", labelKey: "keys.todayMove" },
    { keys: "Home / End", labelKey: "keys.todayEnds" },
    { keys: "↩", labelKey: "keys.todayAct" },
    { keys: "v", labelKey: "keys.todayRead" },
    { keys: "r", labelKey: "keys.todayRun" },
    { keys: "Esc", labelKey: "keys.todayLeave" },
  ],
};

// 일지 (11-15) — `JournalScreenV2` 의 컨테이너가 듣는 키. 예전 표는 j/k 를 「파일 이동」, / 를 「파일 필터」 라
// 적었고 v(읽음)는 툴팁만 약속했다.
const JOURNAL: ShortcutGroup = {
  id: "journal",
  titleKey: "keys.g.journal",
  rows: [
    { keys: "j / k", labelKey: "keys.entryMove" },
    { keys: "/ · ⌘F", labelKey: "keys.entryFilter" },
    { keys: "v", labelKey: "keys.entryRead" },
    { keys: "Enter", labelKey: "keys.entryOpen" },
    { keys: "Esc", labelKey: "keys.entryBack" },
    { keys: "[ / ]", labelKey: "keys.entryFiles" },
    { keys: "⌘N", labelKey: "keys.journalNew" },
  ],
};

// 계획 (11-15) — `PlannerScreenV2` 의 본문이 듣는 키. 예전엔 계획 화면에 단축키가 하나도 없었다.
const PLAN: ShortcutGroup = {
  id: "plan",
  titleKey: "nav.planner",
  rows: [
    { keys: "j / k", labelKey: "keys.planItems" },
    { keys: "[ / ]", labelKey: "keys.planSwitch" },
    { keys: "Enter", labelKey: "keys.planStatus" },
    { keys: "r", labelKey: "keys.planRun" },
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

// 터미널 (11-02) — `TerminalScreen` 의 keydown 이 듣는 키. 그 밖 OS 는 터미널 가족(셸 키에 Shift 하나 더).
// 칸 이동만 Ctrl+Alt + 방향키다 — 방향키는 셸 키가 아니라 Shift 를 얹지 않는다.
const TERMINAL: ShortcutGroup = {
  id: "terminal",
  titleKey: "keys.g.terminal",
  rows: [
    { keys: "⌘T", labelKey: "keys.termNew" },
    { keys: "⌘D", labelKey: "keys.termSplitRight" },
    { keys: "⇧⌘D", labelKey: "keys.termSplitDown" },
    { keys: "⌥⌘← → ↑ ↓", nonMac: "Ctrl+Alt+← → ↑ ↓", labelKey: "keys.termPaneMove" },
    { keys: "⇧⌘↩", labelKey: "keys.termZoom" },
    { keys: "⌘F", labelKey: "keys.termFind" },
    { keys: "⇧⌘[ / ⇧⌘]", nonMac: "Ctrl+PageUp / PageDown", labelKey: "keys.termCycle" },
    { keys: "⌘= / ⌘- / ⌘0", nonMac: "Ctrl+= / Ctrl+- / Ctrl+0", labelKey: "keys.termFont" },
    // 세션이 둘 이상이면 ⌘W 는 고른 세션만 닫는다(`interceptCloseKey`) — 그 밖 OS 는 터미널 가족 Ctrl+Shift+W.
    { keys: "⌘W", labelKey: "terminal.keys.closeSession" },
    // Ctrl+C · Ctrl+V 는 셸의 것(인터럽트 · 문자 그대로)이라 복사 · 붙여넣기는 Shift 를 얹는다 — 맥은 ⌘C · ⌘V 그대로.
    { keys: "Ctrl+Shift+C / V", labelKey: "terminal.keys.copyPaste", nonMacOnly: true },
  ],
};

// 시작 창 (`features/start/StartWindow.tsx`) — 첫 줄에 포커스가 있어 열자마자 먹는다. ⌘K · ⌘, · ⌘/ 는 전역 그대로.
const START: ShortcutGroup = {
  id: "start",
  titleKey: "keys.g.start",
  rows: [
    { keys: "⌘O", labelKey: "keys.startAdd" },
    { keys: "↑ / ↓", labelKey: "start.keysMove" },
    { keys: "Enter", labelKey: "start.keysOpen" },
  ],
};

/** 화면 이동 그룹 — navRegistry 에서 파생. */
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
  const groups = [navShortcutGroup(), GLOBAL, WINDOW, TODAY, JOURNAL, PLAN, DIFF, TERMINAL, START];
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
