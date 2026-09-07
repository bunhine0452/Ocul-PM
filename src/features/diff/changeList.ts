/**
 * 변경 목록의 순수 규칙 — 무엇을 한 줄로 세우고, 무엇을 기준선으로 삼는가.
 *
 * React·Tauri 를 import 하지 않는다. `DiffScreenV2` 안에 흩어져 있던 세 가지
 * 계산을 모았다 (분할 라운드, 플랜 `v3-release` {#planner-diff-split}) —
 * 목록 병합 · git 행 → 목록 모델 변환 · 기준선 자동 선택. 셋 다 "화면이 무엇을
 * 보여줄지" 를 결정하는 규칙이라, 렌더에서 떼어 두면 테스트로 못박을 수 있다.
 */

import type { ChangeOp, RecentChange } from "@/lib/recentChangesStore";

/**
 * 화면이 무엇과 비교하는가. "working" = 미커밋(git status + 라이브 워처),
 * "last_commit" = 직전 커밋(HEAD~1..HEAD). 작업트리가 깨끗할 때 화면이 텅
 * 비지 않도록 뒤쪽으로 넘어간다.
 */
export type DiffBaseline = "working" | "last_commit";

/**
 * git 이 준 변경 행(`git status` · 직전 커밋)을 목록 모델로.
 *
 * `ts: 0` 은 "언제인지 모른다" 가 아니라 **정렬상 가장 오래된 것**이라는 뜻이다
 * — 이 항목들은 이미 존재하던 바탕이고, 세션 중 들어온 라이브 편집이 그 위에
 * 최신으로 쌓여야 한다 (→ `mergeChanges`). `read: true` 도 같은 이유다: 앱이
 * 켜지기 전부터 있던 변경을 안 읽은 새 소식으로 세지 않는다.
 */
export function toBaselineChanges(
  rows: readonly { path: string; op: string }[],
): RecentChange[] {
  return rows.map((c) => ({ path: c.path, op: c.op as ChangeOp, ts: 0, read: true }));
}

/**
 * 영속 git 목록(앱 재시작·프로젝트 전환을 견딘다)과 라이브 파일 워처 버퍼를
 * 합친다. 경로로 중복을 제거하며 **워처 항목이 이긴다** — 가장 최신 op 와 진짜
 * 시각을 갖고 있기 때문이다. git 항목(ts=0)이 먼저 서서 바탕처럼 읽히고,
 * 라이브 편집이 최신으로 떠오른다.
 */
export function mergeChanges(
  git: readonly RecentChange[],
  watcher: readonly RecentChange[],
): RecentChange[] {
  const byPath = new Map<string, RecentChange>();
  for (const c of git) byPath.set(c.path, c);
  for (const c of watcher) byPath.set(c.path, c);
  return [...byPath.values()].sort((a, b) => a.ts - b.ts || a.path.localeCompare(b.path));
}

/**
 * 기준선 자동 선택 — 작업트리에 변경이 있으면(또는 돌아갈 커밋이 아예 없으면)
 * 작업트리, 아니면 직전 커밋. 사용자가 고르면 그 선택이 이긴다(핀).
 */
export function autoBaseline(workingCount: number, lastCommitCount: number): DiffBaseline {
  return workingCount > 0 || lastCommitCount === 0 ? "working" : "last_commit";
}
