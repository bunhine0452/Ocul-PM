---
schema_version: 1
type: feature
slug: "i18n-plugin-tab-disk-content"
status: done
difficulty: medium
created_at: "2026-08-12T05:37:51+09:00"
session_id: "mcp-20260812-053751"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/20260811_three-features/03-i18n.md"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/features/skills/PluginDocsTab.tsx"
    op: update
related: []
tags:
  - "i18n"
  - "skills"
  - "lint"
  - "policy"
  - "mcp-tool"
---
[x] 플러그인 안내 탭 영어화 + 번역 제외 분류를 스캐너·SSOT 에 명시

스킬 묶음 4파일. allowlist 58 → 54. `plugin.*` 키 26개.

## 추가 기능

플러그인 안내 탭의 **chrome** — 툴바·설치 상태 배지·설치 안내·권장 흐름·슬래시 커맨드 섹션·MCP 도구/훅 헤딩·외부 문서 버튼.

## 번역하면 안 되는 것을 발견해 분류를 만들었다

같은 묶음의 나머지 3파일은 번역 대상이 **아니었다.** 그런데 `i18n-ignore` 로도 적을 수 없다 — 한글이 **여러 줄 템플릿 리터럴 안**에 있어서, 거기 `//` 를 넣으면 주석이 아니라 사용자 저장소에 기록되는 파일 내용의 일부가 된다.

그래서 스캐너에 `PERMANENT` / `PENDING` 과 별개인 `DISK_CONTENT` 집합을 만들고 파일별 사유를 적었다:

- `rulesModel.ts` — `.claude/rules/*.md` · `CLAUDE.md` 시드 본문
- `skillsModel.ts` — `.claude/skills/<name>/SKILL.md` 시드 본문
- `pluginDocs.ts` — `plugin/oculpm/**` 의 **거울**

`pluginDocs.ts` 가 특히 중요했다. `plugin_docs_sync.test.ts` 가

```js
expect(doc.description).toBe(frontmatterDescription(md));
```

로 인앱 문서의 `description` 을 커맨드 `.md` frontmatter 와 **글자 단위로** 일치시킨다. 번역했으면 그 게이트가 깨질 뿐 아니라, 앱이 플러그인의 실제 문구를 잘못 인용하게 된다. 플러그인 `.md` 자체는 §1 에서 이미 범위 밖(`스킬 카탈로그 .md 25개 ❌`)이라, 거울도 함께 남는 게 맞다.

결과적으로 탭은 **영어 chrome + 한국어 데이터**가 된다. 어색해 보이지만 정직하다 — 헤딩은 앱의 UI 고, 설명은 플러그인이 실제로 뭐라고 말하는지의 인용이다. 앱 문구만 영어로 바꾸면 사용자가 Claude Code 에서 보게 될 실제 문구와 어긋난다.

`PENDING` 은 이제 "남은 UI 작업"만 세는 정직한 계기판이 됐다. 스캐너 docstring 의 완료 기준도 그에 맞게 고쳤다.

## SSOT 갱신

`03-i18n.md` 에 §5.1(번역하지 않는 것 3갈래 — 진단 로그 · DISK_CONTENT · contentLanguage 축)과 §5.2(프런트 프롬프트 본문)를 추가했다. 이번 라운드에서 파일별로 내린 판단이 흩어져 있었는데, 다음 사람이 같은 갈림길에서 다시 고민하지 않도록 표로 고정했다.

## 함정

`t` 섀도잉 1곳 (누적 32회) — `PLUGIN_TOOLS.map((t) => …)`. `tool` 로 개명.

문장 가운데 `.oculpm` 이 `<code>` 로 들어가는 문단은 §4.2 대로 prefix/suffix 분할.

## 검증

게이트 4종 exit 0 직접 확인 — typecheck / vitest 655통과(`plugin_docs_sync` 포함 — 거울이 그대로임을 확인) / lint(남은 미번역 54) / build.