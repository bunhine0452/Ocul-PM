import type { ConversationTrace, FirstJournal, FirstRecordLedger } from "@/lib/bindings";

// 첫 기록 카드의 **순수한 부분** (플랜 `first-record-loop` {#p1-card}).
//
// 원장(`first_record_ledger`)은 창 안의 대화를 전부 펴 주고, 카드는 그중
// 사용자에게 지금 말할 **한 문장**을 골라야 한다. 그 고르기가 여기다 — 화면과
// 떼어 둔 이유는 보고서 §7 의 상태표가 곧 회귀가 잦은 자리이기 때문이다:
// "일지가 원래 있던 프로젝트에서 총 개수가 1 이상이라는 이유만으로 성공
// 처리하지 않는다".
//
// 차례가 곧 우선순위다. 기록 확인 > 실행 중 > 기록 없이 종료 > 귀속 불명 >
// 준비. 성공은 **대화 id 로 귀속된 일지**뿐이고, 나머지는 전부 "아직" 또는
// "모름"이다.

export type FirstRecordView =
  /** 관측된 대화가 없다 — 준비 상태와 실행 행동을 보여 준다. */
  | { kind: "ready"; hooksSeen: boolean }
  /** 살아 있는 대화가 있고 아직 그 대화의 일지가 없다. */
  | { kind: "running"; conversation: ConversationTrace; liveCount: number }
  /** 어떤 대화가 자기 id 를 적은 일지를 남겼다 — 유일한 성공. */
  | { kind: "recorded"; conversation: ConversationTrace; journal: FirstJournal }
  /** 대화가 변경을 남기고 기록 없이 끝났다 (신호 원장). */
  | { kind: "missing"; conversation: ConversationTrace }
  /** 창 안에 일지는 있는데 어느 대화의 것인지 모른다. */
  | { kind: "unattributed"; count: number };

export function deriveFirstRecord(ledger: FirstRecordLedger): FirstRecordView {
  // 원장은 최근 활동 순이라 첫 매치가 곧 "가장 최근에 기록한 대화"다.
  const recorded = ledger.conversations.find((c) => c.first_journal != null);
  if (recorded && recorded.first_journal) {
    return { kind: "recorded", conversation: recorded, journal: recorded.first_journal };
  }
  const live = ledger.conversations.filter((c) => c.live);
  if (live.length > 0) return { kind: "running", conversation: live[0], liveCount: live.length };
  const missing = ledger.conversations.find((c) => c.missing_signal);
  if (missing) return { kind: "missing", conversation: missing };
  if (ledger.unattributed_recent > 0) return { kind: "unattributed", count: ledger.unattributed_recent };
  return { kind: "ready", hooksSeen: ledger.hooks_seen };
}

/** 대화 id 를 사람이 알아볼 길이로 — 세션 카드·미기록 카드와 같은 8자. */
export function shortConversation(id: string): string {
  return id.length > 9 ? `${id.slice(0, 8)}…` : id;
}

/** 탐침 결과 세 값 — `null` 은 탐침 실패(모름)이지 없음이 아니다. */
export type Probe3 = "yes" | "no" | "unknown";

export function probe3(value: boolean | null | undefined): Probe3 {
  if (value == null) return "unknown";
  return value ? "yes" : "no";
}
