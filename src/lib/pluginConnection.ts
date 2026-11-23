/**
 * Claude Code 플러그인이 **이 프로젝트에** 붙었는가 — 오늘의 첫 걸음 · 설정의 플러그인 행 · 계획 빈 화면이
 * 같은 답을 쓴다(영수증 규칙 4: 같은 뜻은 같은 모양). 백엔드(`claude_plugin_status`)의 상태를 사람이 할
 * 다음 일 하나로 접는다. 상태마다 붙여 넣을 명령이 다르다 — 마켓플레이스만 더한 사람에게 마켓 줄까지
 * 다시 주거나, 꺼 둔 사람에게 설치 명령을 주면 그 명령은 아무것도 바꾸지 않는다.
 *
 * Windows (4.12 #win-mcp): 4.12 부터 플러그인의 MCP 가 Windows 에서도 뜬다. 그보다 옛 판은 훅만 붙고
 * 기록 도구가 없으니 「연결됨」 이 아니라 올릴 것이다.
 */
import type { I18nKey } from "@/i18n";
import type { ClaudePluginStatus } from "@/lib/bindings";
import type { Platform } from "@/lib/platform";
import { CLAUDE_PLUGIN_ENABLE, CLAUDE_PLUGIN_INSTALL, CLAUDE_PLUGIN_INSTALL_HERE, CLAUDE_PLUGIN_UPDATE } from "./agentCommands";

export type PluginConnection =
  | { kind: "connected" }
  /** 플러그인은 붙었는데 셔틀이 앱을 못 찾는다(응용 프로그램 폴더 밖에서 연 앱). 붙여 넣을 명령이 없다. */
  | { kind: "unreachable" }
  | { kind: "notInstalled" | "marketplaceOnly" | "otherProject" | "disabled" | "windowsOld"; lines: readonly string[] };

/** Windows 에서 플러그인의 MCP 가 뜨기 시작한 판. */
export const WINDOWS_MCP_SINCE = "4.12.0";

/** `a < b` — 숫자 세 자리. 못 읽으면 false(조르지 않는다). 백엔드 `version_behind` 와 같은 규칙. */
export function versionBelow(a: string, b: string): boolean {
  const parse = (s: string) => {
    const parts = s.trim().replace(/^v/, "").split(".").map((p) => (/^\d+$/.test(p.trim()) ? Number(p) : NaN));
    return parts.some(Number.isNaN) ? null : parts;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** 명령 칸의 이름 — 같은 상태는 오늘 · 설정 · 계획 빈 화면에서 같은 이름이다(켜기 · 올리기 · 설치). */
export function commandLabelKey(kind: PluginConnection["kind"]): I18nKey {
  if (kind === "disabled") return "prefs.agents.enableCmd";
  if (kind === "windowsOld") return "prefs.agents.updateCmd";
  return "prefs.agents.installCmd";
}

/** 모르면 `null` — 「연결 안 됨」 이라고 말하지 않는다. */
export function pluginConnection(s: ClaudePluginStatus | null | undefined, platform: Platform): PluginConnection | null {
  if (!s) return null;
  // 상태 칸이 없는 응답(옛 백엔드)은 `installed` 로 읽는다.
  const state = s.state ?? (s.installed ? "connected" : "not_installed");
  switch (state) {
    case "disabled":
      return { kind: "disabled", lines: CLAUDE_PLUGIN_ENABLE };
    case "other_project":
      return { kind: "otherProject", lines: CLAUDE_PLUGIN_INSTALL_HERE };
    case "marketplace_only":
      return { kind: "marketplaceOnly", lines: CLAUDE_PLUGIN_INSTALL_HERE };
    case "not_installed":
      return { kind: "notInstalled", lines: CLAUDE_PLUGIN_INSTALL };
    case "connected":
      if (s.app_reachable === false) return { kind: "unreachable" };
      if (platform === "windows" && s.installed_version && versionBelow(s.installed_version, WINDOWS_MCP_SINCE)) {
        return { kind: "windowsOld", lines: CLAUDE_PLUGIN_UPDATE };
      }
      return { kind: "connected" };
  }
}
