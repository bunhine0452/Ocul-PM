import { createLogger, defineConfig } from "vite";
import path from "node:path";
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
// 리로드 수사 2단 (2026-07-20): 서버 로그 없이 raw full-reload 를 보내는
// 플러그인을 특정하기 위해 (a) ws.send 를 가로채 full-reload 송신 시점의
// **스택 트레이스**를, (b) chokidar 파일 이벤트를 파일로 남긴다. 원인 확정
// 후 제거 예정.
const reloadSpy = {
  name: "oculpm-reload-spy",
  configureServer(server: import("vite").ViteDevServer) {
    server.watcher.on("all", (event: string, file: string) => {
      if (file.includes("node_modules")) return;
      fileLog("WATCH", `${event} ${file}`);
    });
    const hook = (label: string, target: { send: (...a: never[]) => void } | undefined) => {
      if (!target || typeof target.send !== "function") return;
      const orig = (target.send as (...a: unknown[]) => unknown).bind(target);
      (target as { send: unknown }).send = (...args: unknown[]) => {
        try {
          const payload = args[0] as { type?: string } | undefined;
          if (payload && payload.type === "full-reload") {
            const stack = new Error("full-reload origin").stack ?? "(no stack)";
            fileLog("SPY", `${label} full-reload ${JSON.stringify(payload)}\n${stack}`);
          }
        } catch {
          // 스파이 실패는 무해
        }
        return orig(...args);
      };
    };
    hook("server.ws", server.ws as unknown as { send: () => void });
    const clientHot = (server as unknown as {
      environments?: Record<string, { hot?: { send: () => void } }>;
    }).environments?.client?.hot;
    hook("client.hot", clientHot);
  },
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

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), reloadSpy],

  customLogger: fileTeeLogger,

  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
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
      ignored: ["**/src-tauri/**"],
    },
  },
}));
