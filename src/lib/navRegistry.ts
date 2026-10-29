import { Sunrise, NotebookText, TargetIcon, GitCompareArrows, SquareTerminal } from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import type { I18nKey } from "@/i18n";
import { modLabel } from "@/lib/kbd";

// 내비게이션 단일 소스 (v2 01-ux-spec.md §1 → 4.0).
// 사이드바·⌘K 팔레트·⌘번호 단축키가 전부 이 배열에서 파생된다. ⌘1~⌘4 는 배열
// 순서(=사이드바 표시 순서)에 자동 부여되므로 "팔레트에서 화면 누락 / 번호와 표시
// 순서 불일치" 류의 드리프트가 구조적으로 재발하지 않는다.

export type NavIcon = React.ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  color?: string;
  className?: string;
}>;

export interface NavEntry {
  id: UiV2View;
  /**
   * 표시 라벨의 **사전 키**. 라벨 문자열을 여기 직접 두면 모듈 로드 시점에 언어가
   * 굳어 설정에서 언어를 바꿔도 사이드바가 안 바뀐다. 소비처가 `t(labelKey)` 로 그린다.
   */
  labelKey: I18nKey;
  /**
   * ⌘K 팔레트 검색 별칭의 사전 키. 팔레트는 `tAll(aliasKey)` 로 **양 언어의
   * 별칭을 모두** 키워드에 넣는다 — 영어 모드에서도 "일지" 로 찾히도록.
   */
  aliasKey: I18nKey;
  icon: NavIcon;
}

/**
 * 사이드바 행 넷 (4.0, 2026-10-29) — 오늘 · 작업 일지 · 계획 · 변경. 설정은 행이 아니라
 * 사이드바 바닥에 선다(⌘,).
 *
 * 순서가 곧 하루의 흐름이다: 오늘 무엇을 볼 것인가 → 뭐라고 적혔나 → 다음에 뭘
 * 하나 → 코드가 어떻게 바뀌었나. 검색은 작업 일지에 합쳤고, 스킬·논의·브랜치는
 * 걷었다 — 화면의 크기는 에이전트가 한 양이 아니라 사람이 볼 것에 비례한다.
 */
export const NAV_ENTRIES: NavEntry[] = [
  { id: "today", labelKey: "nav.today", aliasKey: "nav.today.alias", icon: Sunrise },
  { id: "journal", labelKey: "nav.journal", aliasKey: "nav.journal.alias", icon: NotebookText },
  { id: "planner", labelKey: "nav.planner", aliasKey: "nav.planner.alias", icon: TargetIcon },
  { id: "diff", labelKey: "nav.diff", aliasKey: "nav.diff.alias", icon: GitCompareArrows },
  // 4.0 다시 (10-29 사용자 결정) — 앱 안 세션, 「다음」 이 여기서 claude 를 연다.
  { id: "terminal", labelKey: "nav.terminal", aliasKey: "nav.terminal.alias", icon: SquareTerminal },
];

/** ⌘K 팔레트가 싣는 화면 목적지 — 사이드바 행과 같다. */
export const NAV_DESTINATIONS: NavEntry[] = NAV_ENTRIES;

/** ⌘번호 키 → 배열 앞에서부터 (⌘1~⌘5). */
export const NAV_SHORTCUT_KEYS = ["1", "2", "3", "4", "5"] as const;

export function navViewForKey(key: string): UiV2View | undefined {
  const idx = (NAV_SHORTCUT_KEYS as readonly string[]).indexOf(key);
  return idx >= 0 ? NAV_ENTRIES[idx]?.id : undefined;
}

/** 표시용 — macOS `⌘1`, Windows·Linux `Ctrl+1` (lib/kbd.ts). */
export function navShortcutLabel(view: UiV2View): string | undefined {
  const idx = NAV_ENTRIES.findIndex((e) => e.id === view);
  return idx >= 0 && idx < NAV_SHORTCUT_KEYS.length ? modLabel(NAV_SHORTCUT_KEYS[idx]) : undefined;
}

/**
 * 전역 이벤트 채널 — ⌘O·팔레트가 사이드바의 프로젝트 목록을 열고, 팔레트 엔티티
 * 점프(U7)가 ShellV2 라우팅에 도달한다. (CommandPalette 의 OCULPM_BUS 와 같은
 * 패턴 — 소유 트리를 관통하지 않는다.)
 */
export const NAV_BUS = {
  openProjectSwitcher: "oculpm:open-project-switcher",
  /** detail: { kind: "journal"|"plan"|"plan_item"|"code", id: string } */
  openEntity: "oculpm:open-entity",
  /** detail: UiV2View — 화면 전환 요청. 프로바이더를 모르는 자리가 쏜다. */
  setView: "oculpm:set-view",
} as const;

export interface OpenEntityDetail {
  kind: "journal" | "plan" | "plan_item" | "code";
  /** 엔티티 id. `code` 는 프로젝트 상대 파일 경로. */
  id: string;
  /** `code` 전용 — 0-based 줄. */
  line?: number;
}
