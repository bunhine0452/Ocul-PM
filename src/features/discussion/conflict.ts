/**
 * 쓰기 충돌을 알아보는 순수 규칙 (2026-09-08).
 *
 * 백엔드는 CAS 가 어긋났을 때 `write-conflict:` 로 시작하는 오류를 돌려준다
 * (`oculpm::agent_cli::WRITE_CONFLICT_PREFIX` — CLI 의 exit 5 를 가르는 그
 * 표지와 **같은 것**이다). 화면이 이것을 알아봐야 하는 이유는, 충돌은 다른
 * 실패와 달리 **사용자에게 물어볼 것이 있는** 실패이기 때문이다: 저장은 실패했지만
 * 초안은 멀쩡히 살아 있고, 어느 쪽을 남길지는 사람만 정할 수 있다.
 *
 * 메시지 본문을 정규식으로 뜯지 않는다 — 문구는 번역·다듬기의 대상이고 접두사는
 * 계약이다 (백엔드가 그 상수에 적어 둔 이유와 같다).
 */

/** 백엔드 `WRITE_CONFLICT_PREFIX` 와 **글자 그대로** 같아야 한다. */
export const WRITE_CONFLICT_PREFIX = "write-conflict:";

/** 이 실패가 "그 사이 남이 고쳤다" 인가. */
export function isWriteConflict(error: unknown): boolean {
  return typeof error === "string" && error.startsWith(WRITE_CONFLICT_PREFIX);
}
