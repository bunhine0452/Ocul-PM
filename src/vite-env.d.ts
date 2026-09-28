/// <reference types="vite/client" />

// Injected by vite `define` (vite.config.ts) — short git SHA shown in
// Settings → 정보. vitest has no define, so call sites guard with `typeof`.
declare const __BUILD_HASH__: string;

interface ImportMetaEnv {
  /**
   * 업데이터 스모크 빌드만 "1" (portability.yml `updater-smoke` · components/UpdateBanner.tsx).
   * 릴리스 빌드에는 없다.
   */
  readonly VITE_OCULPM_UPDATER_SMOKE?: string;
}
