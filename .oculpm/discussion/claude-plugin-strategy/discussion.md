---
oculpm_discussion: v1
id: claude-plugin-strategy
title: "Claude Code/Desktop 플러그인·스킬 전략 + 3축 진단 (토큰·코드·제품)"
status: resolved
created: 2026-07-30
updated: 2026-07-31
owner: claude-code
---

## 문제 정의

ocul-pm 이 ECC(affaan-m/ECC)처럼 Claude Code / Claude Desktop 이 소비하는 스킬·플러그인 표면을
갖추려면 무엇을 어떤 순서로 만들 것인가. 단, ECC 같은 "설정 팩 재배포"가 아니라 **제품의
배포 채널·쓰기 경로·방법론 캐리어**로 설계해야 하고, 동시에 사용자의 야망 — "어떤 프로젝트든
시작부터 완벽한 설계와 구현을 만드는 최고의 도구" — 에 복무해야 한다. 함께 결정할 것:
제품의 쓸모 방향, 앱 코드 효율, 에이전트 통신 토큰 효율의 개선 우선순위.

2026-07-30 6방향 병렬 리서치(ECC 클론 분석 · 플랫폼 배포 표면 · 플러그인 갭 · 토큰 실측 ·
코드 감사 · 제품 진단) + 적대 검증 2회(기술 팩트 · 전략)를 거친 결과를 정리한다.

## 조사 요약 (2026-07-30 실측)

**현재 자산** — `plugin/oculpm/` 골격(CI8: 훅 3종+MCP, `--plugin-dir` 실로드 검증), oculpm-mcp
sidecar(v2.2.0 .app 동봉), 규칙 허브·스킬 갤러리·훅 브리지·transcript 초안 전부 기구현.

**갭 9개** — 플러그인에 스킬/커맨드 0개 · marketplace.json 없음(배포 채널 없음) · version 0.1.0
고정(앱과 비동기) · MCP 바이너리 macOS 절대경로 하드코딩 · 앱↔플러그인 택일 UX 부재(훅만
경고, MCP 이중 서버 미처리) · Desktop .mcpb 미검증 · MCP 도구 3개뿐(plan 생성 불가) ·
검증 부채(runtime-verify 4건+리뷰 5건+managed-block versioning) · **비추적 프로젝트 가드 부재**
(journal_write 가 `.oculpm` 없어도 create_dir_all — tools.rs:303. user 스코프 공개 배포 시 사고 경로).

**토큰 실측** (적대 검증에서 문자 단위 재현 확인) — AGENTS.md 템플릿 8,031 chars ≈ **~2,900 tok
이 전 추적 프로젝트·전 세션 상시 주입**. MCP 활성 세션에서 §2~§4(파일 규격)+§7 절반(plan-log
규격)= **49% 가 죽은 무게**. §8(discussion, ~520–760 tok)은 저빈도인데 상시 과금. Claude Code 는
MCP 스키마 deferred(~0 tok 실증: `plugin details` "tool schemas resolved at runtime"), Desktop 은
~850 tok 상시. 훅·transcript 경로의 API 토큰 비용은 0 확인.

**코드 감사** — 800줄 초과 Rust 15개(manager.rs 3,580)·TSX 9개(SettingsPanel 1,571). envelope
수동 언랩 **147곳/32파일**(unwrap 헬퍼 기존재 미사용). frontmatter 파서 3벌. CodeSnippet 만
hljs 풀빌드(808KB 청크; PatchView 는 이미 lib/common). `src-tauri/target` 116GB. 단 게이트는
건강(typecheck 2.6s·build 9.2s·테스트 777개) — **속도는 병목 아님**.

**제품 진단** — 파이프라인 뒤쪽 절반(구현→기록→회고→규칙)은 업계 최고 수준으로 두껍고,
앞쪽 절반(인셉션→스펙→설계→실행 지시)은 위저드 껍데기뿐. Greenfield 는 SPEC/EVALS/rules 를
하나도 생성하지 않고, **플래너는 백미러(기록)이지 핸들(추진)이 아님**. 경쟁: spec-kit/Kiro 는
앞쪽 절반의 정면 소유자이나 "실행 후 무슨 일이 있었나"를 버림 — 스펙(before)과 일지(after)를
한 파일 체계로 닫는 제품은 아직 없음 = oculpm 의 차별화 좌표.

