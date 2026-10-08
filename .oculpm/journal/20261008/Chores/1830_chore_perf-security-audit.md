---
schema_version: 1
type: chore
slug: "perf-security-audit"
status: done
difficulty: high
created_at: "2026-10-08T18:30:54+09:00"
session_id: "20261008-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "security"
  - "performance"
  - "audit"
  - "indexing"
  - "mcp-tool"
---
[x] 최적화 · 보안 검토 — 설치본 실측 + 코드 대조, 발견 8건

## 방법
설치본 v3.9.0(가동 16시간, 앱 안 claude 세션 2개)에서 top · sample(UI · WebContent) · vmmap · dbstat(읽기 전용) · 로그 집계를 돌리고, 의심 자리마다 코드를 대조했다. 추정은 추정이라고 적는다.

## 최적화
- **색인 유령 행(확인)**: 디스크에 없는 파일의 청크가 14,664개(11.2%)다. 사라진 `ioreum-base` 폴더 하나가 8.4k를 차지한다. 프로젝트를 열 때의 자동 색인은 청크가 0일 때만 돈다(`ProjectTab.tsx`). `index_project` 의 화해 단계는 수동 재색인에서만 돌고, 9/24 이후 로그에 "index reconcile" 이 한 번도 없다.
- **저가치 색인(확인)**: 데이터 확장자가 16,468(12.6%)이다(.json 평가 결과 · .tsv · ML .flist). `vendor/` 는 차단되지 않는다. 내용이 같은 사본이 23,284(17.8%)다. DB 693MB 중 벡터가 388MB, 청크 본문이 182MB다.
- **유휴 CPU(증상 확인 · 원인 유력)**: 입력이 없는데 WebContent 8.5% · UI 3.7% · GPU 3.2%를 쓴다. UI 프로세스의 CVDisplayLink 가 상시 돌고, WebContent 에서 WebGL `prepareForDisplay` · rAF · 타이머가 잡혔다. 무한 CSS 애니메이션이 29곳이고, 터미널의 running/waiting 숨쉬기는 claude 가 떠 있는 내내 돈다. 창이 비활성일 때 멈추는 장치가 없다. 끄고 재는 실험은 아직이다.
- **메모리**: footprint 는 UI 933MB · WebContent 936MB · GPU 360MB 다. 심볼 없는 릴리스 바이너리라 귀속하지 못했다. `acp/node_modules` 는 디스크 540MB 다.
- **문제없음**: 임베딩 모델 300초 유휴 언로드가 정상 동작한다. Monaco(3.7MB)는 지연 로드이고, 첫 로드 JS 는 276KB 다. 고아 행 0, 워처 정상.

## 보안
- **[높음] 편집기에서 파일을 열면 저장소 코드가 실행된다**: rust-analyzer 를 initializationOptions 없이 띄운다. 기본값은 build.rs · proc-macro 실행이고, 저장소의 `.cargo/config.toml` 도 따른다. VS Code 의 Workspace Trust 같은 관문이 없다. v3.8.0 이 연 위협 모델("남의 저장소를 열 때")에 정면으로 걸린다.
- **[중간] 비밀 → 색인 → RAG → LLM**: indexer 는 `.env` 를 `.gitignore` 에만 기대 거른다. `history::should_capture` 의 `.env` 규칙을 색인 경로(`project.rs:374` 스냅샷)가 지나지 않고, 실제로 `.env.example` 이 스냅샷에 있다. AI 패널은 의미 검색 청크를 자동으로 주입하는데(`aiContext.ts:415`), 프롬프트 원장은 AI 패널을 "사용자 작성"이라며 마스킹에서 면제한다. 청크는 사용자 작성이 아니다. 실데이터 스캔에서 실제 키는 0건이었다(redact.rs 테스트 픽스처뿐).
- **[낮음] HF 개인 토큰**: hf-hub `ApiBuilder::new()` 가 로드마다 `~/.cache/huggingface/token` 을 읽고, 다운로드 요청에 Bearer 로 붙인다. 캐시가 있으면 네트워크는 없다(크레이트 소스로 확인).
- **[낮음] git core.fsmonitor**: 하드닝이 없다. `.git/config` 를 공격자가 쥔 경우(압축 파일로 받은 저장소)에만 해당한다.
- **문제없음**: CSP 가 `script-src 'self'` 이고 capabilities 는 최소다. react-markdown 은 raw HTML 을 받지 않는다. innerHTML 3곳은 전부 escape · hljs · DOM 경유다. `open_url` 은 http/https/mailto 만 연다. 딥링크는 확인 시트 + owner/repo 만 받는다. 플러그인은 hooks · bin 을 놓지 않고 MCP 명령을 보여 준다. 모바일은 Tailscale · 6자리 · 시도 제한 · 해시 토큰 · 허용 목록이다. PTY 소켓은 0600, SVG 는 `<img>` 로만 그린다. 로그 · DB 에 실제 키 0건.

## 검증
위 수치는 모두 이 세션에서 직접 잰 값이다(sample 파일 · 쿼리 · 스크립트는 세션 스크래치패드). 유휴 CPU 의 원인 귀속과 메모리 귀속만 미검증이다.

## 메모
구현은 사용자 결정 뒤. 전부 수정 · 축소라 범위 동결 아래 허용된다.