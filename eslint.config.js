// @ts-check
/**
 * ESLint — 여섯 번째 게이트 (플랜 `v241-errors-first` #eslint).
 *
 * 이 저장소에는 그동안 ESLint 가 **없었다**. 그런데 `src/`(테스트 제외)에
 * `eslint-disable` 주석이 33개 있었다 — 돌지 않는 검사를 억제하는 주석이다.
 * 그중 23개가 `react-hooks/exhaustive-deps` 이고, 이 라운드가 고치려는 결함
 * (구독 누수 15곳, `useEffect` 의존성)이 정확히 그 클래스다.
 *
 * ## 왜 최소 구성인가
 *
 * - **타입 인식(type-aware) 린트는 켜지 않는다.** `src/` 가 600 파일이 넘고
 *   `pnpm lint` 는 커밋마다 도는 게이트다. 타입 정보를 요구하는 규칙은 tsc 를
 *   한 번 더 도는 것과 같은 비용이라, 이미 `pnpm typecheck` 가 있는 이 저장소
 *   에서는 두 번 내는 값이다.
 * - `react-hooks` 는 v7 의 `recommended` 를 **쓰지 않는다.** v7 recommended 는
 *   React Compiler 규칙 14종을 `error` 로 켠다(`purity`·`immutability`·
 *   `set-state-in-effect` …). 도입 첫 커밋에 수천 건을 켜면 게이트가 통째로
 *   무시된다. 여기서는 이 라운드가 겨눈 두 규칙만 켠다.
 * - `@typescript-eslint/no-unused-vars` 는 끈다 — `tsconfig.json` 의
 *   `noUnusedLocals`/`noUnusedParameters` 가 이미 `pnpm typecheck` 에서 같은
 *   것을 **error** 로 잡는다. 두 게이트가 같은 말을 하면 하나는 소음이다.
 *
 * ## 래칫
 *
 * 기존 위반을 지금 전부 고치라고 하지 않는다 (`scripts/check-file-sizes.mjs`
 * 와 같은 철학). 다만 **전부를 warn 으로 내리지도 않는다** — 그러면 200개 넘는
 * recommended 규칙이 통째로 예산 안에서 서로 자리를 바꿀 수 있게 된다.
 *
 * 대신 **오늘 실제로 위반이 있는 규칙만** 골라 `warn` 으로 내린다(맨 아래
 * 블록). 나머지 recommended 규칙은 전부 `error` 로 남아, 한 건이라도 새로
 * 생기면 즉시 붉어진다.
 *
 * - `error` 규칙 = 하드 게이트 (예산 없음).
 * - `warn` 규칙 = `package.json` 의 `--max-warnings=<현재 개수>` 가 상한.
 *   줄이는 것은 되고 늘리는 것은 안 된다.
 *
 * 위반을 줄였다면 `pnpm lint:js` 로 새 개수를 확인해 `package.json` 의
 * `--max-warnings` 를 함께 내린다. 어떤 규칙의 빚을 0으로 만들었다면 아래
 * 래칫 블록에서 그 줄을 지워 `error` 로 되돌린다.
 */
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // 이 항목은 `ignores` 만 가져 **전역** 무시가 된다 (flat config 규약).
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "coverage/**",
      "landing/**",
      // tauri-specta 생성물 — 손으로 고치지 않는다 (CLAUDE.md).
      "src/lib/bindings.ts",
      // 빌드·tsconfig·vitest 대상 밖. 2026-09-04 현재 디렉터리 자체가 없지만,
      // 다른 게이트들이 모두 이 경로를 빼 두고 있어 규약을 맞춘다.
      "src/legacy/**",
      // VS Code 확장은 자기 `extension/eslint.config.mjs` 로 린트한다(react-hooks
      // 규칙이 없는 Node 코드이고, 루트 `pnpm lint` 가 `lint:extension` 으로
      // 그쪽 게이트를 부른다). 여기서 빼지 않으면 `eslint .` 가
      // `extension/.vscode-test/**`(테스트용 VS Code 통째)까지 기어 들어가
      // 힙 4GB 를 넘겨 죽는다 — 2026-09-11 실측.
      "extension/**",
    ],
  },

  // ── 손으로 쓰는 앱 소스 (TS/TSX) ──────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        // 타입 인식 린트를 켜지 않으므로 `project` 를 주지 않는다.
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // 이 라운드가 겨눈 두 규칙. `rules-of-hooks` 는 위반 0 이라 `error`,
      // `exhaustive-deps` 는 남은 위반을 `--max-warnings` 로 못박는다.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // tsc 가 이미 error 로 잡는다 (`noUnusedLocals`/`noUnusedParameters`).
      "@typescript-eslint/no-unused-vars": "off",
      // 남은 `any` 를 지금 전부 지우게 하지 않는다 — 래칫 대상.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // ── 테스트 ────────────────────────────────────────────────────────────────
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}", "src/__tests__/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // 테스트는 의도적으로 어긋난 타입을 만들어 계약을 문다.
      "@typescript-eslint/no-explicit-any": "off",
      // 훅 규칙은 테스트 헬퍼(`renderHook` 콜백 등)에서 오탐이 잦다.
      "react-hooks/exhaustive-deps": "off",
    },
  },

  // ── 게이트 스크립트 (zero-dep Node ESM) ───────────────────────────────────
  {
    files: ["scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },

  // ── 래칫: 도입 시점에 빚이 있던 규칙만 warn ────────────────────────────────
  //
  // 2026-09-04 도입 실측. 여기 없는 recommended 규칙은 전부 `error` 다.
  // 빚을 0으로 만든 규칙은 이 목록에서 **지워서** `error` 로 되돌린다.
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.mjs"],
    rules: {
      // 3건. ANSI/제어문자를 **의도적으로** 매칭하는 정규식이다
      // (`lib/framing.ts` 의 프레이밍 파서, `osc_shell` 테스트의 OSC 133 픽스처).
      // 제어문자를 접거나 이스케이프하는 것이 그 코드의 목적이라 고칠 수 없다.
      "no-control-regex": "warn",
      // 1건. `check-design-discipline.mjs:19` 는 주석 안에서 `*/` 를 깨뜨리려고
      // 폭 없는 공백을 **일부러** 넣은 것이라 고치면 안 된다.
      "no-irregular-whitespace": "warn",
      //
      // 빚이 0이 되어 `error` 로 돌아간 규칙 (2026-09-08, `{#eslint-slack-real}`):
      //   no-useless-assignment(8) · no-misleading-character-class(1)
      //   prefer-const(1) · no-useless-escape(1)
    },
  },
);
