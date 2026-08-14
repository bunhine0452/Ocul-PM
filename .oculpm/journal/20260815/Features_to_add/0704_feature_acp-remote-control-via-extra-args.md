---
schema_version: 1
type: feature
slug: "acp-remote-control-via-extra-args"
status: done
difficulty: medium
created_at: "2026-08-15T07:04:00+09:00"
session_id: "mcp-20260815-070400"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "feature"
  - "correction"
  - "mcp-tool"
---
[x] /remote-control — "불가능"이 아니었다. _meta 로 CLI 플래그를 넘긴다

## 앞서 단정한 것이 틀렸다

`/remote-control` 은 "ACP 에 대응 요청이 없으니 불가능"이라고 적고 터미널로 안내하게 해 뒀다. **없는 것은 대응 요청뿐이었고, 통로는 있었다.**

어댑터를 다시 읽어 찾은 것:

```js
extraArgs: { ...userProvidedOptions?.extraArgs, "replay-user-messages": "" }
const userProvidedOptions = sessionMeta?.claudeCode?.options;   // = params._meta
```

`session/new` 의 `_meta.claudeCode.options.extraArgs` 가 SDK 질의의 `extraArgs` 로 그대로 흘러가고, 그것은 **CLI 플래그**가 된다. CLI 에는 `--remote-control` / `--rc` 가 있고, 바이너리 안에 `remote-control-sdk` 라는 출처 표식까지 있다 — SDK 경로로 켜지는 길이 상정돼 있다는 뜻이다.

`_meta` 는 `serde_json::Map` 이라 우리가 원하는 대로 넣을 수 있다.

## 켜져 있는 대화에는 못 붙인다

질의를 만들 때 정해지는 값이라 도중에 못 바꾼다. 그래서 `/rc` 는 **원격 조종을 켠 새 대화**를 연다.

**실패하면 원래 대화를 되돌린다.** 이 길은 실측이 아니라 코드를 읽고 낸 추론이라 — 알 수 없는 플래그를 CLI 가 거부하면 세션 생성이 실패한다 — 그때 사용자가 보던 대화를 잃으면 안 된다.

## 아직 모르는 것 (숨기지 않는다)

- **정말 켜지는지 실측하지 않았다.** 계정이 붙은 상태에서 눌러 봐야 안다.
- **짝짓기 안내가 어디로 오는지 모른다.** 터미널에서는 링크/코드를 화면에 찍는데, ACP 위에서는 그것이 assistant 메시지로 올 수도, 아무 데도 안 나올 수도 있다. 후자면 켜지긴 해도 쓸 수 없다.

그래서 "된다"가 아니라 "통로를 열었으니 눌러 보자"로 남긴다. 안 되면 되돌리는 것까지가 이번 작업이다.

## 검증

typecheck 0 · 프런트 843 · lint 0 · build 0 · 백엔드 전 스위트. 기능 자체는 위에 적은 대로 **미실측**.