/**
 * 파일 크기 래칫의 **정책** — 무엇을 재고 무엇을 빼는가 (플랜
 * `v241-errors-first` #ratchet-policy).
 *
 * 판정 로직(`check-file-sizes.mjs`)에서 떼어 낸 이유는 하나다: 이 표는 **데이터**고,
 * 데이터는 테스트로 모양을 못박을 수 있다. 규칙표가 코드 안에 인라인으로 있으면
 * 루트 하나가 조용히 빠져도(`src/` 가 사라지면 프런트 전체가 게이트 밖이 된다)
 * 아무 테스트도 깨지지 않는다 — 게이트는 여전히 "✓ clean" 을 찍는다.
 *
 * `src/__tests__/file_size_policy.test.ts` 가 이 파일의 두 배열을 **순서까지**
 * `deepEqual` 로 문다. 여기를 고치면 그 테스트가 반드시 깨지고, 깨진 자리에서
 * "이 항목을 왜 빼는가"를 한 번 적게 된다.
 *
 * 의존성 0, Node 18+.
 */

/** 한 파일이 가질 수 있는 줄 수 (CLAUDE.md 의 "800줄이 한계"). */
export const MAX_LINES = 800;

/**
 * 검사 대상 — 손으로 쓰는 소스만.
 *
 * 생성물(`bindings.ts`)과 사전(`i18n/*.ts`)은 뺀다. 둘 다 사람이 설계하는
 * 표면이 아니라 목록이고, 길이가 곧 설계 냄새인 파일들이 아니다.
 */
export const GOVERNED = [
  { root: "src-tauri/src/", ext: [".rs"] },
  { root: "src/", ext: [".ts", ".tsx"] },
];

export const EXCLUDED = [
  "src/legacy/", // 빌드·lint 대상 밖 (보존된 죽은 코드)
  "src/lib/bindings.ts", // tauri-specta 생성물
  "src/i18n/ko.ts",
  "src/i18n/en.ts",
  // 명세서(manifest)들 — 길이가 **설계**가 아니라 **기능 수**의 함수인 파일.
  // `lib.rs` 는 커맨드 하나가 늘 때마다 `use` 한 줄과 `collect_commands!` 한
  // 줄이 반드시 는다. 여기에 래칫을 걸면 "커맨드를 더 못 붙인다"가 되고, 그건
  // 지켜지지 않고 우회될 규칙이다.
  "src-tauri/src/lib.rs",
  // 같은 이유의 스키마 파일. `.oculpm` 프론트매터/인덱스의 **모양 자체**라,
  // 필드가 하나 늘면 줄도 반드시 는다 (주석을 0줄로 줄여도 통과가 불가능하다).
  // 2026-09-04 에 `agent.session`·`Session.agent_sessions` 를 넣다가 확인됐다.
  "src-tauri/src/oculpm/spec.rs",
];

/** 이 경로가 래칫 대상인가. */
export function isGoverned(relPath) {
  if (EXCLUDED.some((skip) => relPath === skip || relPath.startsWith(skip))) {
    return false;
  }
  return GOVERNED.some(
    (rule) => relPath.startsWith(rule.root) && rule.ext.some((e) => relPath.endsWith(e)),
  );
}
