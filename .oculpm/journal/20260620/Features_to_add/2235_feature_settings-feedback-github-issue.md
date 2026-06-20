---
schema_version: 1
type: feature
slug: settings-feedback-github-issue
status: done
difficulty: low
created_at: "2026-06-20T22:35:00+09:00"
updated_at: "2026-06-20T22:35:00+09:00"
session_id: "20260620-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/settings/SettingsPanel.tsx
    op: update
    bytes_added: 2275
    bytes_removed: 0
related:
  - 20260620/Features_to_add/2230_feature_journal-agent-model-info.md
tags: ["settings", "feedback", "github", "dogfooding-finding"]
---

[x] 설정 > 진단에 피드백(버그 리포트 / 기능 문의) 추가 — 개발자와 소통 채널

## 추가 기능

- 설정 > **진단** 탭에 "피드백 보내기" 섹션 신설. "버그 리포트" / "기능 문의" 두 버튼.
- 클릭 시 prefilled GitHub 이슈 작성 페이지를 기본 브라우저로 연다(`open_url`). 제목 프리픽스(`[버그]`/`[기능 문의]`), 라벨(`bug`/`enhancement`), 본문 템플릿이 채워지고 **앱 버전·OS 가 자동 포함**된다.

## 동작 흐름

1. 진단 탭 마운트 시 `commands.appInfo()` 로 앱 버전 조회, `navigator.userAgent` 로 OS 추정.
2. 버튼 클릭 → `openIssue(kind)` 가 `https://github.com/bunhine0452/Ocul-PM/issues/new?labels=…&title=…&body=…` 를 URL 인코딩해 구성.
3. `commands.openUrl(url)` (http/https 만 허용하는 기존 커맨드) 로 브라우저 오픈. 실패 시 토스트.

## 검증

- `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` 전부 exit 0.
- 수동: 진단 탭에서 두 버튼 노출, prefilled 이슈 URL 형식 확인(버전·OS 포함).

## 메모

- 백엔드 변경 없음 — 기존 `open_url` / `app_info` 재사용. 사용자 결정: 이메일 대신 **GitHub 이슈 연결** 채택.
