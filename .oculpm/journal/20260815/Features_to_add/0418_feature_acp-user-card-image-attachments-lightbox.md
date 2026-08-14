---
schema_version: 1
type: feature
slug: "acp-user-card-image-attachments-lightbox"
status: done
difficulty: medium
created_at: "2026-08-15T04:18:54+09:00"
session_id: "mcp-20260815-041854"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/__tests__/acp_turn_extras.test.ts"
    op: create
  - path: "src/styles/agent.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "ux"
  - "design"
  - "image"
  - "mcp-tool"
---
[x] 사용자 발화를 말풍선에서 카드로 · 첨부 이미지에 파일명·픽셀 크기 · 크게 보기

## 말풍선을 걷어냈다

이 화면에서 사용자가 쓰는 것은 한 줄 대꾸가 아니라 **번호 붙은 요구사항 묶음**이다. 우측 정렬·`max-width: 85%` 풍선에 담으면 문장이 계단처럼 꺾이고, 읽는 눈이 매 턴 좌우로 뛴다. 전폭 카드(옅은 테두리 + 카드 배경)로 바꿨다.

`.msg.user` / `.msg-bubble` 규칙 자체는 **에이전트 화면(AI 패널)이 공유**하므로 건드리지 않고 `.acp-layout` 아래로만 덮었다. 저쪽은 짧은 대화라 풍선이 맞다.

## 붙인 것이 대화에 남는다

지금까지 붙여넣은 이미지는 **보내는 순간 사라졌다** — 컴포저의 칩만 있었고 대화에는 아무 흔적이 없어, 스크롤을 올려도 "이 지시에 무슨 사진을 줬더라"를 알 수 없었다. 사용자 턴에 `attachments`/`images` 를 얹었다.

빈 배열은 넣지 않는다: 있는 것과 없는 것을 화면이 구분해야 하고, 빈 배열을 남기면 첨부 줄이 그려지고 그 안이 비어 여백만 생긴다. 배열은 **복사해서** 넣는다 — 컴포저 상태를 비울 때 이미 보낸 턴이 같이 비면 안 된다.

## 파일명과 픽셀 크기

`AcpImage` 에는 이름도 크기도 실을 자리가 없다(프로토콜이 mime + base64 만 받는다). 화면에는 필요하므로 컴포저가 **더 들고** 보낼 때 프로토콜 몫만 떼어 낸다. 크기는 붙여넣는 순간 한 번 그려 봐서 잰다 — 못 재면 치수만 빼고 이미지는 그대로 보낸다(치수는 곁들이는 정보이지 보낼 수 있느냐의 조건이 아니다).

## 크게 보기

대화에 원본을 그대로 박지 않는다: 스크린샷은 대개 대화 폭보다 크고, 통째로 깔면 그 뒤의 지시문이 화면 밖으로 밀린다. 목록에서는 28px 썸네일 + 이름 + `1104×172` 만 두고, 누르면 라이트박스로 연다.

배경을 완전히 검게 덮지 않고 흐림을 섞었다 — 뒤 대화가 어렴풋이 남아야 "잠깐 확대해 본 것"이지 다른 화면으로 넘어온 것이 아니라는 감각이 산다.

**Escape 를 캡처 단계에서 먹는다**: 이 화면의 Escape 는 "생성 중단"이라, 그냥 두면 사진을 닫으려다 작업이 멎는다.

## 한계

`session/load` 로 되살린 지난 대화에는 이미지가 없다 — 재생은 텍스트만 흘려보낸다. 그 대화의 사진은 그 세션을 처음 열었던 창에서만 남는다.

## 검증

typecheck 0 · 프런트 810(턴 첨부 4건 추가) · lint 0 · build 0 · 백엔드 전 스위트.