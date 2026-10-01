import type { AppError } from "@/lib/bindings";

// 커맨드 경계의 단일 래퍼 (완성도 라운드 Phase 4 #error-convention).
//
// 생성된 `bindings.ts` 의 봉투는 `{status:"ok",data} | {status:"error",error}`
// 인데 `error` 가 커맨드마다 `string`(옛 계약)이거나 `AppError`(새 계약)다.
// 게다가 `typedError` 는 진짜 `Error`(IPC 전송 실패)를 봉투에 넣지 않고
// 던진다 — 호출자가 두 경로를 다 다뤄야 했다. `call` 은 셋을 하나의
// `ApiError { code, detail }` 로 접는다. 화면은 `code` 로 i18n 키를 고르고
// (`tError`), `detail` 은 로그·복사용 영어 원문이다.

export type Envelope<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string | AppError };

export class ApiError extends Error {
  readonly command: string;
  readonly code: string;
  readonly detail: string | null;
  constructor(command: string, error: AppError) {
    super(error.detail ?? error.code);
    this.name = "ApiError";
    this.command = command;
    this.code = error.code;
    this.detail = error.detail;
  }
  /** 봉투 모양으로 되돌린다 — `tError` 에 그대로 넘길 때. */
  toAppError(): AppError {
    return { code: this.code, detail: this.detail };
  }
}

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as AppError).code === "string" &&
    "detail" in (e as AppError)
  );
}

/** 문자열·AppError·던져진 Error 어느 것이든 `AppError` 모양으로. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  if (e instanceof ApiError) return e.toAppError();
  if (typeof e === "string") return { code: "unknown", detail: e };
  if (e instanceof Error) return { code: "unknown", detail: e.message };
  return { code: "unknown", detail: String(e) };
}

/**
 * 로그·토스트에 그대로 싣는 **원문** — 옛 문자열 계약의 `res.error` 자리.
 * 번역이 필요한 화면 문장은 `tError(toAppError(e))` 를 쓴다.
 */
export function errorDetail(e: unknown): string {
  const app = toAppError(e);
  return app.detail ?? app.code;
}

/**
 * 봉투를 풀어 값만 돌려주거나 `ApiError` 를 던진다. 전송 실패(reject)도 같은
 * 오류로 접는다 — 호출자는 `catch (e)` 하나면 된다.
 */
export async function call<T>(command: string, p: Promise<Envelope<T>>): Promise<T> {
  let res: Envelope<T>;
  try {
    res = await p;
  } catch (e) {
    throw new ApiError(command, toAppError(e));
  }
  if (res.status === "ok") return res.data;
  throw new ApiError(command, toAppError(res.error));
}

/**
 * 이벤트 구독 — 페이로드만 넘기고 해제 함수를 돌려준다. 이벤트에는 봉투가 없어
 * 접을 오류가 없으니, 래퍼가 하는 일은 비-Tauri 컨텍스트(jsdom·헤드리스)에서
 * **조용히 빈 해제 함수**를 주는 것이다 — 구독 실패로 화면이 죽으면 안 된다.
 */
export function subscribe<T>(
  event: { listen: (cb: (e: { payload: T }) => void) => Promise<() => void> },
  cb: (payload: T) => void,
): Promise<() => void> {
  try {
    return event.listen(({ payload }) => cb(payload)).catch(() => () => {});
  } catch {
    return Promise.resolve(() => {});
  }
}
