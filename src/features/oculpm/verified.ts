// 「확인됨」의 뜻 하나 ({#reviewed-hash}, 2026-09-15).
//
// `verified_by_user` 는 사람이 「확인」을 눌렀다는 사실이고, 백엔드가 그 순간의
// 본문 해시를 같이 적는다. 그 뒤 본문이 바뀌면 캐시가 `verified_stale` 를
// 세운다 — 플래그는 켜져 있지만 **확인된 것이 아니다**. 체크 표시·확인 필터·
// 변경 그룹 머리글처럼 "이건 확인됐다" 를 말하는 자리는 전부 이 두 함수를
// 거친다. 원시 플래그를 직접 읽으면 확인 뒤 바뀐 일지가 확인된 척한다.

interface Verifiable {
  verified_by_user: boolean;
  verified_stale: boolean;
}

/** 지금 내용에 대해 확인됐다 — 체크 표시를 달 것. */
export function isConfirmed(e: Verifiable): boolean {
  return e.verified_by_user && !e.verified_stale;
}

/** 확인은 했는데 그 뒤 내용이 바뀌었다 — 「다시 검토」를 달 것. */
export function isStaleVerified(e: Verifiable): boolean {
  return e.verified_by_user && e.verified_stale;
}
