// 설치된 Ocul-PM 앱의 `oculpm-mcp` 사이드카 탐색. 확장은 `.oculpm` 을 직접 쓰지
// 않고 이 바이너리를 통해서만 쓴다(.claude/rules/vscode-extension.md) — 없으면
// **읽기 전용**으로 강등할 뿐, 활성화는 실패하지 않는다.
//
// 순서: 설정 `oculpm.mcpBinaryPath`(사용자가 명시했으면 그 뜻이 우선) →
// `/Applications/Ocul-PM.app` → `~/Applications/Ocul-PM.app`. 앱은 현재 macOS
// aarch64 만 빌드되므로 다른 OS 에서는 설정 경로만이 유일한 길이다.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const MCP_BINARY_NAME = "oculpm-mcp";

export function defaultCandidates(home: string = os.homedir()): string[] {
  const inApp = (root: string) => path.join(root, "Ocul-PM.app", "Contents", "MacOS", MCP_BINARY_NAME);
  return [inApp("/Applications"), inApp(path.join(home, "Applications"))];
}

export interface BinaryProbe {
  /** 실행 가능한 파일 경로. 없으면 null → 읽기 전용. */
  path: string | null;
  /** 어디서 찾았나 — 상태바 툴팁·진단용. */
  source: "setting" | "applications" | "home-applications" | null;
  /** 살펴본 후보 전부 (진단용). */
  tried: string[];
}

/**
 * 순수 탐색 — `exists` 를 주입받아 테스트가 파일시스템 없이 판정한다.
 * `settingPath` 가 빈 문자열/undefined 면 설정 후보는 건너뛴다.
 */
export async function findOculpmMcp(
  settingPath: string | undefined,
  candidates: string[] = defaultCandidates(),
  exists: (p: string) => Promise<boolean> = isExecutableFile,
): Promise<BinaryProbe> {
  const tried: string[] = [];
  const setting = settingPath?.trim();
  if (setting) {
    tried.push(setting);
    if (await exists(setting)) {
      return { path: setting, source: "setting", tried };
    }
  }
  for (const [i, c] of candidates.entries()) {
    tried.push(c);
    if (await exists(c)) {
      return { path: c, source: i === 0 ? "applications" : "home-applications", tried };
    }
  }
  return { path: null, source: null, tried };
}

export async function isExecutableFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile()) {
      return false;
    }
    await fs.access(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