**ECC 에서 가져올 것 / 피할 것** — 가져오기: marketplace.json+plugin.json 2파일 배포, validator
함정의 문서화+회귀 테스트 관행, 훅 안정 id+env 게이팅(`OCULPM_DISABLED_HOOKS`), "관찰은
훅(결정적)/판단은 LLM(확률적)" 분리, SessionStart 주입 문자수 캡, 훅 실패 전부 exit 0, 짧은
플러그인명(MCP 도구명 64자 제한). 피하기: 상시 로드 토큰 폭탄(ECC rules ~7K tok), 표면
비대(281 스킬 — 우리는 스킬 2~3·커맨드 1·훅 3), 설치 경로 3중화, matcher `*` 프로세스 스폰.
⚠ ECC 의 PLUGIN_SCHEMA_NOTES("hooks/agents 필드 금지")는 **현 CLI 2.1.220 실측과 배치되는
낡은 정보** — 검증 결과 현행은 정식 필드. 규칙 수입 대신 자동발견 위임+실로드 회귀 테스트가 정답.

## 후보 해결 방안

### 방안 A — 슬림 플러그인 + 활성화 배선 + 플래너 디스패치 병행 {#opt-slim-plugin}

3트랙 병행: ① 검증 부채 청산 → 슬림 플러그인 v1(훅+MCP+스킬 2~3) → 마켓플레이스 공개,
② 토큰 다이어트(템플릿 v6 이원화, 현 브랜치의 연속), ③ 플래너 디스패치(IN2, 플러그인 무의존
앱 기능). 인셉션 스킬은 디스패치 착지 후.

- 장점: 존재하는 강점(기록 루프)을 배포. 획득(플러그인)과 전환(디스패치·활성화 배선)을 동시
  설계. 검증 부채가 공개 배포보다 선행 — 신뢰 사고 예방. 1인 캐파에 맞는 절제.
- 단점: 인셉션(야망의 앞쪽 절반)은 3순위로 밀림.
- 비용: 라운드 3개(아래 로드맵), 신규 화면 0개.

### 방안 B — 인셉션 우선 (설계 도구부터) {#opt-inception-first}

project-inception 스킬 + Greenfield 개편을 먼저 만들어 "설계부터 완벽한 도구" 서사를 세운 뒤 배포.

- 장점: 야망과 서사 일치. 첫인상이 "기록기"로 굳는 것 방지.
- 단점: 배포 채널 0 인 상태로 spec-kit/Kiro 와 정면전(후발). 스킬의 운반체(플러그인)가 없어
  도달 불가. 디스패치 없는 인셉션 산출물은 spec-kit-lite 에 불과 — 적대 검증에서 기각됨.

### 방안 C — 풀 표면 동시 구축 (Desktop .mcpb 포함 원안) {#opt-full-surface}

플러그인 v1 에 스킬·커맨드·인셉션·Desktop .mcpb 까지 한 번에.

- 장점: 표면 완결성.
- 단점: Desktop 은 훅·플러그인 없음 — 쓰기 경로 핵심이 원천 불가한 표면에 패키징 트랙 신설
  (수요 증거 0, 플랫폼별 바이너리 서명 부담, 스키마 ~850 tok 상시). 미완성 인셉션 스킬 동봉은
  내부 모순. 1인 캐파 초과 — 적대 검증에서 기각됨.

## 권고 로드맵 (방안 A 상세)

### Round A — 플러그인 v1 "앱 없이도 기록이 시작된다" (PR-A0~A3)

- **A0 안전·부채 선청산** (공개 배포의 전제): ① #managed-block-versioning — gitignore 블록
  downgrade 로 `.oculpm/hooks` 대화내용이 public repo 에 커밋될 수 있는 프라이버시 사고 경로.
  버전 마커+forward-only+회귀 테스트. ② **MCP 비추적 가드** — journal_write/plan_update 에
  `.oculpm` 존재 검사(미추적 시 명시적 에러). ③ 리뷰 잔여 5건 + 실기기 검증 4건.
- **A1 스키마·경로 정합**: plugin.json 의 hooks/mcpServers 필드 제거(자동발견 위임 — 신구 CLI
  모두 안전), 최소 CLI 버전 명시, CI 에 `--plugin-dir` 실로드+details 인벤토리(Hooks=3, MCP=1)
  회귀 테스트. `bin/oculpm-mcp` 셔틀(`#!/bin/sh`, 앱 번들→~/.local→target/debug 탐색, 미발견 시
  stderr 설치 안내), 실행비트 보존 검증. release CI 가 plugin version 을 앱 버전으로 스탬프.
  플랫폼 스탠스 명시(v1=macOS, oculpm-mcp 는 순수 Rust bin 이라 release.yml 3-platform 배포가
  앱 포팅 없이 가능 — 후속).
