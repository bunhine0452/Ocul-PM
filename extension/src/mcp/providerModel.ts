// MCP 정의 목록의 순수 부분 — vscode 를 임포트하지 않아 vitest 가 판정한다.
import * as path from "node:path";

export const PROVIDER_ID = "oculpm";
export const DEFAULT_AGENT_ID = "copilot";

/** 순수 — 정의 목록. 테스트가 바이너리 유무·폴더 목록으로 판정한다. */
export function definitionsFor(binary: string | null, roots: string[], agentId: string): { label: string; command: string; args: string[]; cwd: string; env: Record<string, string> }[] {
  if (binary === null) {
    return [];
  }
  return roots.map((root) => ({
    label: `${PROVIDER_ID} (${path.basename(root)})`,
    command: binary,
    args: ["--root", root],
    cwd: root,
    env: { OCULPM_AGENT_ID: agentId },
  }));
}

