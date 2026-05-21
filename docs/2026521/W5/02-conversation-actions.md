# 02. 마이그레이션 009 — conversation_actions 테이블

> **작업 ID**: W5 / UI-5 데이터
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §6.1 ("ActionProposalCard의 localStorage → SQLite")

---

## 변경 요약

`ChatPanel` 의 ActionProposalCard 적용 상태를 보관하던 흩어진 localStorage
`action_${convId}_${i}` 키를 SQLite `conversation_actions` 테이블로 이전.
ChatPanel 마운트 시 1 회 마이그레이션을 자동 수행.

## 신규 파일

### `src-tauri/migrations/009_conversation_actions.sql`

```sql
CREATE TABLE IF NOT EXISTS conversation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('applied','dismissed','errored')) DEFAULT 'applied',
  applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(conversation_id, message_index)
);
CREATE INDEX IF NOT EXISTS idx_conv_actions_conv
  ON conversation_actions(conversation_id);
```

설계:
- **`UNIQUE(conversation_id, message_index)`** + 백엔드의 ON CONFLICT 절 →
  Idempotent 한 `record_conversation_action` 가능 (재호출은 `applied_at` 갱신).
- **`CASCADE ON DELETE`** — conversation 이 삭제되면 함께 정리.
- **status enum 확장 여지**: 현재 `"applied"` 만 쓰지만 `dismissed`/`errored`
  자리를 미리 마련해 향후 PR 에서 UI 가 풍부해질 때 마이그레이션 불필요.

## 수정 파일

### `src-tauri/src/db.rs`

- 마이그레이션 목록에 v9 추가.
- 신규 struct `ConversationAction`.
- 신규 메서드:
  - `record_conversation_action(conv_id, msg_idx, status)` — upsert + 반환.
  - `list_conversation_actions(conv_id)` — 한 conversation 전체.

### `src-tauri/src/commands/conversation.rs`

Tauri 래퍼:
- `record_conversation_action(conv_id, msg_idx, status?)` — `status=null` 이면
  `"applied"` 기본.
- `list_conversation_actions(conv_id) → Vec<ConversationAction>`.

### `src/features/chat/ChatPanel.tsx`

`ActionProposalCard` 의 props 변경:
- 제거: `actionKey: string | null`
- 추가: `conversationId: number | null`, `messageIndex: number`

상태 관리도 SQLite 기반으로:
- 마운트 시 `listConversationActions(conversationId)` 비동기 페치 → 일치하는
  `message_index` 가 `applied` 면 즉시 "applied" 로 전환.
- `handleApply()` 성공 후 `recordConversationAction(...)` 호출.

call site 두 군데 (`isWorkspaceMode` 분기) 모두 새 props 사용.

### Migration helper (`migrateLegacyActionKeys`)

`ChatPanel` 마운트 시 1 회 호출. 동작:
1. `localStorage` 전체를 훑어 `action_*` 키 중 값 `"applied"` 만 추출
2. `key.split("_")` 로 `convId` / `msgIdx` 파싱 (잘못된 포맷은 무시)
3. 각각에 대해 `recordConversationAction(convId, msgIdx, "applied")`
4. 성공한 키 삭제
5. 센티넬 `aipm:conv_actions_migrated:v1 = "done"` 설정 → 다음부터 즉시 종료

UI 를 블록하지 않게 `void` 처리. 실패해도 다음 실행 때 재시도.

## eslint 정책

`scripts/check-no-localstorage.mjs` 의 allowlist 에서 `ChatPanel.tsx` 는
*마이그레이션 코드 때문에 한시적 유지*. 다음 PR 에서 (마이그레이션 검증
사이클 1~2 회 후) allowlist 에서 제거 가능.

## 검증

```
$ cd src-tauri && cargo check
warning: `ai-pm` (lib) generated 5 warnings
errors: 0
$ npx tsc --noEmit
exit=0
$ pnpm lint
✓ no direct localStorage access outside the allowlist
```
