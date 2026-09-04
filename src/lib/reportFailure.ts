/**
 * 실패를 **말하게 한다** (v2.42.0 `{#floating-promises}` · `{#settings-set-unhandled}`).
 *
 * 돌려받을 값이 없는 비동기 호출을 `void` 로 버리면 두 가지가 함께 사라진다:
 * 거절은 unhandled rejection 이 되어 콘솔에만 남고, 화면은 이미 낙관적으로 새
 * 값을 그린 뒤라 **사용자는 저장·취소가 됐다고 믿는다.** `void` 를 붙이는 것은
 * 그 착각을 고치지 않고 린트만 조용하게 만든다 — 이 저장소가 110곳에서 그랬다.
 *
 * 그래서 여기서는 봉투(`{status:"error"}`)와 전송 거절을 `call` 로 한 모양으로
 * 접고, 그 결과를 토스트로 **사용자에게** 말한다. 콘솔에도 남긴다 —
 * `lib/oculpmLog.ts` 의 브리지가 그것을 `oculpm.log` 로 흘린다.
 *
 * ## 왜 dedup 이 붙어 있는가
 *
 * 이 함수를 부르는 자리 중에는 루프(`kill_pty_session` 을 페인 수만큼)와 연속
 * 조작(슬라이더 커밋)이 있다. 어댑터가 죽어 있으면 한 번의 조작이 토스트를
 * 여러 장 쌓는데, 그건 알림이 아니라 소음이다. 같은 문구는 짧은 창 안에서
 * 한 장만 뜬다.
 */
import { call, toAppError, type Envelope } from "@/api/invoke";
import { t, type I18nKey } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toast } from "@/lib/toast";

/** 같은 문구가 겹치는 창 — 한 번의 조작이 여러 호출로 갈라질 때를 위한 것이다. */
const DEDUP_WINDOW_MS = 4_000;

/**
 * 이미 붙잡은 실패 하나를 사용자에게 말한다.
 *
 * 프로미스를 넘길 수 없는 자리를 위해 열어 둔다 — 자기 계약상 **거절하면 안 되는**
 * 함수(`SettingsContext.set`)가 안에서 잡은 오류를 여기로 넘긴다.
 */
export function announceFailure(key: I18nKey, error: unknown): void {
  announce(key, error);
}

function announce(key: I18nKey, error: unknown): void {
  const detail = tError(toAppError(error));
  toast.destructive(t(key, { error: detail }), {
    dedupKey: `fail:${key}`,
    dedupWindowMs: DEDUP_WINDOW_MS,
  });
  console.error(`[fail] ${key}: ${detail}`);
}

/**
 * 생성된 커맨드 하나를 끝까지 책임진다 — 봉투를 열고, 실패하면 말한다.
 *
 * `command` 는 진단용 이름(`ApiError.command`)이다. 화면에는 안 보이지만 로그와
 * 오류 객체에 남아 "무엇이 실패했나"를 되짚을 수 있게 한다.
 */
export function reportFailure<T>(
  command: string,
  p: Promise<Envelope<T>>,
  key: I18nKey,
): void {
  void call(command, p).catch((e) => announce(key, e));
}

/**
 * 이미 봉투를 벗긴 프로미스(로컬 async 함수·`oculpmApi`·컨텍스트의 `set`)용.
 * 거절만 잡으면 되므로 `call` 을 거치지 않는다.
 */
export function reportRejection(p: Promise<unknown>, key: I18nKey): void {
  void p.catch((e) => announce(key, e));
}