- **A2 스킬 동봉 + 활성화 배선**: `skills/oculpm-journal/`(슬림 템플릿의 풀 스펙 캐리어 — TK1 과
  한 쌍, description 은 영어), 갤러리 3종 플러그인 이관(플러그인이 SSOT, 단 플러그인 디렉터리
  자기완결 제약 — 앱은 빌드 시 복사). 커맨드 `/oculpm:standup` 1개. **퍼널 활성화 3종**:
  ① `.oculpm/README.md` 자동 생성(디렉터리 정체+뷰어 앱 링크 — repo 자체를 발견 채널화),
  ② Stop 훅 stderr 1줄("이 세션 일지 N건 — /oculpm:standup 또는 앱에서 보기", exit 0 유지),
  ③ standup 출력 말미 앱 포인터(데모 순간). 스킬 description 토큰 예산을 수용 기준에 포함.
- **A3 마켓플레이스 공개**: 레포 루트 `.claude-plugin/marketplace.json`(source `./plugin/oculpm`),
  README 는 git-source add 형태만(`/plugin marketplace add bunhine0452/Ocul-PM` — 직접 URL 은
  상대경로 미해석), 앱 설정 "플러그인으로 설치"(훅 **+MCP** 택일 — 플러그인 감지 시 register.rs
  프로젝트 .mcp.json 등록 생략), ECC memory-persistence 식 "훅이 읽고 쓰는 것" 계약 문서 1장,
  anthropics/claude-plugins-community 제출 + 발사 글(한국 커뮤니티+글로벌).

### Round B — 토큰 다이어트 (PR-TK0~1, 현 브랜치 연속, A 와 병행)

- **TK0**: `plan_create` MCP 도구 추가(또는 fallback 파일에 신규 plan 템플릿 보존 — 둘 중 하나가
  슬림화 전제. plan_create 쪽이 frontmatter 오기입까지 원천 차단하므로 권장).
- **TK1 템플릿 v6**: claude-code 어댑터 = MCP-first 슬림(~400 tok: §1 트리거+도구명+§5 금지+폴백
  포인터)+MCP instructions 강화(~200 tok). 비MCP 어댑터(cursor/gemini 등) = 압축 풀(~1,600 tok).
  §8 discussion 은 전 어댑터 on-demand 파일 분리. `.claude/CLAUDE.md` 의 `@../AGENTS.md` import →
  1줄 텍스트(이중 주입 위험 소멸). **언어 축 동시 설계(en 변형)** — template_version bump 레버리지를
  두 번 쓰지 않기 위해 v6 에서 함께.
- 측정 목표: Claude Code 세션당 3,100→~600 tok(−80%), 비MCP 3,100→~1,700(−45%).

### Round C — 플래너를 핸들로 (PR-IN2 → IN0, A·B 와 병행 가능한 독립 트랙)

- **IN2 플래너 디스패치 v1** (승격됨 — 플러그인 무의존, 기존 앱 사용자를 즉시 전환시키는 유일
  항목이자 "설계가 구현을 끌고 간다"를 처음으로 참으로 만드는 기능): 플래너 항목 → "이 항목
  실행" → 항목 텍스트+관련 일지 2건+해당 rules 를 프롬프트 조립해 기존 터미널로 Claude Code
  발화. 자동화·큐잉은 v2.
- **IN0 project-inception 스킬** (IN2 착지 후): STAGE 0~3(문제정의→SPEC→EVALS.md→초기 rules→plan
  시드)을 에이전트가 수행, 산출물은 `.oculpm/discussion/`+`planner/`+EVALS.md. **성공 기준 =
  "문서 4종 생성"이 아니라 생성물이 기존 파서 3개(discussion 승격·EVALS `## 기록` 표 규약·rule
  paths)에 무수정으로 물리는가.** 범용 PRD 문구 배제 — "oculpm 파일 체계를 시드하는 스킬"로
  포지셔닝. 플러그인 버전 bump 로 사후 동봉.
- **IN1 위저드 연결**: GreenfieldWizard 마지막 단계가 IN0 스킬 발화 안내.

### 라운드 아님 (즉시 체크리스트 + 보이스카웃)

- 즉시 2건: `cargo clean`(116GB 회수), CodeSnippet hljs → `lib/common`(808KB→~90KB, 한 줄).
- 보이스카웃 규칙으로 격하: envelope 언랩 147곳 수렴(oculpmApi 표면 확장 선행 필요),
  manager.rs 분할, frontmatter 파서 3벌 단일화, 대형 컴포넌트 탭 분해 — 해당 파일을 어차피
  만지는 작업에 동승. managed-block 공용 모듈만 A0 의 #managed-block-versioning 에서 파생 시 함께.

