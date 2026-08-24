---
schema_version: 1
type: feature
slug: mobile-bridge-mb4-chat-power
status: done
difficulty: medium
created_at: "2026-08-24T16:13:00+09:00"
session_id: "manual-20260824-161300"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/llm.rs"
    op: update
  - path: "src-tauri/src/mobile_bridge/server.rs"
    op: update
  - path: "src/mobile/tabs/AiTab.tsx"
    op: update
  - path: "src/mobile/MobileApp.tsx"
    op: update
  - path: "src/mobile/PairScreen.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/mobile_ai.test.tsx"
    op: create
related:
  - "20260824/Features_to_add/1601_feature_mobile-bridge-mb3-shell.md"
tags: [mobile, llm, sse, power]
---

[x] 모바일 브리지 MB4 — AI 스트리밍(chat SSE) + caffeinate 전원 유지

## 추가 기능

- **run_chat_stream 추출** (llm.rs): 스트리밍 본체의 싱크를 IPC Channel 에서
  mpsc 로 일반화 — 데스크톱 chat_stream 커맨드와 모바일 SSE 가 폴백·부분응답
  규칙("Delta 후 폴백 금지, 종료는 Done/Error 정확히 1회")을 한 코드로 공유.
  기존 커맨드는 mpsc→Channel 포워딩 셸로 축소.
- **POST /api/chat** (보호): ChatSseRequest {provider, messages, options,
  fallbacks} → event "chat" / data ChatEvent JSON 스트림. API 키는 서버
  키체인에서만 — 폰에는 절대 안 내려간다 (D5).
- **AiTab 개방**: 맥의 LLM 설정 11키를 settings_get 으로 읽어 데스크톱과 같은
  순수 헬퍼(entriesToSettings·providerModel·parseFallbacks)로 프로바이더 결정.
  "Mobile" 대화로 영속(conversation/chat_message 커맨드) — 데스크톱 AI 패널
  에서도 이력이 보인다. 델타 누적 말풍선·에러 시 빈 말풍선 회수·system_prompt
  선두 주입.
- **caffeinate** (#mb4-caffeinate): 서버 기동 시 /usr/bin/caffeinate -i 자식
  (유휴 잠자기만 저지 — 뚜껑 닫힘은 우회하지 않는다, D7), stop/앱종료 시 kill.
  실패해도 서버는 계속. PairScreen 에 연결 실패 3점검 힌트(깨어있음·Tailscale
  양쪽·서버 실행) 상시 표시.

## 동작 흐름

폰 AI 탭 → 설정 로드 → 메시지 전송 → /api/chat SSE → 맥이 키체인 키로
프로바이더 호출(폴백 체인 동일) → 델타가 폰 말풍선에 실시간 누적 → 완료 시
양측 메시지가 대화 DB 에 영속.

## 검증

- cargo test 875 — 신규: 미설정 프로바이더가 스트림 내 error 이벤트로 끝나는
  전체 파이프(키체인 부재 경로, 네트워크 0).
- vitest 1295 — 신규 2: 델타 2건이 한 말풍선에 누적 + user/assistant 영속
  호출 검증(ReadableStream 실물) · 스트림 error 노출+빈 말풍선 회수.
- typecheck / lint / build exit 0. 실 LLM 왕복은 실기기 검증(#mb3-verify)과
  함께 사용자 확인 필요.
