// 승인 선택지의 성격 판별 — 라벨이 아니라 `optionId` 로.
//
// 어댑터 0.71.0 이 ExitPlanMode 승인에 "컨텍스트를 비우고 계획만 들고
// 이어가기"를 더했다. 카드에서는 바로 옆의 "그냥 허용"과 글자만 다르고
// 무게가 같은데, 실제로 일어나는 일은 다르다 — **이 대화에서 지금까지 오간
// 것이 사라지고** 계획 문서 하나만 들고 새 컨텍스트로 넘어간다. 되돌리는
// 길이 없다. 같은 낯빛으로 나란히 두면 손이 같은 속도로 움직인다.
//
// 라벨로 가려내지 않는 이유가 있다. 어댑터의 라벨은 영어이고
// `Yes, clear context (37% used) and use auto mode` 처럼 값이 섞여 든다 —
// 문자열을 맞춰 보는 판별은 다음 버전에서 조용히 헛돈다. `optionId` 는
// 어댑터가 `PERMISSION_OPTION_ID` 상수로 들고 있는 안정적인 축이다.
const CLEAR_CONTEXT_PREFIX = "exit-plan-clear-";

/**
 * 이 선택지를 고르면 대화의 컨텍스트가 비워지는가.
 *
 * 해당하는 id 는 셋 — `exit-plan-clear-auto` · `-bypass` · `-accept-edits`.
 * 어느 권한 모드로 이어 가느냐만 다르고 "비운다"는 공통이라 접두사로 본다.
 * 비우지 않는 형제들(`exit-plan-auto` · `-bypass` · `-accept-edits` ·
 * `-default`)은 접두사가 겹치지 않아 오탐이 없다.
 */
export function clearsContext(optionId: string): boolean {
  return optionId.startsWith(CLEAR_CONTEXT_PREFIX);
}
