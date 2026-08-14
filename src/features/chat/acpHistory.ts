import type { AcpSessionSummary } from "@/lib/bindings";

// 지난 대화 목록의 **순서**.
//
// 어댑터가 주는 `updated_at` 은 세션 파일의 수정 시각이다. 그런데 대화를 열기만
// 해도(=`session/load`) 그 파일이 만져져 시각이 올라간다 — 한 마디도 안 했는데
// 목록 맨 위로 올라온다. 그러면 "최근에 이야기한 순서"라는 이 목록의 의미가
// 무너진다: 그냥 눌러 본 순서가 된다.
//
// 그래서 순서만큼은 **우리가 처음 본 시각**으로 고정하고, 우리가 그 대화에
// 실제로 말을 걸었을 때만 올린다. 어댑터의 값을 고치는 것이 아니라 화면의
// 정렬 기준을 우리가 아는 사실로 바꾸는 것이다.

/** 세션 id → 이 목록이 쓸 시각(ISO). 한 번 적히면 우리가 올릴 때만 바뀐다. */
export type ActivityLedger = Map<string, string | null>;

/**
 * 원장에 없는 세션은 지금 값을 적어 두고, 있는 세션은 **적힌 값을 쓴다.**
 * 그 값으로 최신순 정렬한 새 배열을 돌려준다 (입력은 건드리지 않는다).
 *
 * 시각을 모르는 대화(`null`)는 맨 뒤로 — 언제인지 모르는 것을 "가장 최근"
 * 자리에 놓으면 목록 첫 줄이 거짓말이 된다.
 */
export function stabilizeHistory(
  items: readonly AcpSessionSummary[],
  ledger: ActivityLedger,
): AcpSessionSummary[] {
  const stamped = items.map((item) => {
    if (!ledger.has(item.id)) ledger.set(item.id, item.updated_at);
    return { ...item, updated_at: ledger.get(item.id) ?? null };
  });

  return stamped.sort((a, b) => {
    if (a.updated_at === b.updated_at) return 0;
    if (a.updated_at == null) return 1;
    if (b.updated_at == null) return -1;
    return a.updated_at < b.updated_at ? 1 : -1;
  });
}

/** 그 대화에 말을 걸었다 — 이제 진짜로 가장 최근이다. */
export function markSpoken(ledger: ActivityLedger, id: string, at: string): void {
  ledger.set(id, at);
}
