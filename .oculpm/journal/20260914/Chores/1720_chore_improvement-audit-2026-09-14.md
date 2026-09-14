---
schema_version: 1
type: chore
slug: "improvement-audit-2026-09-14"
status: done
difficulty: medium
created_at: "2026-09-14T17:20:09+09:00"
session_id: "20260914-001"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d8c385d3-64d1-435b-abff-82b045ae0918"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "audit"
  - "release"
  - "storage"
  - "indexer"
  - "llm"
  - "acp"
  - "planner"
  - "mcp-tool"
---
[x] 개선점 감사 (2026-09-14) — 미출시 최적화 4커밋 · 스냅샷 HEAD 중복 69% · 파일당 git spawn · 죽은 모델 조용한 실패 · MCP 이중 기동

## 동기

"oculpm 의 개선점을 찾아 달라"는 요청. 이전 감사(08-30·09-11)의 교훈대로 grep 보다 설치본 로그·SQLite dbstat·프로세스 실측·git 계보를 우선했다. 코드 변경 없음 — 발견 목록만.

## 변경 요약 (발견 17건, 우선순위순)

**A. 배포 계보**
1. 최적화 라운드(d429ef4 임베딩 아레나·vec0 재구축·스냅샷 화해·IME 덤프 예산, 31d5c75 유휴 언로드·MallocLargeCache, 일지 커밋 2건)가 `origin/main` 과 v3.0.0/v3.0.1 에 **없다**(`git cherry origin/main` +). 플랜 `optimization-round-2026-09-12` 는 done 으로 닫힘. 설치본 3.0.1 은 1일 14시간 가동 후 RSS **2,229MB** — 미출시 수정의 "이전" 수치 그대로. IME 자동 덤프도 2일간 157건(예산 미출시).
2. 이 워킹트리(feat/audit-round-20260911, main 대비 16 ahead/37 behind)의 dirty 76파일은 전부 main 에 이미 있는 옛 WIP. 미반영은 일지 2건뿐. 로컬 main 은 origin/main 보다 2커밋(v3.0.1) 뒤.

**B. 저장소 성장 (ocul-pm.db 615MB + WAL 67MB, dbstat: vec0 299MB · chunks 143MB · file_snapshots 104MB)**
3. `file_snapshots` 의 HEAD 중복 제거(`{#snapshot-git-dup}`)는 **재색인된 파일에만** 적용된다. 이 저장소만 2,262건 중 1,553건(69%)이 HEAD 에 있는 파일. 프로젝트 22 는 3,500건 전부 수정 이전 캡처. `retain_file_snapshots` 는 있으나 전체 재색인에서만 호출 → 시작 시 1회 화해 스윕이 필요.
4. `git::path_in_head` 가 색인 파일 **하나마다** `git cat-file -e` 프로세스를 띄운다(`indexer.rs:1072`). 1만 파일 전체 재색인 = 1만 spawn. `git ls-tree -r HEAD --name-only` 한 번으로 집합 캐시.
5. vec0 299MB 는 원시 165MB(107,381×384×4) 의 1.8배 — 재구축 코드가 1번 미출시 커밋에 있다.
6. `.gitignore` 된 `dist-measure/` 가 색인·스냅샷에 남아 있다 — 무시 규칙이 바뀐 뒤 옛 행을 지우는 경로가 없다.

**C. 조용한 실패**
7. 기본 프로바이더 nim 의 모델 `z-ai/glm-5.2` 가 2026-08-21 EOL(410). 색인 후 개요 생성이 매번 실패하고 `project.rs:547` WARN 로그만 남는다. `ModelInput` 은 datalist 라 목록에 없는 값에 경고가 없다.
8. `auto-index: reindex skipped reason=Generated` 가 WARN 레벨 — 정상 스킵은 DEBUG 로.
9. ACP Claude 세션마다 `oculpm-mcp` 가 **2개**(앱 주입 root 없음 pid 35587 + 플러그인 `--root` pid 35592). 도구 이중 노출·프로세스 2배.
10. `oculpm.log` 에 ANSI 이스케이프 18줄(acp connection span) — 파일 레이어 `with_ansi(false)`.

**D. 제품 신호**
11. `verified_by_user: true` 8 / 699. 검증 루프가 실제로 안 돈다 — v3 육안 원장과 통합하거나 필드를 정리.
12. 설정·랜딩의 VS Code 마켓플레이스 링크가 404(미발행), Open VSX 만 200.
13. 채택: v3.0.1 dmg 2·tar 4 다운로드, 스타 7, 이슈 0.

**E. 코드 위생**
14. 800줄 한계 초과: window.rs 3,028 · code.rs 2,251 · watcher.rs 2,163 · git.rs 1,580 · CodePane 1,555 · CodeScreenV2 1,471 · TerminalSurface 1,445 (정책 예외 6).
15. `allow(dead_code)` 42.
16. `#dead-command-audit`: 334 커맨드 중 프런트 미호출 0 (`oculpm_update_entry_meta` 는 모바일 브리지) — 항목 닫을 수 있음.

**F. 플랜 위생**
17. archived/done 플랜 안에 미완 항목 다수(실기기 확인 ~30건, `today-ring-followup` 의 변경 파일 수 43% 과대 집계 버그) — AGENTS.md v12 규칙("접힌 plan 의 미완은 유실") 위반 상태.

## 검증

- 로그: `logs/oculpm.log.2026-09-12~14` WARN 집계, INFO 키 집계(IME-DUMP 157).
- DB: 스크래치로 복사한 `ocul-pm.db` 에 `dbstat`·행 수·`captured_at`·`git ls-files` 교차(1,553/2,262).
- 계보: `git cherry -v origin/main HEAD`, `git grep MallocLargeCache origin/main` 0건, `ps -eo rss` 2,229MB.