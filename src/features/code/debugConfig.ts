// 실행 구성의 순수 부분 (#dap-config).
//
// 백엔드는 "무엇을 띄울지" 를 만들어 주지 않는다 — 어느 프로필로 어떤 타깃을
// 지을지가 곧 또 하나의 설정이고, 그 판단은 사용자 것이다. 대신 **그럴듯한
// 첫 값**을 채워 준다: 대부분의 경우 그대로 눌러서 되고, 아니면 고치면 된다.

import type { DapLaunchRequest } from "@/lib/bindings";

/** 확장자 → 디버그 어댑터 언어. 백엔드 `adapter_for_path` 와 같은 표여야 한다. */
export function adapterLanguageFor(path: string | null): string | null {
  if (!path) return null;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "rs":
      return "rust";
    case "py":
    case "pyi":
      return "python";
    case "go":
      return "go";
    default:
      return null;
  }
}

/**
 * 실행 파일의 첫 추측.
 *
 * Rust·Go 는 **컴파일 산출물**이 대상이라 소스 경로로는 못 붙는다. 흔한 자리를
 * 채워 두되(맞을 때가 많다) 틀리면 사용자가 고친다 — 자동으로 빌드하지 않는
 * 이상 완벽히 맞힐 방법이 없고, 자동 빌드는 하지 않기로 했다.
 *
 * Python 은 인터프리터가 소스를 직접 받으므로 지금 파일이 곧 대상이다.
 */
export function defaultProgramFor(
  language: string | null,
  activePath: string | null,
  projectName: string | null,
): string {
  switch (language) {
    case "rust":
      // 이 저장소처럼 크레이트가 하위 폴더(src-tauri/)에 있는 경우가 흔해
      // 루트 기준 경로를 준다. 크레이트 이름은 폴더 이름과 다를 수 있다.
      return `target/debug/${projectName ?? "app"}`;
    case "go":
      return `./${projectName ?? "app"}`;
    case "python":
      return activePath ?? "";
    default:
      return "";
  }
}

/** 공백으로 나눈 인자. 따옴표는 다루지 않는다 — v1 은 단순한 것부터. */
export function parseArgs(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/** 폼 값 → 백엔드 요청. */
export function toLaunchRequest(form: {
  language: string;
  program: string;
  args: string;
  stopOnEntry: boolean;
}): DapLaunchRequest {
  return {
    language_id: form.language,
    program: form.program.trim(),
    args: parseArgs(form.args),
    stop_on_entry: form.stopOnEntry,
    cwd: null,
  };
}
