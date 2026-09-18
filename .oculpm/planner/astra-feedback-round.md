---
oculpm_plan: v1
id: astra-feedback-round
title: "Astra 외부 리뷰 수용 라운드 — 코드로 확인된 결함 6건 + 검토 효력 해시"
status: active
created: 2026-09-15
updated: 2026-09-15
owner: claude-code
---

docs/Astra feedback/ 의 10점 마스터보고서·백로그 48건을 검토해(일지 20260915/Chores/2127) A군(싸고 실재)만 받았다. 나머지는 이미 활성 플랜에 있거나(B27→#csp·B41→#big-files·B30·B13) 보류(B06·B09·B15)·기각(B21·B43·B47). 병렬 세션이 항목 단위로 구현하고 오케스트레이터가 합류·게이트·PR.

## Phase 1 — 기록 보존 (Rust) {#p1-preserve}
- [x] 신규 일지 비덮어쓰기 생성 (B04/B05) — 쓰기 진입점 3곳(mcp/tools/mod.rs·manager/journal.rs·manager/indexing.rs)이 exists→rename 이라 두 프로세스가 같은 이름을 고르면 뒤가 앞을 덮는다. atomic_io 에 배타적 게시(write_atomic_new: tmp+fsync→hard_link, AlreadyExists 면 __N 재선택) + 공통 헬퍼 + 2프로세스 테스트(plan_cas_two_process 식)로 본문 전부 보존 확인 {#journal-create-excl}
- [x] file_guard Drop 소유 검증 (12.4) — 오래된 락 회수(mtime 10초 remove_file→create_new) 뒤 회수당한 원주인의 Drop 이 새 주인의 락을 경로로 지운다. nonce 를 락 파일에 적고 Drop 은 nonce 일치 때만 삭제, 회수는 rename-to-unique 뒤 확인·삭제. 회귀 테스트 {#guard-owner-check}

## Phase 2 — 배포 파이프라인 (release.yml · ci.yml) {#p2-release}
- [x] 태그 커밋 CI 통과 게이트 (B31) — release.yml 에 gate 잡: 태그가 가리키는 정확한 커밋의 CI check-run conclusion==success 를 폴링 확인(실패·취소·없음은 차단, conclusion 필드로 판정), build 는 needs: gate {#release-ci-gate}
- [x] release.yml 툴체인을 rust-toolchain.toml 로 (B32) — ci.yml 과 같은 grep 단계로 @stable 대신 핀 버전 설치 {#release-toolchain}
- [x] 서명·공증 사후 검증 (B33) — 릴리스를 draft 로 만들고 .app/.dmg 에 codesign --verify --strict · spctl -a · stapler validate · updater .sig/latest.json 존재를 확인한 뒤에만 undraft. 하나라도 실패하면 draft 로 남고 공개 안 됨. docs/RELEASE.md 갱신 {#release-sign-verify}
- [x] 확장 테스트를 CI 에 (B35) — extension/ 의 vitest(test:unit) 를 ci.yml 프런트 잡에 추가. vscode-test(디스플레이 필요)는 후속으로 기록 {#ci-ext-unit}

## Phase 3 — 기록의 의미 {#p3-meaning}
- [x] verified_by_user 를 내용 해시에 묶기 (B10, ← improvement-round #verified-loop 의 답) — 확인 시 본문 blake3 를 frontmatter verified_hash 에 기록, 색인 시 디스크 본문 해시와 대조해 verified_stale 을 캐시·JournalEntry 에 노출, UI 는 「확인 뒤 변경됨 · 다시 검토」 배지 + 통계에서 검증 수 제외. 해시 없는 기존 8건은 그대로 인정(백필 없음). 스키마는 additive — 옛 앱이 새 일지를 읽는 것을 깨지 말 것 {#reviewed-hash}

## Phase 4 — 문서·약속 {#p4-docs}
- [x] 지원 등급 문구 (B45) — 에이전트별 등급(규칙 호환 / 구조화 기록 MCP / 세션 관측 훅 / 앱 통합 ACP)을 코드(agents/·register.rs·plugin 훅·ACP)에서 도출해 README ko/en + 랜딩 ko/en 의 「N개 에이전트 지원」을 등급표로 교체, build.mjs 재빌드. 검증 날짜는 모르면 비워 둘 것(지어내지 않음) {#support-tiers}
- [x] docs/README.md 색인에 docs/Astra feedback/ 를 외부 리뷰(살아 있는 백로그 출처)로 한 줄 추가 {#docs-index}

## Phase 5 — 합류·게이트·이월 {#p5-merge}
- [x] 병렬 세션 브랜치를 feat/astra-feedback-round 로 합류 → typecheck·test·lint·build·cargo fmt/clippy/test 전부 exit 0 직접 확인 → PR → CI 초록이면 rebase 머지 {#merge-gates}
- [x] improvement-round-2026-09-14 #verified-loop 를 #reviewed-hash 일지로 닫기 {#verified-loop-close}
- [~] 실기기·다음 릴리스: gate 잡이 CI 를 기다렸다 통과하는지, codesign/spctl/stapler 검증 로그, draft→공개 전환, 설치본 자동 업데이트 정상 (릴리스 때 확인) {#eyes-release-gate}
- [x] 랜딩 등급표 배포 — cd landing && vercel --prod (수동, 머지 뒤) {#landing-deploy}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-15T21:41:13+09:00 | #journal-create-excl | claude-code | ☐→~ |  | 병렬 세션 R1 착수 (worktree) |
| 2026-09-15T21:41:18+09:00 | #guard-owner-check | claude-code | ☐→~ |  | 병렬 세션 R2 착수 (worktree) |
| 2026-09-15T21:41:22+09:00 | #release-ci-gate | claude-code | ☐→~ |  | 병렬 세션 Y1 착수 — Phase 2 네 항목 한 세션 |
| 2026-09-15T21:41:26+09:00 | #reviewed-hash | claude-code | ☐→~ |  | 병렬 세션 R3 착수 (worktree) |
| 2026-09-15T21:41:31+09:00 | #support-tiers | claude-code | ☐→~ |  | 병렬 세션 D1 착수 — #docs-index 도 같은 세션 |
| 2026-09-15T21:53:54+09:00 | #guard-owner-check | claude-code | ~→x | .oculpm/journal/20260915/Bugs/2153_bug_file-guard-nonce-ownership.md | R2 완료 a735b85 (worktree 브랜치, 합류 대기) — nonce 소유·rename 뒤 확인·hard_link put_back, 9/9 |
| 2026-09-15T21:56:06+09:00 | #support-tiers | claude-code | ~→x | .oculpm/journal/20260915/Chores/2156_chore_support-tiers-and-docs-index.md | D1 완료 b2c9738 — 4등급 표 README/랜딩/위키 ko·en, 검증 열은 실측 기록만 |
| 2026-09-15T21:56:11+09:00 | #docs-index | claude-code | ☐→x | .oculpm/journal/20260915/Chores/2156_chore_support-tiers-and-docs-index.md | D1 완료 a1a2e24 — docs/README.md 살아 있는 설계 표에 외부 리뷰 행 |
| 2026-09-15T21:59:37+09:00 | #journal-create-excl | claude-code | ~→x | .oculpm/journal/20260915/Bugs/2159_bug_journal-exclusive-create.md | R1 완료 6ff2589+c08601a — write_atomic_new(hard_link, rename 폴백)·create_journal_file·8프로세스 테스트(옛 코드에서 빨감 확인) |
| 2026-09-15T22:01:38+09:00 | #release-ci-gate | claude-code | ~→x | .oculpm/journal/20260915/Features_to_add/2201_feature_release-gate-sign-verify.md | Y1 완료 8dd8fc5 — 실제 API 로 v3.1.1 통과/5432b6e 차단 확인. v3.1.1 은 붉은 커밋에서 나갔었다 |
| 2026-09-15T22:01:43+09:00 | #release-toolchain | claude-code | ☐→x | .oculpm/journal/20260915/Features_to_add/2201_feature_release-gate-sign-verify.md | Y1 완료 d74015c — ci.yml 단계 그대로 이식 |
| 2026-09-15T22:01:48+09:00 | #release-sign-verify | claude-code | ☐→x | .oculpm/journal/20260915/Features_to_add/2201_feature_release-gate-sign-verify.md | Y1 완료 f29424b — draft→codesign/spctl/stapler/updater 검증→undraft, v3.1.1 실물로 스크립트 실측. dmg 는 tauri 가 공증 안 함(서명만 단언) |
| 2026-09-15T22:01:53+09:00 | #ci-ext-unit | claude-code | ☐→x | .oculpm/journal/20260915/Features_to_add/2201_feature_release-gate-sign-verify.md | Y1 완료 6826f63 — extension vitest 27 통과. vscode-test(xvfb) 는 후속 |
| 2026-09-15T22:15:54+09:00 | #reviewed-hash | claude-code | ~→x | .oculpm/journal/20260915/Features_to_add/2215_feature_verified-hash-stale-review.md | R3 완료 51c6034+2001325 + 해요체 fix-up — verified_hash·verified_stale(039)·「다시 검토」. 육안은 eyes 원장으로 |
| 2026-09-15T22:16:06+09:00 | #verified-loop-close | claude-code | ☐→x |  | improvement-round #verified-loop done 처리 |
| 2026-09-15T22:25:18+09:00 | #merge-gates | claude-code | ☐→x |  | PR #24 CI 3잡 success → rebase 머지, main 1e4116b4. 로컬 게이트 전부 0 확인 뒤 푸시 |
| 2026-09-15T22:25:23+09:00 | #landing-deploy | claude-code | ☐→x |  | vercel --prod → oculpm.com 별칭, 등급 문구 라이브 확인 (api/notion TS 경고는 기존 비치명) |
| 2026-09-16T00:27:10+09:00 | #eyes-release-gate | claude-code | ☐→~ | .oculpm/journal/20260915/Chores/2342_chore_release-3-2-0.md | v3.2.0 run 34983572575: gate 가 CI(34983566910) 8분 대기 뒤 success 판정 → draft → 서명·공증·업데이터 검증 step 전부 success → undraft. 자산 5, latest 리다이렉트 v3.2.0. 남은 것: 설치본 자동 업데이트 육안(사용자) |
| 2026-09-17T20:50:30+09:00 | #eyes-release-gate | claude-code | ~→~ | .oculpm/journal/20260917/Chores/2050_chore_release-3-2-1.md | v3.2.1 로 2회째 통과 — gate 가 CI 6분 대기 후 통과·draft→공개·latest.json 실자산. 남은 것: 설치본 3.2.0→3.2.1 자동 업데이트 육안 |
| 2026-09-18T22:49:18+09:00 | #eyes-release-gate | claude-code | ~→~ | .oculpm/journal/20260918/Chores/2249_chore_release-3-2-2.md | v3.2.2 3회째 통과 — gate·검증·draft 해제 전부 success. 남은 것: 설치본 자동 업데이트 육안 |
<!-- oculpm:plan-log end -->
