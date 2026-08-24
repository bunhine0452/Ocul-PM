// 모바일 브리지 HTTP 전송 (#mb2-shim, 플랜 D3).
//
// 브라우저(폰)에서 `@tauri-apps/api/core` 의 invoke 를 대신한다 —
// POST /api/invoke/{cmd} 는 인자 camelCase·응답 JSON 이 네이티브 invoke 와
// 같은 계약이라 (MB1 #mb1-envelope) 여기서는 fetch 로 나르기만 한다.
//
// localStorage 직접 사용은 이 파일이 유일한 예외 축(린트 allowlist 등재):
// 토큰은 React/WorkspaceContext 가 뜨기 전, 첫 invoke 전에 필요하다.

const TOKEN_KEY = "oculpm:mobile:token";

/** 웹뷰(데스크톱) 인지 — 브라우저(폰)에는 tauri internals 가 없다. */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 사파리 프라이빗 모드 등 — 토큰 없이 401 로 흘러가고 페어링 화면이 받는다.
  }
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * 네이티브 invoke 의 브라우저 대체 — resolve 는 커맨드 Ok 값, reject 는
 * 에러 **문자열** (bindings.ts 의 typedError 가 그대로 envelope 에 담는다).
 */
export async function httpInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  let body: string;
  try {
    // Channel 인자는 toJSON 이 던진다 — 스트리밍 커맨드는 MB4 전까지 비지원.
    body = JSON.stringify(args ?? {});
  } catch (e) {
    throw e instanceof Error ? e.message : String(e);
  }

  let res: Response;
  try {
    res = await fetch(`/api/invoke/${cmd}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body,
    });
  } catch (e) {
    throw `mobile bridge unreachable: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (res.ok) {
    return (await res.json()) as T;
  }
  let message = `HTTP ${res.status}`;
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      message = String((parsed as { error: unknown }).error);
    }
  } catch {
    // 본문이 JSON 이 아니면 상태 코드 문자열로 남는다.
  }
  throw message;
}
