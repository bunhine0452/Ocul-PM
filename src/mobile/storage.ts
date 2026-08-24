// 모바일 셸의 로컬 영속 (#mb3-tabs).
//
// localStorage 직접 사용 예외 축(린트 allowlist): 폰 브라우저에는
// WorkspaceContext 를 올리지 않는다 — 데스크톱 워크스페이스 상태(창·탭·필터)와
// 폰의 "마지막 프로젝트" 는 서로 다른 기기의 다른 상태다.

const PROJECT_KEY = "oculpm:mobile:project";

export function getSavedProjectId(): number | null {
  try {
    const raw = window.localStorage.getItem(PROJECT_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveProjectId(id: number | null): void {
  try {
    if (id === null) window.localStorage.removeItem(PROJECT_KEY);
    else window.localStorage.setItem(PROJECT_KEY, String(id));
  } catch {
    // 프라이빗 모드 등 — 매번 프로젝트를 고르게 될 뿐.
  }
}
