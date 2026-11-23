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
//
// 표기는 한 벌이다 (11-15 검수 — 묶음마다 ↩ · Enter · 두 줄 · 덧말로 갈렸다):
//   - Enter 는 `↩`. 그 밖 OS 는 `kbd()` 가 「Enter」 로 옮긴다.
//   - ` / ` 는 짝(앞 · 뒤), ` · ` 는 같은 일을 하는 다른 길. 줄 옮기기는 한 줄 — `j / k` 에 그 화면이 듣는
//     화살표를 잇는다(`j / k · ↑ / ↓`). 화살표를 안 듣는 화면(계획 · 변경)은 `j / k` 만.
//   - 화면 묶음의 id 는 화면 id(`navRegistry` · `uiV2View`)와 같다 — 치트시트가 그 id 로 「지금 화면」 묶음을
//     맨 앞에 세운다(`orderShortcutGroups`). 계획 묶음이 "plan" 이라 계획 화면에서만 칩이 안 섰다.

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
    // 이름은 「기다림」 계열이다 — 「내 차례」 는 오늘 화면의 계획 사람 몫(누르면 계획으로)이라 다른 것을 가리켰다.
    { keys: "⌘J", labelKey: "keys.jumpWaiting" },
    { keys: "⌘O", labelKey: "keys.switchProject" },
    // ⌃숫자 · ⇧⌘숫자는 화면 전환 · 스크린샷과 겹친다 (features/shell/projectKeys.ts).
    // 누르고 있으면 최근 순 창 목록, 톡 누르면 직전 창 (features/shell/WindowSwitcher.tsx).
    { keys: "⌥Tab", nonMac: "Ctrl+`", labelKey: "keys.windowSwitch" },
    { keys: "⌥⌘1~9", nonMac: "Alt+1~9", labelKey: "keys.projectSlot" },
    { keys: "⌘,", labelKey: "keys.settings" },
    { keys: "⌘/", labelKey: "keys.cheatsheet" },
    // 지금 화면의 키만 작은 시트로(11-23) — 입력 칸 · 터미널 밖에서만(`kbd.isScreenKeysKey`, `useGlobalShortcuts`).
    { keys: "?", labelKey: "keys.screenKeys" },
    // 영수증 복사(11-23) — 오늘 · 일지 상세 · 변경 중 떠 있는 화면이 듣는다(`features/diff/ReceiptButton.useReceiptKey`).
    // 그 밖 OS 는 Ctrl+Shift+C — 터미널의 복사와 같은 조합이지만 터미널 화면에서는 이 키를 듣는 화면이 없다.
    { keys: "⇧⌘C", labelKey: "keys.copyReceipt" },
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
    { keys: "j / k · ↑ / ↓", labelKey: "keys.rowMove" },
    { keys: "Home / End", labelKey: "keys.todayEnds" },
    { keys: "↩", labelKey: "keys.todayAct" },
    { keys: "v", labelKey: "keys.todayRead" },
    { keys: "r", labelKey: "keys.todayRun" },
    { keys: "Esc", labelKey: "keys.todayLeave" },
  ],
};

// 일지 (11-15) — `JournalScreenV2` 의 컨테이너가 듣는 키. 예전 표는 j/k 를 「파일 이동」, / 를 「파일 필터」 라
// 적었고 v(읽음)는 툴팁만 약속했다. ↑ · ↓ 는 목록에 포커스가 있을 때 듣는다.
const JOURNAL: ShortcutGroup = {
  id: "journal",
  titleKey: "keys.g.journal",
  rows: [
    { keys: "j / k · ↑ / ↓", labelKey: "keys.entryMove" },
    { keys: "/ · ⌘F", labelKey: "keys.entryFilter" },
    { keys: "v", labelKey: "keys.entryRead" },
    // 「검증 없는 것만」 켜고 끄기(11-22) — u → v → v … 로 검증 없는 일지를 키보드만으로 차례로 읽는다.
    { keys: "u", labelKey: "keys.entryOnlyMissing" },
    { keys: "↩", labelKey: "keys.entryOpen" },
    { keys: "Esc", labelKey: "keys.entryBack" },
    { keys: "[ / ]", labelKey: "keys.entryFiles" },
    { keys: "⌘N", labelKey: "keys.journalNew" },
  ],
};

// 계획 (11-15) — `PlannerScreenV2` 의 본문이 듣는 키. 예전엔 계획 화면에 단축키가 하나도 없었다.
// id 는 화면 id 그대로 "planner" 다(머리 주석 — "plan" 이면 계획 화면에서 「지금 화면」 이 안 섰다).
const PLAN: ShortcutGroup = {
  id: "planner",
  titleKey: "nav.planner",
  rows: [
    { keys: "j / k", labelKey: "keys.planItems" },
    { keys: "[ / ]", labelKey: "keys.planSwitch" },
    { keys: "↩", labelKey: "keys.planStatus" },
    { keys: "r", labelKey: "keys.planRun" },
  ],
};

// 변경 화면 (11-15) — `features/diff/useDiffKeys.ts` 가 듣는 키 그대로. 예전 표는 화면에 없는 키 셋
// (/ · n/N · f)을 알렸다 — `diff_keys_handoff.test.tsx` 가 행마다 키를 보내 화면이 반응하는지 문다.
const DIFF: ShortcutGroup = {
  id: "diff",
  titleKey: "keys.g.diff",
  rows: [
    { keys: "j / k", labelKey: "keys.diffFiles" },
    { keys: "[ / ]", labelKey: "keys.diffGroups" },
    { keys: "n / p", labelKey: "keys.diffHunks" },
    { keys: "⌥n", labelKey: "keys.diffNextNote" },
    { keys: "v", labelKey: "keys.diffViewed" },
    { keys: "e", labelKey: "keys.diffEditor" },
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
    // 키 층(`termKeys`)이 듣는 둘 — ⌘L 은 고른 출력이 있을 때만(없으면 셸의 키), ⇧↩ 는 Claude · Codex 의 입력 칸
    // (대체 화면 + 상태 신호)에서만 줄바꿈이고 셸 · vim 에서는 그냥 Enter 다. 그 밖 OS 는 터미널 가족 표기로 옮겨진다.
    { keys: "⌘L", labelKey: "keys.termSendSelection" },
    { keys: "⇧↩", labelKey: "keys.termNewline" },
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
    // j · k 는 거르기 칸이 비었을 때만 듣는다(치면 글자가 칸으로 간다).
    { keys: "j / k · ↑ / ↓", labelKey: "keys.rowMove" },
    { keys: "↩", labelKey: "start.keysOpen" },
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
