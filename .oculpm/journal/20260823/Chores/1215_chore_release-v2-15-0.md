---
schema_version: 1
type: chore
slug: release-v2-15-0
status: in_progress
difficulty: medium
created_at: "2026-08-23T12:15:00+09:00"
session_id: "manual-20260823-121500"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
related:
  - ".oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md"
  - ".oculpm/journal/20260821/Features_to_add/1910_feature_journal-retrieval-tools.md"
  - ".oculpm/journal/20260821/Bugs/1842_bug_oculpm-live-refresh.md"
  - ".oculpm/journal/20260823/Bugs/1146_bug_code-tree-hidden-files.md"
tags: [release, landing, vercel, lsp, ide]
---

[~] v2.15.0 릴리스 — 밀려 있던 라운드 넷을 풀어서 한 번에 냈다

## 작업 내용

릴리스 자체보다 **앞단 정리가 본체**였다. HEAD 가 v2.14.1 릴리스 커밋에 멈춰 있는
동안 워킹트리에 **완료된 라운드 네 개가 커밋되지 않은 채** 겹쳐 쌓여 있었다 — 전부
일지까지 쓰인 상태로.

| 라운드 | 커밋 |
|---|---|
| MCP 일지 검색·읽기 도구 | `081e29f` |
| 위키 완성 + 영문판 | `357d999` |
| LSP 코드 인텔리전스 | `761defb` |
| oculpm 라이브 새로고침 | `5b313a6` |
| (이번 라운드) 코드 트리 점 파일 | `34b739c` |

### 경계를 어떻게 갈랐나

`git add -A` 는 쓰지 않았다 (병렬 세션 WIP 를 쓸어 담은 사고 전례). 라운드마다
명시 경로만 스테이징하고 `add`→`commit` 을 한 호출로 묶었다 — 병렬 세션이 인덱스와
HEAD 를 공유하므로 그 사이가 벌어지면 내용이 뒤섞인다.

가른 뒤에도 **두 라운드가 두 파일을 공유**하고 있었다. `lib.rs` 는 LSP 커맨드 11종
등록과 라이브 새로고침의 `OculpmDataChanged` 이벤트 등록을 함께 담고, `bindings.ts`
는 그 둘에서 생성되는 파일이다. 훅으로 쪼개면 중간 커밋의 생성 파일이 어느 쪽과도
맞지 않아 **빌드가 깨진 커밋**이 역사에 남는다.

그래서 순서로 풀었다 — LSP 를 먼저 넣고 `spec.rs` 의 이벤트 **정의와 등록만** 동승
시켰다. 정의는 있고 emit 하는 쪽(watcher)이 아직 없는 상태라 무해하게 컴파일되고,
다음 커밋이 emit 을 붙인다. 커밋 메시지에 그 사실을 적어 뒀다.

### 다섯 면

- 버전 5파일 — `package.json` · `tauri.conf.json` · `Cargo.toml` ·
  `plugin.json` · `marketplace.json`. (뒤 둘은 `plugin_manifest` 테스트가 동기를 강제)
- `CHANGELOG.md` — `## v2.15.0`. 릴리스 노트의 유일한 소스라 태그와 헤더가 정확히
  일치해야 한다. awk 추출로 1,376자 나오는 것을 푸시 전에 확인했다.
- `README.md` · `README.en.md` **양쪽** — 하이라이트 섹션 신설 + 이전 것 강등,
  「화면 구성 / Screens」의 **코드** 항목을 "뷰어·에디터" 에서 LSP 기능을 나열하는
  문장으로 교체.
- `landing/index.html` — 버전 문자열 **6곳**(RELEASE.md 는 5곳이라고 적지만 실제로는
  다운로드 버튼이 둘이라 6곳) · JSON-LD `featureList` 한 줄 · 변경사항 `<li>` ·
  벤토 셀 3개(그리드가 6칸이라 `c-span2` 3개 = 한 줄) · FAQ 갱신.

FAQ 는 **새로 넣은 게 아니라 고쳐야 했다.** 기존 「앱 안에서 코드를 직접 보거나
수정할 수 있나요?」 답변이 "자동완성이 필요한 무거운 편집은 「외부 에디터로
열기」로" 라고 적고 있었는데, 이번 릴리스가 바로 그 자동완성을 넣었다. 놔뒀으면
라이브 사이트가 자기 제품에 대해 거짓을 말하는 상태가 된다. JSON-LD 와 `<details>`
두 곳에 같은 문장이 있어 둘 다 바꿨다.

## 검증

- 게이트 5종 — `cargo test` 705 + 통합 스위트 전부 / `pnpm typecheck` /
  `pnpm test`(96파일 1116건) / `pnpm lint` / `pnpm build` 각각 exit 0.
  버전 5파일을 고친 **뒤** 다시 돌렸다 (`plugin_manifest` 가 버전 동기를 잡는다).
- `grep "2\.14\.1" landing/index.html` — 남은 것은 v2.14.1 변경사항 항목뿐
  (역사 기록이라 남는 게 맞다).
- 태그는 `git push origin refs/tags/v2.15.0` 로 **단독** 푸시. `--tags` 는 옛
  태그 하나만 어긋나도 푸시가 통째로 거부되며 워크플로가 아예 안 돈다(v2.9.0 전례).
- `gh run list` 로 run 32614336662 이 실제로 뜬 것을 확인.
- 랜딩 `vercel --prod --yes` (git 연동이 없어 push 로 안 나간다) →
  `oculpm.com` alias 완료. `curl` 로 `"softwareVersion": "2.15.0"` 과
  「v2.15.0 받기」 확인, 새 위키 `/wiki/today` 200 · 영문 `/wiki/en/` 200.

## 메모

- **랜딩 빌드에 선재 오류가 있다.** `api/notion/oauth/{start,callback}.ts` 가
  `Buffer` · `process` 를 못 찾아 TS2580 을 6건 뱉는다 (`@types/node` 미설치).
  Vercel 이 그래도 배포를 완료하므로 이번 릴리스는 나갔지만, 이건 **타입 검사가
  실질적으로 꺼져 있다**는 뜻이라 언젠가 진짜 오류를 놓친다. 이번 릴리스 범위 밖이라
  건드리지 않았다.
- `pnpm test` 첫 실행에서 `acp_parallel_sessions.test.tsx` 가 `waitFor` 타임아웃으로
  1건 실패했다가 재실행에서 통과했다 — **플래키**. 이번 변경과 무관한 선재 문제이지만
  게이트를 재실행으로 통과시킨 셈이라 기록해 둔다.
- `.oculpm/discussion/discussion/`(id 가 `discussion` 인 「사용자가 찾은 버그들」)이
  추적되지 않은 채 남아 있다. 형제 논의는 전부 추적 중이라 누락으로 보이지만 사용자
  콘텐츠라 임의로 커밋하지 않았다.
