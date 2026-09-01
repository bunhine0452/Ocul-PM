/**
 * "이 URL 의 테마를 가져와라" — 딥링크가 갤러리에 건네는 요청
 * (Osaurus 라운드 Phase 8 `#landing-themes`).
 *
 * 왜 버스인가: 승인 시트는 창 단위이고 임포트는 **설정 → 모양** 안의 갤러리가
 * 소유한다 (충돌 되묻기 UI 가 거기 있다). 시트가 직접 임포트하면 충돌 질의를
 * 한 벌 더 만들어야 하고, 두 벌이면 하나는 반드시 뒤처진다.
 *
 * `settingsNav` 와 같은 끈적 플래그 규약이다 — 갤러리가 아직 마운트되지
 * 않았으면 마운트 때 `consumeThemeInstall` 로 회수한다.
 */
import { createIntentSlot } from "@/lib/createStore";

const slot = createIntentSlot<string>("oculpm:install-theme-url");

/** 딥링크 승인 뒤에만 부른다. 부르는 것만으로는 아무것도 받아오지 않는다. */
export function requestThemeInstall(url: string): void {
  slot.request(url);
}

/** 갤러리 마운트 시 한 번 — 대기 중인 URL 이 있으면 돌려주고 비운다. */
export function consumeThemeInstall(): string | null {
  return slot.consume();
}

/** 이미 떠 있는 갤러리용 구독. */
export function onThemeInstallRequest(fn: (url: string) => void): () => void {
  return slot.subscribe(fn);
}

/** 테스트 전용. */
export function resetThemeInstallIntent(): void {
  slot.reset();
}
