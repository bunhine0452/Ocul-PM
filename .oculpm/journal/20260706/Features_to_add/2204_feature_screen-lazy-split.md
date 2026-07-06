---
schema_version: 1
type: feature
slug: screen-lazy-split
status: done
difficulty: medium
created_at: "2026-07-06T22:04:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/components/Markdown.tsx
    op: update
  - path: src/components/MarkdownImpl.tsx
    op: create
  - path: src/features/terminal/TerminalInstance.tsx
    op: create
  - path: src/features/terminal/TerminalInstanceImpl.tsx
    op: rename
related: []
tags: ["v2-release", "U6", "performance", "bundle", "lazy-load"]
---

[x] U6 화면별 lazy 분할 — ShellV2 청크 584→244KB (−58%)

## 추가 기능

- **ShellV2 화면 분할**: 핵심 루프 4화면(Today/일지/diff/플래너)만 eager, 나머지 7개(검색·회고·터미널·AI 패널·문서·토의·설정 + 기존 그래프)는 `React.lazy` 화면별 청크. 공용 Suspense fallback = 툴바 자리 + SkeletonList(U2) — 스피너 없이 콘텐츠 형태 유지.
- **Markdown 분리** (`MarkdownImpl.tsx`): react-markdown+remark-gfm+rehype-highlight 를 lazy 경계 뒤로. fallback 은 원문 pre-wrap 텍스트 — 내용이 즉시 보이고 리치 렌더로 승격. 소비처 7곳 임포트 경로 불변.
- **TerminalInstance 분리** (`TerminalInstanceImpl.tsx`): Today 의 빠른 터미널 위젯(eager 화면)이 TerminalInstance 를 임포트해 **xterm 전체가 ShellV2 초기 청크에 실려 있던 원인**을 제거. TodayTerminal 은 접힘 기본이라 실제 마운트 시점(사용자가 열 때)에만 288KB 청크 로드.

## 동작 흐름

프로젝트 첫 오픈 → ShellV2 244KB + eager 4화면만 파싱. 이후 화면 첫 진입 시 해당 청크 로컬 로드(스켈레톤 수십 ms) 후 캐시.

## 검증

- 빌드 산출물 실측 (dist/assets, du -k): ShellV2 **584→244KB (−58%, 목표 −40% 초과 달성)**, 신규 분리: TerminalInstanceImpl 288KB · MarkdownImpl 308KB · 화면 청크 8~16KB×5, index 계 1592→1260KB (−332KB).
- `grep -l "@xterm/xterm" dist/assets/*.js` → TerminalInstanceImpl 청크 단 1개 (격리 확인).
- 게이트: typecheck=0 / test=0 / lint=0 / build=0.

## 메모

manualChunks 는 도입하지 않음 — lazy 경계만으로 목표 초과 달성, 과분할 위험 회피(스펙 §2 "과분할 금지"). 사이드바 hover preload 는 후속 여지.
