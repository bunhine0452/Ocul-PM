import { useCallback, useEffect } from "react";

import { useOptionalSettings } from "@/contexts/SettingsContext";
import { clampUiDensity, DENSITY_TOGGLE_EVENT, toggleUiDensity, type UiDensity } from "@/lib/density";
import { reportRejection } from "@/lib/reportFailure";

/**
 * 현재 밀도와 바꾸는 손. 프로바이더 밖(단위 테스트·시작 탭 일부)에서는 기본값
 * 「간단」을 읽고 `set` 은 조용히 아무것도 안 한다 — 밀도가 안 걸리는 것은
 * 기능이 아니라 환경이다.
 */
export function useDensity(): { density: UiDensity; set: (next: UiDensity) => void; toggle: () => void } {
  const ctx = useOptionalSettings();
  const density = clampUiDensity(ctx?.settings.uiDensity);
  const set = useCallback(
    (next: UiDensity) => {
      if (!ctx) return;
      reportRejection(ctx.set("uiDensity", next), "settings.saveFailed");
    },
    [ctx],
  );
  const toggle = useCallback(() => set(toggleUiDensity(density)), [set, density]);
  return { density, set, toggle };
}

/**
 * ⌘ . 수신기 — 프로바이더 안에 **한 번만** 마운트한다 (TabbedWindow). 툴바가 화면
 * 수만큼 있어도 뒤집히는 것은 한 번이다.
 */
export function DensityShortcut() {
  const { toggle } = useDensity();
  useEffect(() => {
    window.addEventListener(DENSITY_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(DENSITY_TOGGLE_EVENT, toggle);
  }, [toggle]);
  return null;
}