### 원칙

- **표면 동결**: 신규 화면 금지. 검색·코드맵·터미널·AI패널은 유지보수 모드 (예외: 기존 화면이
  A~C 의 소비처가 되는 배선 — 터미널←IN2, 설정←A3 택일 UX — 은 허용).
- **Desktop .mcpb 는 백로그**: 기존 register.rs 원클릭으로 종결. 실사용자 요청 2건+ 시 재개
  (그때도 plan_status/standup 읽기 전용 슬림 도구셋).
- **버전 스큐 계약**: 플러그인(마켓플레이스)·앱(updater)·템플릿(template_version) 3자 스큐의
  최소 버전 매트릭스를 A3 전에 문서화.

## 토의 / 메모

<!-- oculpm:discussion-log begin v1 -->
| 시각 | 작성자 | 내용 |
|---|---|---|
| 2026-07-30T23:52:00+09:00 | claude-code | 6방향 리서치 완료(ECC 클론·플랫폼·플러그인 갭·토큰 실측·코드 감사·제품 진단). 핵심: MCP 세션 템플릿 49% 죽은 무게, 플러그인 갭 9개, 앞쪽 절반(인셉션) 부재 |
| 2026-07-30T23:52:30+09:00 | claude-code | 적대 검증(기술): ECC PLUGIN_SCHEMA_NOTES 는 현 CLI 2.1.220 기준 낡음(validate·실로드 통과 실측). 치명 발견 = journal_write 가 비추적 프로젝트에 무가드 .oculpm 생성 — 공개 배포 전 필수 가드 |
| 2026-07-30T23:53:00+09:00 | claude-code | 적대 검증(전략): PL3(.mcpb) 백로그 강등, IN2(디스패치) 독립 트랙 승격("백미러→핸들"이 자기 진단과 모순되게 최후순위였음), 퍼널 활성화 배선 3종 추가, 영어/i18n 축을 템플릿 v6 에 지금, 코드 효율은 라운드가 아니라 즉시 2건+보이스카웃 |
| 2026-07-31T00:09:00+09:00 | claude-code | 사용자 방안 A 승인. 미결 3건 답: ① 오픈소스·무료 확정, ② 성공 프록시 미정 → star·릴리스 다운로드·이슈 유입 월 1회 수동 스냅샷으로 기본값 채택(텔레메트리 없음 유지), ③ 팀 읽기 뷰 시점 불확실 → 백로그(재론 트리거: 배포 후 팀 수요 신호). planner/plugin-round.md 로 승격, status resolved |
<!-- oculpm:discussion-log end -->

## 결론

**채택 = 방안 A** (슬림 플러그인 + 활성화 배선 + 디스패치 병행) — 2026-07-31 사용자 승인.
근거: 존재하는 강점(뒤쪽 절반)을 배포하면서, 전환 메커니즘(활성화 배선·디스패치)을 동시에
설계해야 "플러그인 설치 → 기록이 쌓임 → 앱은 뷰어" 퍼널이 소원이 아니라 메커니즘이 된다.
인셉션은 운반체(플러그인)와 차별화 전제(디스패치)가 선 다음이 순서다.

미결 3건 확정: ① **오픈소스·무료** — 회수는 채택(스타·커뮤니티)·포트폴리오, 유료화 없음
전제로 발사 문구 작성. ② **성공 프록시** = GitHub star·릴리스 다운로드 수·이슈 유입을 월 1회
수동 스냅샷(텔레메트리 없음 유지 — 사용자 미정 응답에 대한 기본값 채택). ③ **팀 읽기 전용
뷰** = 백로그, 재론 트리거는 플러그인 배포 후 팀 수요 신호(예: 관련 이슈 2건+).

실행 추적은 `.oculpm/planner/plugin-round.md` 로 이관 — 이 문서는 여기서 닫는다.

## 다음 단계

- [x] 방안 A 승인 여부 결정 + 미결 3건(가격·성공 프록시·팀 뷰 시점) 응답 {#next-ratify}
- [x] 승인 시 Round A~C 를 `.oculpm/planner/plugin-round.md` plan 으로 승격 {#next-promote-plan}
- [x] 즉시 2건 처리: cargo clean + CodeSnippet hljs lib/common {#next-quick-wins}
- [>] A0 착수: managed-block versioning + MCP 비추적 가드 — planner #a0-managed-block·#a0-mcp-guard 로 이월 {#next-a0}
