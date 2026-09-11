import { defineConfig } from "vitest/config";

// 순수 함수(`src/oculpm/**`)는 vitest 로 — VS Code 를 내려받는 `vscode-test`
// (`src/test/**`, mocha)와 분리해 몇 초 안에 돈다.
export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    exclude: ["src/test/**", "node_modules/**", "out/**", "dist/**", ".vscode-test/**"],
  },
});
