---
schema_version: 1
type: chore
slug: "readme-landing-release-sync"
status: done
difficulty: low
created_at: "2026-08-12T19:32:00+09:00"
session_id: "manual-20260812-193200"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "docs/RELEASE.md"
    op: create
  - path: "CHANGELOG.md"
    op: update
  - path: "CONTRIBUTING.md"
    op: update
  - path: "CLAUDE.md"
    op: update
related:
  - ".oculpm/journal/20260812/Chores/1811_chore_release-v2-8-5.md"
tags: ["docs", "landing", "release", "readme"]
---
[x] README(한/영) v2.8 반영 + 랜딩 기능 표면 보강 + 릴리스 체크리스트 문서화

## 작업 요약

**README 가 v2.7.0 에 멈춰 있었다.** 릴리스 때 갱신하는 면을 "CHANGELOG · 랜딩 · 버전 3파일" 세 개로 잡고 있었던 탓에, v2.8.0~v2.8.5 여섯 릴리스가 README 한/영 어디에도 없었다 (직전 릴리스 일지의 "3면 전부 갱신" 이 그 증거다).

- **README.md · README.en.md** — 최상단을 `v2.8` 하이라이트(영어 지원 · 스킬 샵 · 프로젝트 관리 화면 · 터미널 한국어/붙여넣기 · 서체·속도)로 교체. 기존 v2.6·v2.7 두 섹션은 사실을 잃지 않는 선에서 한 섹션으로 압축해 README 가 릴리스마다 길어지는 것을 막았다. 화면 구성의 "스킬" 항목을 **스킬·규칙**(샵 탭·`.claude/rules` 포함)으로 고치고, 단축키 문단에 `⌘⇧M`, 그 아래 화면 언어/AI 작성 언어 설명을 추가.
- **landing/index.html** — 버전 문자열은 이미 v2.8.5 였지만 **기능 표면이 비어 있었다.** JSON-LD `featureList` 3줄(스킬 샵 · 화면 언어 · 프로젝트 관리), FAQ 에 "영어도 지원하나요", 벤토 그리드에 셀 3개(스킬 샵 · 한국어·English · 프로젝트 관리)를 추가. 벤토는 6칸 그리드라 `c-span2` 3개 = 정확히 한 줄(총 36칸 = 6행). meta description·keywords 에도 스킬 샵·English UI 를 넣었다.
- **docs/RELEASE.md (신규)** — 릴리스 체크리스트를 저장소 SSOT 로. 면을 3 → 5(버전 3파일 · CHANGELOG · README 한 · README 영 · 랜딩)로 늘리고, 게이트 5종·awk 릴리스 노트 추출·랜딩 수동 배포·`git add -A` 금지까지 한 문서에 모았다. `CHANGELOG.md` 머리말 · `CONTRIBUTING.md` · `CLAUDE.md` 세 곳에서 이 문서를 가리켜, 다음 릴리스 때 어느 입구로 들어와도 걸리게 했다.

## 검증

- 랜딩 JSON-LD 2블록을 `json.loads` 로 파싱 — 둘 다 통과(SoftwareApplication · FAQPage). 벤토 span 합 36 = 6칸 × 6행으로 마지막 줄이 어긋나지 않음을 계산으로 확인.
- 문서에 적은 사실을 코드로 교차검증 — 화면 12개(`navRegistry.NAV_ENTRIES` 12), 카탈로그 25종(`src/features/skills/catalog` 27파일 − 라이선스 2), 규칙 탭이 `.claude/rules` + `CLAUDE.md` 를 다룸(`RulesTab.tsx` 헤더), 언어 설정 위치(`SettingsPanel` uiTitle/contentTitle).
- 소스 코드 변경 0 — 문서·정적 랜딩만 건드려 게이트(typecheck/test/lint/build)의 대상이 아니다. 랜딩은 이 커밋으로 나가지 않으며 다음 배포(`landing/` 에서 `vercel --prod`) 때 반영된다.

## 메모

README 압축은 이번 한 번으로 끝나지 않는다 — `docs/RELEASE.md` §3 에 "섹션이 계속 쌓이지 않도록 오래된 것은 묶어 압축" 을 규칙으로 적어 두었다.
