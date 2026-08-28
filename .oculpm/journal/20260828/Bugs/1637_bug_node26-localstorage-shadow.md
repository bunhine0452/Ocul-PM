---
schema_version: 1
type: bug
slug: "node26-localstorage-shadow"
status: done
difficulty: medium
created_at: "2026-08-28T16:37:00+09:00"
session_id: "manual-20260828-163700"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/storageShim.ts"
    op: create
  - path: "src/__tests__/setup.ts"
    op: update
  - path: "scripts/check-no-localstorage.mjs"
    op: update
related: [".oculpm/journal/20260828/Bugs/1627_bug_code-gutter-transparent-on-hscroll.md"]
tags: ["testing", "vitest", "jsdom", "node", "toolchain", "claude-code"]
---

[x] Node 26 이 jsdom 의 localStorage 를 가려 로컬 테스트 게이트가 통째로 죽던 문제

## 발생 원인

`pnpm test` 가 로컬에서 **19파일/201건** 실패했다. 전부 같은 한 줄에서 죽었다 —
`beforeEach` 의 `localStorage.clear()` 가 `TypeError: Cannot read properties of
undefined`.

Node 22 부터 런타임이 실험적 `globalThis.localStorage` / `sessionStorage` 를 자체
전역으로 들고 다닌다. `--localstorage-file` 없이 뜨면 그 getter 는 **undefined 를
돌려준다**(실행 시 `ExperimentalWarning: localStorage is not available because
--localstorage-file was not provided` 가 프로세스마다 찍힌다). vitest 의 jsdom
환경은 jsdom window 의 속성을 Node 전역에 복사하면서 **이미 전역에 있는 키는
건너뛰므로**, 이 자리를 Node 쪽 getter 가 계속 차지한다.

실측으로 확인한 것:
- 전역의 `localStorage` 서술자는 `{enumerable:false, configurable:true}` 접근자 —
  jsdom 것이 아니다. 프로토타입 사슬(3단)을 훑어도 jsdom 의 getter 는 없다.
  즉 **jsdom 이 만든 진짜 Storage 는 전역에서 닿을 길이 자체가 없다.**
- `location.href` 는 `http://localhost:3000/` 로 정상 — 불투명 origin 문제가
  아니어서 `environmentOptions.jsdom.url` 을 준다고 해결되지 않는다.

CI 는 `node-version: 22` 라 초록이었다. 그래서 이 증상은 **로컬에서만** 보였고,
`.oculpm/planner/ci-and-module-boundaries.md` 의 `#t4-baseline`(1,303건 그린) 이후
개발 머신의 Node 가 26 으로 올라오면서 조용히 들어왔다.

## 해결 방법

`src/__tests__/storageShim.ts` — 전역 스토리지가 **쓸 수 없을 때만** 메모리
Storage 를 깔아 주는 테스트 전용 셰임. jsdom Storage 의 관찰 가능한 동작만
구현한다(키·값 문자열 강제, 없으면 `null`, `length`/`key`). 이미 쓸 수 있으면
(구버전 Node·실제 브라우저) 손대지 않으므로 개발자의 Node 버전과 무관하게 같은
게이트가 성립한다. `sessionStorage` 도 같은 축이라 함께 세운다 (`lib/toast.ts` 의
drift 쿨다운이 쓴다).

`setup.ts` 의 **첫 import** 로 걸었다 — ESM 은 import 를 선언 순서대로 실행하므로,
나중에 모듈 스코프에서 스토리지를 만지는 코드가 생겨도 셰임이 먼저 선다.
`check-no-localstorage.mjs` 의 allowlist 에도 한 줄 추가했다(스토리지를 *쓰는*
코드가 아니라 스토리지 자체를 *세우는* 자리라 예외가 맞다).

Node 를 22 로 고정하는 길도 있었지만 택하지 않았다 — 개발자 머신의 런타임을 묶는
대신 테스트 하니스가 스스로 서게 하는 편이 범위가 좁고, 프로덕션(실제 웹뷰)에는
아무 영향이 없다.

## 검증

`pnpm test` 201 실패 → **116파일/1,327건 전건 통과**. typecheck·lint·build
+ `cargo test` 모두 exit 0. 셰임 도입 전 클린 트리(HEAD 5aab5e3)에서도 같은 201건이
실패함을 스태시로 확인해 선재 결함임을 못 박았다.

## 메모

첫 전체 실행에서 `acp_conversation_seams` 1건이 5초 타임아웃으로 떴는데, 단독
실행은 5/5 통과이고 재실행에서 1,327건 전건 통과라 116파일 동시 실행의 부하
흔들림이다. 상시 재현되면 그 스위트의 `testTimeout` 을 따로 올리는 게 맞다.
