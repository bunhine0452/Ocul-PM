// 일지 한 건의 「믿을 근거」 상태 하나 (4.0 일지·변경 화면이 같이 쓴다).
//
// 세 가지가 섞이기 쉬워서 한 곳에서 가른다.
//  - `evidence`      : 검증 칸에서 읽은 등급 — 0 없음 · 1 칸만 · 2 돌린 명령과 결과 끝 줄.
//  - `verified_*`    : 사람이 「확인함」을 눌렀는가 (본문이 바뀌면 풀린다 — `verified.ts`).
//  - 유형            : 결함·기능·리팩토링만 증거를 요구한다. 에러·잡일은 없는 것을 꾸짖지 않는다.

import { isConfirmed } from "./verified";

/** 증거를 요구하는 유형 — `oculpm/evidence.rs` 의 판정 대상과 같다. */
const JUDGED = new Set(["bug", "feature", "refactor"]);

export type EvidenceState =
  /** 검증 칸에 명령 증거가 있다. */
  | "command"
  /** 증거는 모자라지만 사람이 지금 내용을 확인했다. */
  | "confirmed"
  /** 증거를 요구하는 유형인데 명령 증거도 사람 확인도 없다 — 예외, 화면이 보여 줄 것. */
  | "missing"
  /** 증거를 요구하지 않는 유형이고 말할 것이 없다. */
  | "none";

interface EvidenceInput {
  type: string;
  evidence: number;
  verified_by_user: boolean;
  verified_stale: boolean;
}

export function evidenceStateOf(e: EvidenceInput): EvidenceState {
  if (e.evidence >= 2) return "command";
  if (isConfirmed(e)) return "confirmed";
  return JUDGED.has(e.type) ? "missing" : "none";
}

/** 필터 「증거 없음」 과 경고 칩이 같은 정의를 쓴다. */
export function isEvidenceMissing(e: EvidenceInput): boolean {
  return evidenceStateOf(e) === "missing";
}
