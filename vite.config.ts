import { createLogger, defineConfig, type Plugin } from "vite";
import path from "node:path";
import { createRequire } from "node:module";
import fs from "node:fs";
import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 리로드 수사 계측 (2026-07-20, dev 전용): Vite 서버가 터미널에만 찍던 줄
// (page reload 사유·"optimized dependencies changed" 등)을 파일로도 남긴다 —
// 클라이언트 쪽 [vite-diag] 와 짝을 이뤄 리로드 원인을 로그만으로 판정한다.
const VITE_LOG_FILE = "/tmp/oculpm-vite.log";
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const fileLog = (level: string, msg: string) => {
  try {
    fs.appendFileSync(VITE_LOG_FILE, `${new Date().toISOString()} ${level} ${stripAnsi(msg)}\n`);
  } catch {
    // 로그 파일 실패는 dev 를 막지 않는다
  }
};
const baseLogger = createLogger();
const fileTeeLogger: typeof baseLogger = {
  ...baseLogger,
  info: (msg, opts) => {
    fileLog("INFO", msg);
    baseLogger.info(msg, opts);
  },
  warn: (msg, opts) => {
    fileLog("WARN", msg);
    baseLogger.warn(msg, opts);
  },
  error: (msg, opts) => {
    fileLog("ERROR", msg);
    baseLogger.error(msg, opts);
  },
};

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Short git SHA for the Settings → 정보 (About) build-hash row (PR-UI 6).
// Falls back to "dev" when git is unavailable (e.g. a tarball build).
const buildHash = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
})();

// 이벤트 셤 (bug-hunt C1·C2 — src/lib/transport/event.ts 머리말): 앱·플러그인의
// `@tauri-apps/api/event` 임포트를 src/lib/transport/event.ts 로 돌린다. 셤 자신
// (transport/ 안)의 임포트만 진짜 모듈로 — 그래야 셤이 원본 위에 설 수 있다.
// Vite 8 에서 `resolve.alias[].customResolver` 가 폐기 예정이라 공식 안내대로
// `enforce: "pre"` 의 `resolveId` 플러그인으로 옮겼다 (2026-10-24). vitest 는
// vitest.config.ts(별도)라 테스트에는 영향이 없다.
function tauriEventShim(): Plugin {
  const shim = path.resolve(__dirname, "./src/lib/transport/event.ts");
  const transportDir = path.resolve(__dirname, "./src/lib/transport");
  const real = createRequire(import.meta.url).resolve("@tauri-apps/api/event");
  return {
    name: "oculpm:tauri-event-shim",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "@tauri-apps/api/event") return null;
      return importer?.startsWith(transportDir) ? real : shim;
    },
  };
}

// Vite 8 의 기본 빌드 타깃은 Safari 16.4 다. 최소 macOS 13.0 의 초기 WKWebView 는
// Safari 16.1 대라, Vite 7 의 기본값(baseline-widely-available)을 그대로 적어 둔다.
const BUILD_TARGET = ["chrome107", "edge107", "firefox104", "safari16"];

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tauriEventShim(), react(), tailwindcss()],

  customLogger: fileTeeLogger,

  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
  },

  resolve: {
    // 이벤트 셤 (bug-hunt C1·C2 — src/lib/transport/event.ts 머리말):
    // 앱·플러그인의 @tauri-apps/api/event 임포트를 src/lib/transport/ 로
    // 돌린다. 셤 자신(transport/ 안)의 임포트만 진짜 모듈로 — 그래야 셤이
    // 원본 위에 설 수 있다. vitest 는 vitest.config.ts(별도, alias 없음)라
    // 테스트에는 영향이 없다.
    alias: [{ find: "@", replacement: path.resolve(__dirname, "./src") }],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: { target: BUILD_TARGET },
  // 설정(lazy 청크)만 쓰는 tauri 플러그인들을 서버 시작 시 미리 번들한다.
  // 안 하면 설정 첫 진입 때 Vite 가 온디맨드 최적화를 돌며
  // "optimized dependencies changed. reloading" 전체 페이지 리로드가 난다
  // (dev 전용 — 2026-07-20 실기기 확인에서 발견).
  optimizeDeps: {
    include: [
      "@tauri-apps/plugin-opener",
      "@tauri-apps/plugin-updater",
      "@tauri-apps/plugin-process",
    ],
  },

  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      // 4. `.oculpm/**` — 앱 런타임 데이터 (프런트 모듈이 아님). 이 레포를
      //    앱으로 열어 두면(도그푸딩) 세션/설정 쓰기가 chokidar 에 잡혀
      //    @tailwindcss/vite 가 전체 리로드를 쏘던 것을 차단 (2026-07-20).
      ignored: ["**/src-tauri/**", "**/.oculpm/**"],
    },
  },
}));
