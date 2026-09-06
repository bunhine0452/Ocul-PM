import {
  Sunrise,
  NotebookText,
  MessagesSquare,
  TargetIcon,
  GitCompareArrows,
  History,
  SearchIcon,
  Network,
  BookText,
  SquareTerminal,
  MessageSquareText,
  Puzzle,
  FileCode,
  Waypoints,
  Bot,
} from "@/components/Icons";
import { ClaudeMark } from "@/components/ClaudeMark";
import { CodexMark } from "@/components/CodexMark";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import type { I18nKey } from "@/i18n";

// v2 (docs/20260706_v2/01-ux-spec.md §1) — 내비게이션 단일 소스.
// 사이드바·커맨드 팔레트·⌘번호 단축키가 전부 이 배열에서 파생된다.
// ⌘1~⌘9·⌘0 은 배열 순서(=사이드바 표시 순서)에 자동 부여되므로 "팔레트에서
// 화면 누락 / 번호와 표시 순서 불일치" 류의 드리프트가 구조적으로 재발하지
// 않는다. 항목을 추가·재배열하면 번호도 함께 움직인다 (11번째 이후는 번호 없음).

export type NavIcon = React.ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  color?: string;
  className?: string;
}>;

export interface NavEntry {
  id: UiV2View;
  /**
   * 표시 라벨의 **사전 키** (i18n Phase 0). 라벨 문자열을 여기 직접 두면
   * 모듈 로드 시점에 언어가 굳어 설정에서 언어를 바꿔도 사이드바가 안 바뀐다.
   * 소비처가 `t(labelKey)` 로 그린다.
   */
  labelKey: I18nKey;
  /**
   * ⌘K 팔레트 검색 별칭의 사전 키. 팔레트는 `tAll(aliasKey)` 로 **양 언어의
   * 별칭을 모두** 키워드에 넣는다 — 영어 모드에서도 "일지" 로 찾히도록.
   */
  aliasKey: I18nKey;
  icon: NavIcon;
  /**
   * 사이드바 섹션. main = 코어 루프 · tools = 코드 작업면 · ai = AI 면 ·
   * ref = 참고 (2026-09-06 IA 재편에서 추가 — 아래 `NAV_ENTRIES` 주석 참고).
   */
  group: "main" | "tools" | "ai" | "ref";
  /**
   * 이 행이 대표하는 **갈래들** (2026-09-06 IA 재편).
   *
   * 에이전트 한 행이 Claude Code · Codex · 세션 셋을 대표한다. 행의 `id` 는
   * 눌렀을 때 가는 기본 갈래이고, 갈래 중 어느 것이 열려 있어도 이 행이
   * 활성으로 보이며 배지는 **합산**된다. 사이드바는 갈래가 열려 있을 때만
   * 하위 목록을 펼친다 — 안 쓰는 사람에게 세 줄을 늘 보이지 않는다.
   *
   * 화면 자체는 하나도 없애지 않았다: `uiV2View` 값 셋이 그대로 살아 있고,
   * ⌘K 팔레트는 갈래를 **각각** 목적지로 싣는다 (목적을 갖고 가는 곳은
   * 목적지여야 한다).
   */
  children?: NavEntry[];
}

/**
 * 에이전트 행의 세 갈래. 사이드바에서는 부모가 활성일 때만 펼쳐지고, ⌘K
 * 팔레트에서는 늘 각각 찾을 수 있다.
 *
 * 셋 다 별칭에 "에이전트" 를 넣어 둔다 — 사이드바에서 사라진 이름으로
 * 검색하는 사람과, 합쳐진 이름으로 검색하는 사람이 둘 다 도착해야 한다.
 */
const AGENT_BRANCHES: NavEntry[] = [
  { id: "claudecode", labelKey: "nav.claudecode", aliasKey: "nav.claudecode.alias", icon: ClaudeMark, group: "ai" },
  { id: "codex", labelKey: "nav.codex", aliasKey: "nav.codex.alias", icon: CodexMark, group: "ai" },
  // 세션은 혼자 쓰면 영구 빈 화면인 행이었다 (붙어 있는 에이전트가 하나뿐이면
  // 묶을 것이 없다). 화면은 남기고 **행만** 접었다.
  { id: "sessions", labelKey: "nav.sessions", aliasKey: "nav.sessions.alias", icon: Waypoints, group: "ai" },
];

/**
 * 사이드바 행 14개 (2026-09-06 IA 재편, 안 A: 17화면 → 15).
 *
 * 무엇이 바뀌었나:
 *
 * - **Claude Code · Codex · 세션 → 「에이전트」 한 행.** 셋 다 "에이전트에게
 *   시키는 곳"인데 사이드바에서 세 줄을 먹었다. 화면은 셋 다 살아 있고
 *   (`children`), 컴포넌트도 두 벌 keep-alive 그대로다 — 행만 하나다.
 * - **논의·문서를 `ref`(참고) 로 강등하고 ⌘번호를 회수했다.** 이 저장소 실측
 *   으로 논의 4건 vs 일지 537건이고, `docs/` 가 없는 프로젝트에서 ⌘9(문서)는
 *   **영구 빈 화면**이었다. 매일 쓰는 것이 번호를 갖는다.
 * - **재명명** — 코드 검색 → 검색 · 코드 → 편집기 · Diff → 변경. 옛 이름은
 *   ⌘K 별칭에 남긴다 (v2.17.0 선례).
 *
 * ⌘번호는 여전히 **배열 앞 10개**에 자동 부여된다. ⌘1·⌘2·⌘4 는 뜻이 그대로고
 * (오늘·일지·플래너), 나머지 일곱은 바뀐다 — 사이드바가 한 번 안내한다
 * (`NavRemapNotice`).
 */
