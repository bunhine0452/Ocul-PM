/**
 * 셸이 지연 로드하는 화면 청크 목록 (플랜 `v3-release` {#big-files-watch}).
 *
 * `ShellV2` 에서 그대로 들어냈다 — 라우터가 **어떤 화면을 언제 그리는가**를
 * 읽는 자리에 "무엇이 별도 청크인가"라는 다른 결의 목록이 60줄 섞여 있었다.
 * 여기 모아 두면 청크 정책을 한 화면씩 훑을 수 있고, 라우터는 갈래만 남는다.
 *
 * 이 모듈은 셸이 **정적으로** 임포트한다 — 그래야 `lazy()` 의 동적 임포트가
 * 지금까지와 똑같이 화면별 청크로 갈라진다 (이 파일 자체는 셸 청크에 실린다).
 * 핵심 루프 4화면(Today/일지/diff/플래너)은 여전히 eager 라 여기 없다.
 */

import { lazy } from "react";

// v2 U6 (docs/20260706_v2/03-performance-spec.md §2) — 핵심 루프 4화면
// (Today/일지/diff/플래너)만 eager. 나머지는 화면별 청크로 분할해 프로젝트
// 첫 오픈 비용에서 뺀다 — 특히 터미널(xterm)·AI/토의(markdown)·
// 설정(1400줄)·검색.
export const SearchScreenV2 = lazy(() =>
  import("@/features/search/SearchScreenV2").then((m) => ({ default: m.SearchScreenV2 })),
);
export const DiscussionScreenV2 = lazy(() =>
  import("@/features/discussion/DiscussionScreenV2").then((m) => ({
    default: m.DiscussionScreenV2,
  })),
);
export const SkillsScreenV2 = lazy(() =>
  import("@/features/skills/SkillsScreenV2").then((m) => ({ default: m.SkillsScreenV2 })),
);
export const SettingsPanel = lazy(() =>
  import("@/features/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);
// 브랜치의 이야기 (v3-surface {#branch-story-view}) — 다른 축으로 다시 읽는
// 곳이라 코어 루프와 달리 지연 청크다.
export const BranchScreenV2 = lazy(() =>
  import("@/features/branch/BranchScreenV2").then((m) => ({ default: m.BranchScreenV2 })),
);
