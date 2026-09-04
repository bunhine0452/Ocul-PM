/**
 * 설정 쓰기 하나를 **끝까지 책임지는** 한 줄 (v2.42.0 `{#settings-set-unhandled}`).
 *
 * `useSettings().set` 은 `async` 다. 설정 탭 12곳이 그것을 `void` 도 `catch` 도
 * 없이 버리고 있었고, `SettingsContext` 자신도 봉투의 `status` 를 보지 않았다.
 * 그래서 쓰기가 실패해도:
 *
 *  - 화면은 낙관적으로 새 값을 그린 채다 — **사용자는 저장됐다고 믿는다**
 *  - 전송이 거절되면 unhandled rejection 이 콘솔에만 남는다
 *
 * `void` 를 12곳에 붙이는 것은 두 번째만 지우고 첫 번째는 그대로 둔다. 실패를
 * **말하는** 것은 이제 `SettingsContext.set` 자신이 한다 (설정 탭 밖에도
 * 호출자가 있어 계약을 거절로 바꿀 수 없다 — 그 주석 참고). 이 훅은 두 가지를
 * 한다: 호출부에서 프로미스를 바닥에 떨어뜨리지 않게 하고, 그래도 새어 나오는
 * 거절(전송 실패 등)의 그물이 된다. 한 줄짜리로 둔 이유는 12곳이 같은 모양으로
 * 가야 하기 때문이다 — 자리마다 다른 처리는 결국 몇 곳이 빠진다.
 */
import { useCallback } from "react";
import { useSettings } from "@/contexts/SettingsContext";
import { reportRejection } from "@/lib/reportFailure";
import type { Settings } from "@/lib/settings";

export type SaveSetting = <K extends keyof Settings>(field: K, value: Settings[K]) => void;

export function useSaveSetting(): SaveSetting {
  const { set } = useSettings();
  return useCallback<SaveSetting>(
    (field, value) => reportRejection(set(field, value), "settings.saveFailed"),
    [set],
  );
}