export const NAV_ENTRIES: NavEntry[] = [
  // ── 코어 루프: 오늘 무슨 일이 있었나 → 뭐라고 적혔나 → 코드가 어떻게
  //    바뀌었나 → 다음에 뭘 하나 → 무엇을 배웠나.
  { id: "today", labelKey: "nav.today", aliasKey: "nav.today.alias", icon: Sunrise, group: "main" },
  { id: "journal", labelKey: "nav.journal", aliasKey: "nav.journal.alias", icon: NotebookText, group: "main" },
  { id: "diff", labelKey: "nav.diff", aliasKey: "nav.diff.alias", icon: GitCompareArrows, group: "main" },
  { id: "planner", labelKey: "nav.planner", aliasKey: "nav.planner.alias", icon: TargetIcon, group: "main" },
  { id: "retro", labelKey: "nav.retro", aliasKey: "nav.retro.alias", icon: History, group: "main" },
  // ── 코드 작업면. 안쪽 순서는 재편 전과 같다 (문서만 빠졌다).
  { id: "search", labelKey: "nav.search", aliasKey: "nav.search.alias", icon: SearchIcon, group: "tools" },
  { id: "graph", labelKey: "nav.graph", aliasKey: "nav.graph.alias", icon: Network, group: "tools" },
  { id: "terminal", labelKey: "nav.terminal", aliasKey: "nav.terminal.alias", icon: SquareTerminal, group: "tools" },
  { id: "code", labelKey: "nav.code", aliasKey: "nav.code.alias", icon: FileCode, group: "tools" },
  // ── AI 면. 「에이전트」가 ⌘0 을 갖는 열 번째 칸이다 — 매일 쓰는 면이
  //    번호를 갖는다는 규칙의 결과다.
  { id: "claudecode", labelKey: "nav.agent", aliasKey: "nav.agent.alias", icon: Bot, group: "ai", children: AGENT_BRANCHES },
  { id: "ai", labelKey: "nav.ai", aliasKey: "nav.ai.alias", icon: MessageSquareText, group: "ai" },
  // PR-CI3 — 스킬 화면을 스킬·규칙·훅 허브로 확장 (id 는 유지 — 저장된 uiV2View 호환).
  { id: "skills", labelKey: "nav.skills", aliasKey: "nav.skills.alias", icon: Puzzle, group: "ai" },
  // ── 참고. 가끔 열고, 없으면 비어 있는 것이 정상인 화면들.
  { id: "discussion", labelKey: "nav.discussion", aliasKey: "nav.discussion.alias", icon: MessagesSquare, group: "ref" },
  { id: "docs", labelKey: "nav.docs", aliasKey: "nav.docs.alias", icon: BookText, group: "ref" },
];

/**
 * ⌘K 팔레트가 싣는 목적지 전체 — 갈래가 있는 행은 **갈래로 펼쳐서** 싣는다.
 *
 * 사이드바에서 행이 사라졌다고 갈 곳이 사라지면 안 된다. Codex 와 세션은
 * 여기서 여전히 각각 이름으로 찾힌다. 부모(「에이전트」) 자체는 목적지가
 * 아니다 — 누를 수 있는 것은 늘 셋 중 하나이므로, 합친 이름은 세 갈래의
 * **별칭**에 들어간다 (`nav.*.alias` 에 "에이전트").
 */
export const NAV_DESTINATIONS: NavEntry[] = NAV_ENTRIES.flatMap((e) => e.children ?? [e]);

/** 이 행이 활성으로 보여야 하는 화면들 (갈래가 있으면 그 전부). */
export function navRowViews(entry: NavEntry): UiV2View[] {
  return entry.children ? entry.children.map((c) => c.id) : [entry.id];
}

/** ⌘번호 키 → 배열 앞 10개 (⌘0 = 10번째). */
export const NAV_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export function navViewForKey(key: string): UiV2View | undefined {
  const idx = (NAV_SHORTCUT_KEYS as readonly string[]).indexOf(key);
  return idx >= 0 ? NAV_ENTRIES[idx]?.id : undefined;
}

export function navShortcutLabel(view: UiV2View): string | undefined {
  const idx = NAV_ENTRIES.findIndex((e) => e.id === view);
  return idx >= 0 && idx < NAV_SHORTCUT_KEYS.length ? `⌘${NAV_SHORTCUT_KEYS[idx]}` : undefined;
}

/**
 * 전역 이벤트 채널 — ⌘P·팔레트가 사이드바의 프로젝트 스위처 팝오버를 열고,
 * 팔레트 엔티티 점프(U7)가 ShellV2 라우팅에 도달한다.
 * (CommandPalette 의 OCULPM_BUS 와 같은 패턴 — 소유 트리를 관통하지 않는다.)
 */
export const NAV_BUS = {
  openProjectSwitcher: "oculpm:open-project-switcher",
  /** detail: { kind: "journal"|"plan"|"plan_item"|"discussion"|"doc", id: string } */
  openEntity: "oculpm:open-entity",
} as const;

export interface OpenEntityDetail {
  kind: "journal" | "plan" | "plan_item" | "discussion" | "doc" | "code";
  /** 엔티티 id. `code` 는 프로젝트 상대 파일 경로. */
  id: string;
  /** `code` 전용 — 0-based 줄. 워크스페이스 심볼이 정확한 자리로 보낸다. */
  line?: number;
}
