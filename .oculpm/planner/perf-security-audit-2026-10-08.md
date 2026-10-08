---
oculpm_plan: v1
id: perf-security-audit-2026-10-08
title: "최적화 · 보안 검토 (2026-10-08) — 실측 발견 8건"
status: active
created: 2026-10-08
updated: 2026-10-08
owner: claude-code
---

설치본 v3.9.0 실측(top·sample·vmmap·dbstat·로그 집계)과 코드 대조로 낸 발견. 구현은 사용자 결정 뒤. 범위 동결(CLAUDE.md) 아래 전부 '수정·축소'라 허용 범위.

## 최적화 {#perf}
- [ ] 색인 유령 행 — 디스크에 없는 파일 청크 14,664(11.2%, 10개 프로젝트, ioreum-base 폴더 통째 8.4k). 자동 색인은 청크 0일 때만(ProjectTab.tsx), 화해는 수동 전체 재색인에서만(9/24 이후 0회) → 열 때 stat 전용 화해 {#idx-reconcile-on-open}
- [ ] 저가치 색인 — 데이터 확장자 16,468(12.6%: .json 평가결과·.tsv·.flist·.txt), vendor/ 미차단, 내용 같은 사본 23,284(17.8%) → 데이터 확장자 기본 제외·vendor 추가·임베딩 내용 해시 중복 제거 {#idx-low-value}
- [ ] 유휴 CPU ~15%(WebContent 8.5 · UI 3.7 · GPU 3.2) — CVDisplayLink 상시, 무한 CSS 애니메이션 29곳(터미널 running/waiting 숨쉬기는 claude 가 떠 있는 내내), 창 비활성 때 멈추는 장치 없음 → blur 시 animation-play-state: paused + top 전후 측정 {#idle-cpu-animations}
- [ ] 메모리 귀속 — UI 933MB(Malloc Small 400·Large 320) · WebContent 936MB · GPU 360MB, 심볼 없는 릴리스라 미확정 → 심볼 빌드로 측정 하네스(설치본 안 도는 때) {#footprint-attribution}

## 보안 {#sec}
- [ ] [높음] 편집기에서 파일만 열어도 저장소 코드 실행 — rust-analyzer 를 initializationOptions 없이 기동(기본 build.rs·proc-macro 실행, 저장소 .cargo/config.toml 준수), 신뢰 관문 없음 → 기기 신뢰 전까지 buildScripts·procMacro·checkOnSave 끄기, TS 는 번들 tsserver {#lsp-trust}
- [ ] [중간] 비밀 파일·하드코딩 키가 색인·스냅샷에 들고 RAG 로 LLM 에 마스킹 없이 나갈 수 있다 — indexer 가 .env 를 .gitignore 에만 기대(history::should_capture 미경유), aiContext 가 청크 자동 주입, 프롬프트 원장은 AI 패널을 '사용자 작성'으로 면제 → 색인 비밀파일 차단 + 청크 마스킹 + 원장 사유 정정 {#secret-files-index-rag}
- [ ] [낮음] fastembed→hf-hub ApiBuilder::new() 가 ~/.cache/huggingface/token 을 로드마다 읽고 다운로드에 Bearer 로 붙인다(공개 모델이라 불필요, 캐시 있으면 네트워크 없음) → HF_HOME 앱 캐시로 또는 로컬 파일 직접 로드 {#hf-token}
- [ ] [낮음] git 호출에 core.fsmonitor 하드닝 없음 — .git/config 를 공격자가 쥬 경우(압축으로 받은 저장소)만 → 공통 인자에 -c core.fsmonitor=false {#git-fsmonitor}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
