import {
  Sunrise,
  NotebookText,
  MessageSquare,
  TargetIcon,
  GitCompareArrows,
  History,
  SearchIcon,
  Network,
  BookText,
  SquareTerminal,
  SparklesIcon,
  Puzzle,
  FileCode,
} from "@/components/Icons";
import { ClaudeMark } from "@/components/ClaudeMark";
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
  group: "main" | "tools";
}

export const NAV_ENTRIES: NavEntry[] = [
  { id: "today", labelKey: "nav.today", aliasKey: "nav.today.alias", icon: Sunrise, group: "main" },
  { id: "journal", labelKey: "nav.journal", aliasKey: "nav.journal.alias", icon: NotebookText, group: "main" },
  { id: "discussion", labelKey: "nav.discussion", aliasKey: "nav.discussion.alias", icon: MessageSquare, group: "main" },
  { id: "planner", labelKey: "nav.planner", aliasKey: "nav.planner.alias", icon: TargetIcon, group: "main" },
  { id: "diff", labelKey: "nav.diff", aliasKey: "nav.diff.alias", icon: GitCompareArrows, group: "main" },
  { id: "retro", labelKey: "nav.retro", aliasKey: "nav.retro.alias", icon: History, group: "main" },
  { id: "search", labelKey: "nav.search", aliasKey: "nav.search.alias", icon: SearchIcon, group: "tools" },
  { id: "graph", labelKey: "nav.graph", aliasKey: "nav.graph.alias", icon: Network, group: "tools" },
  { id: "docs", labelKey: "nav.docs", aliasKey: "nav.docs.alias", icon: BookText, group: "tools" },
  { id: "terminal", labelKey: "nav.terminal", aliasKey: "nav.terminal.alias", icon: SquareTerminal, group: "tools" },
  { id: "ai", labelKey: "nav.ai", aliasKey: "nav.ai.alias", icon: SparklesIcon, group: "tools" },
  // 11번째 이후는 ⌘번호가 없다 — 기존 화면의 번호를 밀지 않도록 끝에 추가.
  // PR-CI3 — 스킬 화면을 스킬·규칙·훅 허브로 확장 (id 는 유지 — 저장된 uiV2View 호환).
  { id: "skills", labelKey: "nav.skills", aliasKey: "nav.skills.alias", icon: Puzzle, group: "tools" },
  // PR-ACP6 — Claude Code 구동면 (프로바이더 채팅과 분리).
  { id: "claudecode", labelKey: "nav.claudecode", aliasKey: "nav.claudecode.alias", icon: ClaudeMark, group: "tools" },
  // 코드 화면 (docs/code-editor/00-master-plan.md) — 인앱 코드 뷰어·에디터.
  { id: "code", labelKey: "nav.code", aliasKey: "nav.code.alias", icon: FileCode, group: "tools" },
];

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
