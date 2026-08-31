import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", "src-tauri/**", "dist/**", "src/legacy/**"],
    css: false,
    // 테스트 하나의 천장 (vitest 기본값 5s). CI 러너에서만 죽던 플레이크를
    // 2026-08-31 에 두 번째로 만나 올렸다 — 첫 번째(dab12ce)는 개별 테스트의
    // 대기 예산을 1s→5s 로 올렸는데, 이번엔 **테스트 자체의 5s 천장**에 닿았다.
    //
    // 근거: 코드가 한 줄도 안 바뀐 문서 커밋(81dd471)에서 ACP 테스트 2건이
    // 5s 로 죽었고, 같은 커밋을 재실행하니 초록이었다. 러너는 로컬보다 3배쯤
    // 느리다(같은 스위트가 로컬 ~20s / CI 74s) — 렌더가 무거운 화면 테스트는
    // `waitFor` 를 몇 바퀴 돌기만 해도 5s 를 넘긴다.
    //
    // 실패를 숨기는 값이 아니다: 통과하는 테스트는 이 값을 쓰지 않고, 진짜로
    // 멈춘 테스트만 15s 를 기다렸다 죽는다.
    testTimeout: 15_000,
  },
});
