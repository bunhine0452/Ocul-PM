---
schema_version: 1
type: chore
slug: "v3-round-parallel-audit"
status: done
difficulty: high
created_at: "2026-09-04T10:35:53+09:00"
session_id: "20260904-006"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".oculpm/discussion/v3-round/discussion.md"
    op: create
related: []
tags:
  - "discussion"
  - "audit"
  - "v3"
  - "buzz"
  - "ux"
  - "ui"
  - "architecture"
  - "mcp-tool"
---
[x] 3.0 을 정하기 전에 다섯 갈래로 먼저 본다 — 병렬 감사와 논의 문서

## 동기

3.0.0 의 범위를 정해야 하는데, 요청된 방향이 넷(UI 디자인 · UX · 현재 문제점 · block/buzz 차용)이고 서로 다른 렌즈였다. 한 세션이 순차로 보면 뒤로 갈수록 앞의 판단에 끌려간다. 그래서 **opus5 병렬 세션 다섯**을 서로 겹치지 않는 범위로 띄우고, 각자 독립적으로 결론을 내게 한 뒤 교차 검증했다.

## 조사 방법

세션별 범위 — ① 제품 결함(주장 vs 실제, 미완 표면, 이월 백로그 수거) ② UI 비주얼(CSS 21파일 14,707줄, 토큰·프리셋·대비) ③ UX·정보구조(첫 실행→매일→장기 여정, IA) ④ 아키텍처(모듈 경계·동시성·백프레셔·게이트·문서 드리프트) ⑤ buzz 재심(`[buzz-borrows]` 의 기각·보류를 3.0 렌즈로).

공통 제약: 소스·`.oculpm/`·git 무변경, **앱 실행 금지**(설치본과 락 경합), 빌드·테스트 금지, 추측을 사실로 쓰지 말 것, **과거 도그푸딩 기록을 먼저 읽어 이미 고쳐진 것을 새 결함으로 보고하지 말 것**. 총 도구호출 446회.

## 결과 요약

수렴이 개별 결함보다 강한 신호였다. 넷이 독립적으로 **문서 드리프트**를(루트 `CLAUDE.md` 구조 주장 12개 중 8개 오류, 잠갔다고 선언한 결정 6개가 코드에서 뒤집힘, `docs/` 206개에 색인 없음), 넷이 **조용한 실패**를, 셋이 **`AcpConversation.tsx` 2,192줄**을 가리켰다. 둘이 독립적으로 플래너 CAS 가 도달 불가능함을(`plan_status` 가 해시를 안 준다) 찍었다.

특기할 것 셋:

- **기록 규율의 세 표면**(배달 게이트 · 미기록 신호 · Today 카드)이 전부 「프로젝트 전역 journal mtime」한 근사에 얹혀 있어 병렬 세션에서 동시에 무너진다. v2.40.0 이 그걸 고치려고 `AgentRef.session` 을 넣었는데 **읽는 코드가 0곳**이다.
- **`[buzz-borrows]` 가 buzz `desktop/` 을 서버 영역으로 오독했다.** 실제로는 Tauri 2 + React 19 로 우리와 같은 스택, 331K줄이다. 그래서 F11(활동 피드) 기각이 뒤집혔다 — 렌더 층 전체가 1,121줄로 우리 `AcpConversation.tsx` 한 파일보다 작다.
- **요청과 조사가 한 곳에서 충돌했다.** "더 미학적 UI"에 대해 UI 감사는 "다시 그리지 말고 안 지킨 규칙을 닫아라"로 답했다(토큰 층 규율 정상, `lint:design` clean). 뒤집지 않고 양쪽을 다 후보안으로 올려 결정을 사용자에게 남겼다.

## 산출물

`.oculpm/discussion/v3-round/discussion.md` (49KB) — 문제 정의 · 조사 방법과 한계 · 발견 다섯 갈래 · 교차 검증 · 모순과 미해결 · 후보안 4개 · 결정 항목 6개 · 다음 단계 10건. `status: open` 으로 두었다. 결론은 쓰지 않았다 — 결정은 사용자 몫이고, 서면 뒤 플래너로 승격한다.

## 검증

문서가 `.oculpm/agents/discussion-spec.md` 규격을 지키는지 확인했다 — frontmatter 7키, `## 문제 정의` 최상단, 후보안 4개 전부 `### … {#opt-id}`, managed block(`oculpm:discussion-log`) 열림·닫힘 쌍, 다음 단계 10건이 전부 `- [ ]` + 줄 끝 안정 id. `awk` 로 `- [ ]` 줄의 앵커가 정확히 1개씩인지 검사했고, 참조와 자기 id 가 한 줄에 겹쳤던 1건을 고쳤다. 소스·설정은 한 줄도 바꾸지 않았다.