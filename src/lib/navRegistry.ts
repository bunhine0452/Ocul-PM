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
} from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";

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
  label: string;
  /** 팔레트 fuzzy 검색용 한/영 별칭. */
  alias: string;
  icon: NavIcon;
  group: "main" | "tools";
}

export const NAV_ENTRIES: NavEntry[] = [
  { id: "today", label: "Today", alias: "today 오늘 대시보드 포커스", icon: Sunrise, group: "main" },
  { id: "journal", label: "작업 일지", alias: "journal 일지 timeline 기록 변경 로그", icon: NotebookText, group: "main" },
  { id: "discussion", label: "문제 해결", alias: "discussion 토의 문제 해결 결정 회의록", icon: MessageSquare, group: "main" },
  { id: "planner", label: "Planner", alias: "planner 플래너 목표 goal 계획", icon: TargetIcon, group: "main" },
  { id: "diff", label: "변경 diff", alias: "diff 변경 로컬 파일 검토", icon: GitCompareArrows, group: "main" },
  { id: "retro", label: "회고", alias: "retro 회고 인사이트 요약 보고", icon: History, group: "main" },
  { id: "search", label: "코드 검색", alias: "search 코드 검색 시맨틱 semantic", icon: SearchIcon, group: "tools" },
  { id: "graph", label: "코드 맵", alias: "graph 코드 맵 의존성 dependency 그래프", icon: Network, group: "tools" },
  { id: "docs", label: "문서", alias: "docs 문서 위키 마크다운 wiki", icon: BookText, group: "tools" },
  { id: "terminal", label: "터미널", alias: "terminal 터미널 셸 shell", icon: SquareTerminal, group: "tools" },
  { id: "ai", label: "AI 패널", alias: "ai 패널 채팅 chat llm", icon: SparklesIcon, group: "tools" },
  // 11번째 이후는 ⌘번호가 없다 — 기존 화면의 번호를 밀지 않도록 끝에 추가.
  { id: "skills", label: "스킬", alias: "skills 스킬 skill claude 에이전트 규칙 프롬프트", icon: Puzzle, group: "tools" },
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
  kind: "journal" | "plan" | "plan_item" | "discussion" | "doc";
  id: string;
}
