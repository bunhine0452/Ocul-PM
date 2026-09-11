// `oculpm://open` 딥링크 조립 — 순수 함수. 앱 쪽 계약은 `src-tauri/src/deeplink.rs`:
// `project` 는 **등록된** 프로젝트 루트 절대경로(아니면 앱이 거절), `view=journal`,
// `entry` 는 일지 절대경로. (앱은 2026-09-11 현재 `view`/`entry` 를 아직 안 쓴다 —
// 플랜 `{#app-deeplink-entry}`.)
//
// `URLSearchParams` 를 쓰지 않는 이유: 공백을 `+` 로 적는데 앱의 `percent_decode`
// 는 `+` 를 공백으로 되돌리지 않는다(text.rs 테스트 `a%2Bb → a+b`). 경로에
// 공백이 있는 프로젝트가 등록 목록과 안 맞아 거절당한다 — `%20` 으로 보낸다.
export function buildOpenDeepLink(root: string, entryAbs?: string): string {
  const parts = [`project=${encodeURIComponent(root)}`, "view=journal"];
  if (entryAbs !== undefined) {
    parts.push(`entry=${encodeURIComponent(entryAbs)}`);
  }
  return `oculpm://open?${parts.join("&")}`;
}
