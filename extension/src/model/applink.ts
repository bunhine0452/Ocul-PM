// VS Code → Ocul 앱 — 앱의 딥링크 `oculpm://open` (src-tauri/src/deeplink.rs) 주소를 만든다. 앱은 열기 전에
// 확인 시트로 묻고, 이미 등록된 프로젝트만 연다. 링크는 여는 것 하나뿐이라 아무것도 바꾸지 않는다.

export const APP_SCHEME = "oculpm";

export type AppTarget = { kind: "view"; view: "today" | "journal" | "planner" | "diff" } | { kind: "journal"; path: string } | { kind: "plan"; id: string };

/** `root` 는 프로젝트 폴더의 절대 경로(파일 시스템 경로). */
export function appLink(root: string, target: AppTarget): string {
  const q = [`project=${encodeURIComponent(root)}`];
  if (target.kind === "view") q.push(`view=${target.view}`);
  if (target.kind === "journal") q.push(`journal=${encodeURIComponent(target.path)}`);
  if (target.kind === "plan") q.push(`plan=${encodeURIComponent(target.id)}`);
  return `${APP_SCHEME}://open?${q.join("&")}`;
}

/** VS Code 통합 터미널에 칠 줄 — `/oculpm:next` 스킬이 다음 항목을 [~] 로 잡고 구현 → 확인 → 일지까지 한다. */
export function nextCommand(planId: string | null): string {
  return planId ? `claude "/oculpm:next ${planId.replace(/[^A-Za-z0-9_-]/g, "")}"` : `claude "/oculpm:next"`;
}
