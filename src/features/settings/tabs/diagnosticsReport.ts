// 「진단 정보 복사」 글과 플랫폼 버그 리포트 URL (#w5-report).
//
// 글은 **언어와 무관한 영어 키**로 쓴다 — 이슈 양식(`.github/ISSUE_TEMPLATE/
// platform-bug.yml`)의 「진단 정보」 칸에 그대로 붙고, 받는 쪽이 UI 언어와
// 상관없이 같은 줄을 찾는다. 값은 백엔드가 이미 가렸다(홈 → `~`, 비밀 없음).

import type { DiagnosticsReport } from "@/lib/bindings";

/** 이슈 양식 파일 이름 — `.github/ISSUE_TEMPLATE/` 아래와 같아야 한다. */
export const PLATFORM_BUG_TEMPLATE = "platform-bug.yml";

const OS_NAMES: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

/**
 * 복사할 글. `installKind` 는 설치 형식(NSIS·AppImage·deb·dmg) — L-UPD 의 설치
 * 형식 커맨드가 들어오면 그 값을 여기로 넘긴다. 그 전까지는 `null` 이고 이슈
 * 양식의 「설치 형식」 드롭다운을 사람이 고른다.
 */
export function formatDiagnostics(r: DiagnosticsReport, installKind: string | null): string {
  const os = r.os_version ?? OS_NAMES[r.os] ?? r.os;
  // macOS 는 OS 에 딸린 WKWebView — 판이 곧 OS 판이다.
  const webview = r.webview ?? (r.os === "macos" ? "WKWebView (bundled with macOS)" : "unknown");
  const lines = [
    "Ocul-PM diagnostics",
    `- App: ${r.app_version}`,
    `- OS: ${os}`,
    `- Arch: ${r.arch}`,
    `- WebView: ${webview}`,
    r.session ? `- Session: ${r.session}` : null,
    `- Install: ${installKind ?? "unknown"}`,
    `- Timezone: ${r.timezone}`,
    `- Logs: ${r.log_dir ?? "(file logging off)"}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/**
 * 플랫폼 버그 이슈 양식을 버전·진단 정보가 채워진 채로 여는 URL. GitHub 이슈
 * 양식은 필드 `id` 를 쿼리로 받아 input·textarea 를 미리 채운다.
 */
export function platformBugIssueUrl(
  repo: string,
  title: string,
  version: string,
  diagnostics: string,
): string {
  const q = new URLSearchParams({
    template: PLATFORM_BUG_TEMPLATE,
    title,
    version,
    diagnostics,
  });
  return `https://github.com/${repo}/issues/new?${q.toString()}`;
}
