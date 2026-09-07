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
// 첫 오픈 비용에서 뺀다 — 특히 터미널(xterm)·AI/문서/토의/회고(markdown)·
// 설정(1400줄)·검색. 코드 맵(React Flow+dagre)은 이전부터 lazy.
export const RetroScreenV2 = lazy(() =>
  import("@/features/retro/RetroScreenV2").then((m) => ({ default: m.RetroScreenV2 })),
);
export const SearchScreenV2 = lazy(() =>
  import("@/features/search/SearchScreenV2").then((m) => ({ default: m.SearchScreenV2 })),
);
export const TerminalScreenV2 = lazy(() =>
  import("@/features/terminal/TerminalScreenV2").then((m) => ({ default: m.TerminalScreenV2 })),
);
export const AiPanelScreenV2 = lazy(() =>
  import("@/features/chat/AiPanelScreenV2").then((m) => ({ default: m.AiPanelScreenV2 })),
);
export const ClaudeCodeScreenV2 = lazy(() =>
  import("@/features/chat/ClaudeCodeScreenV2").then((m) => ({ default: m.ClaudeCodeScreenV2 })),
);
export const CodexScreenV2 = lazy(() =>
  import("@/features/chat/CodexScreenV2").then((m) => ({ default: m.CodexScreenV2 })),
);
export const DocsScreenV2 = lazy(() =>
  import("@/features/docs/DocsScreenV2").then((m) => ({ default: m.DocsScreenV2 })),
);
export const DiscussionScreenV2 = lazy(() =>
  import("@/features/discussion/DiscussionScreenV2").then((m) => ({
    default: m.DiscussionScreenV2,
  })),
);
export const GraphScreenV2 = lazy(() =>
  import("@/features/graph/GraphScreenV2").then((m) => ({ default: m.GraphScreenV2 })),
);
export const SkillsScreenV2 = lazy(() =>
  import("@/features/skills/SkillsScreenV2").then((m) => ({ default: m.SkillsScreenV2 })),
);
export const SettingsPanel = lazy(() =>
  import("@/features/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);
// 코드 화면 (docs/code-editor/00-master-plan.md) — CodeMirror 를 통째로 실은
// 청크라 lazy 가 필수다. 안 여는 사용자에게 에디터 비용을 지우지 않는다.
export const CodeScreenV2 = lazy(() =>
  import("@/features/code/CodeScreenV2").then((m) => ({ default: m.CodeScreenV2 })),
);
// 세션 화면 (2026-09-04) — 협업하는 프로젝트에서만 여는 곳이라 지연 청크다.
export const SessionsScreenV2 = lazy(() =>
  import("@/features/sessions/SessionsScreenV2").then((m) => ({ default: m.SessionsScreenV2 })),
);
// 브랜치의 이야기 (v3-surface {#branch-story-view}) — 다른 축으로 다시 읽는
// 곳이라 코어 루프와 달리 지연 청크다.
export const BranchScreenV2 = lazy(() =>
  import("@/features/branch/BranchScreenV2").then((m) => ({ default: m.BranchScreenV2 })),
);
// 터미널 도크 (2026-08-15) — 열어야 청크를 받는다. 안 여는 사용자에게 xterm
// 비용을 지우지 않는 것은 터미널 화면과 같은 원칙이다.
export const TerminalDock = lazy(() =>
  import("@/features/terminal/TerminalDock").then((m) => ({ default: m.TerminalDock })),
);
