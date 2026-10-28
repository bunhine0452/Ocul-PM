import {
  Sunrise,
  NotebookText,
  MessagesSquare,
  TargetIcon,
  GitCompareArrows,
  SearchIcon,
  Puzzle,
  GitBranchIcon,
} from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import type { I18nKey } from "@/i18n";
import { modLabel } from "@/lib/kbd";

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
   * 화면 등급 (docs/PROMISE.md, 2026-10-27) — 사이드바의 세 단이 곧 이것이다
   * (best-results UI 라운드 2026-10-28). **core** = 약속하는 네 화면, 항상 보인다.
   * **viewer** = 열리고 보여 주고 깨지지 않는 화면, 간단 밀도에서는 「도구」로
   * 접힌다. **hold** = 있지만 약속이 아닌 베타, 간단 밀도에서는 「베타」로 접힌다.
   * 접힘이지 숨김이 아니다 — ⌘번호와 ⌘K 는 어느 밀도에서나 닿는다.
   */
  tier: "core" | "viewer" | "hold";
  /**
   * 이 행이 대표하는 **갈래들** (2026-09-06 IA 재편).
   *
   * 에이전트 한 행이 Claude Code · Codex 둘을 대표한다. 행의 `id` 는
   * 눌렀을 때 가는 기본 갈래이고, 갈래 중 어느 것이 열려 있어도 이 행이
   * 활성으로 보이며 배지는 **합산**된다. 사이드바는 갈래가 열려 있을 때만
   * 하위 목록을 펼친다 — 안 쓰는 사람에게 두 줄을 늘 보이지 않는다.
   *
   * 화면 자체는 하나도 없애지 않았다: `uiV2View` 값 둘이 그대로 살아 있고,
   * ⌘K 팔레트는 갈래를 **각각** 목적지로 싣는다 (목적을 갖고 가는 곳은
   * 목적지여야 한다).
   */
  children?: NavEntry[];
}

/**
 * 사이드바 행 8개 (2026-10-28 덜어내기 라운드 이후).
 *
 * 2026-09-06 IA 재편(에이전트 한 행·논의 강등)과 2026-09-08·10-24 의 삭제(회고·문서·코드 맵)를
 * 지나, 2026-10-28 에 **보류 등급 네 화면**(터미널·편집기·에이전트 둘·AI 패널)을 통째로 걷었다
 * (플랜 `simplify-round-20261028`). 남은 것은 핵심 넷 + 검색 · 스킬 · 논의 · 브랜치다.
 *
 * ⌘번호는 여전히 **배열 앞 10개**에 자동 부여된다 — 이제 여덟 화면 전부가 번호를 받고
 * ⌘9·⌘0 은 빈다. 번호의 뜻이 바뀔 때마다 사이드바가 한 번 안내한다 (`NavRemapNotice`).
 */
export const NAV_ENTRIES: NavEntry[] = [
  // ── 코어 루프: 오늘 무슨 일이 있었나 → 뭐라고 적혔나 → 코드가 어떻게
  //    바뀌었나 → 다음에 뭘 하나 → 무엇을 배웠나.
  { id: "today", labelKey: "nav.today", aliasKey: "nav.today.alias", icon: Sunrise, tier: "core", group: "main" },
  { id: "journal", labelKey: "nav.journal", aliasKey: "nav.journal.alias", icon: NotebookText, tier: "core", group: "main" },
  { id: "diff", labelKey: "nav.diff", aliasKey: "nav.diff.alias", icon: GitCompareArrows, tier: "core", group: "main" },
  { id: "planner", labelKey: "nav.planner", aliasKey: "nav.planner.alias", icon: TargetIcon, tier: "core", group: "main" },
  // ── 코드 작업면.
  { id: "search", labelKey: "nav.search", aliasKey: "nav.search.alias", icon: SearchIcon, tier: "viewer", group: "tools" },
  // ── AI 면 — 보류 등급(터미널·편집기·에이전트·AI 패널)은 2026-10-28 에 걷었다 (플랜
  //    simplify-round-20261028). 남은 것은 스킬 하나다.
  // PR-CI3 — 스킬 화면을 스킬·규칙·훅 허브로 확장 (id 는 유지 — 저장된 uiV2View 호환).
  { id: "skills", labelKey: "nav.skills", aliasKey: "nav.skills.alias", icon: Puzzle, tier: "viewer", group: "ai" },
  // ── 참고. 가끔 열고, 없으면 비어 있는 것이 정상인 화면.
  { id: "discussion", labelKey: "nav.discussion", aliasKey: "nav.discussion.alias", icon: MessagesSquare, tier: "viewer", group: "ref" },
  // 브랜치의 이야기 (v3-surface {#branch-story-view}) — 일지·플랜·커밋을
  // **브랜치**로 묶어 읽는다. 코어 루프(일지·플래너·변경)를 다른 축으로 다시
  // 읽는 곳이라 코어 루프 곁(main)에 둔다.
  //
  // 배열 **맨 끝**이라 ⌘번호는 없다 — 사이드바에서는 코어 루프의 마지막 줄로
  // 보이고 번호만 비는데, 그게 규약이다: 번호는 앞 10칸의 것이고 그 계약을
  // 새 화면 하나 때문에 밀지 않는다 (`code` 도 같은 이유로 오래 번호가 없었다).
  { id: "branch", labelKey: "nav.branch", aliasKey: "nav.branch.alias", icon: GitBranchIcon, tier: "viewer", group: "main" },
];

/**
 * ⌘K 팔레트가 싣는 목적지 전체 — 갈래가 있는 행은 **갈래로 펼쳐서** 싣는다.
 *
 * 사이드바에서 행이 사라졌다고 갈 곳이 사라지면 안 된다. Codex 는
 * 여기서 여전히 제 이름으로 찾힌다. 부모(「에이전트」) 자체는 목적지가
 * 아니다 — 누를 수 있는 것은 늘 둘 중 하나이므로, 합친 이름은 두 갈래의
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

/** 표시용 — macOS `⌘1`, Windows·Linux `Ctrl+1` (lib/kbd.ts). */
export function navShortcutLabel(view: UiV2View): string | undefined {
  const idx = NAV_ENTRIES.findIndex((e) => e.id === view);
  return idx >= 0 && idx < NAV_SHORTCUT_KEYS.length ? modLabel(NAV_SHORTCUT_KEYS[idx]) : undefined;
}

/**
 * 전역 이벤트 채널 — ⌘P·팔레트가 사이드바의 프로젝트 스위처 팝오버를 열고,
 * 팔레트 엔티티 점프(U7)가 ShellV2 라우팅에 도달한다.
 * (CommandPalette 의 OCULPM_BUS 와 같은 패턴 — 소유 트리를 관통하지 않는다.)
 */
export const NAV_BUS = {
  openProjectSwitcher: "oculpm:open-project-switcher",
  /** detail: { kind: "journal"|"plan"|"plan_item"|"discussion"|"code", id: string } */
  openEntity: "oculpm:open-entity",
  /** detail: UiV2View — 화면 전환 요청. 프로바이더를 모르는 자리(툴바 안의 탭)가 쏜다. */
  setView: "oculpm:set-view",
} as const;

export interface OpenEntityDetail {
  kind: "journal" | "plan" | "plan_item" | "discussion" | "code";
  /** 엔티티 id. `code` 는 프로젝트 상대 파일 경로. */
  id: string;
  /** `code` 전용 — 0-based 줄. 워크스페이스 심볼이 정확한 자리로 보낸다. */
  line?: number;
}
