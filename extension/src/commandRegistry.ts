// 커맨드 분류 — `package.json` 의 모든 커맨드는 둘 중 하나여야 한다.
// 쓰기 커맨드는 팔레트에서 `when: !oculpm.readOnly` 로 숨긴다(바이너리 없는
// 읽기 전용 모드에서 실패할 버튼을 보여주지 않는다). `manifest.spec.ts` 가
// 매니페스트와 이 표를 대조해 분류 누락·`when` 누락을 잡는다.
export const READ_COMMANDS = [
  "ocul-pm.openWebsite",
  "ocul-pm.rescanBinary",
  "ocul-pm.refresh",
  "ocul-pm.journal.open",
  "ocul-pm.openInEditor",
  "ocul-pm.openInApp",
  "ocul-pm.copyPath",
] as const;

/** `.oculpm`·규칙 파일을 바꾸는 커맨드 — oculpm-mcp 가 있어야 한다. */
export const WRITE_COMMANDS: readonly string[] = ["ocul-pm.injectRules", "ocul-pm.registerCursorMcp"];

export const READ_ONLY_WHEN = "!oculpm.readOnly";
