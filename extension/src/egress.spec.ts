import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// 앱의 `src-tauri/tests/egress_inventory.rs` 와 같은 약속을 확장에도 — 확장은
// 네트워크를 쓰지 않는다. 마켓·웹사이트 링크는 `vscode.env.openExternal` 로
// 사용자 클릭에만 브라우저에 넘긴다(그건 확장의 아웃바운드가 아니다).
// 새 파일이 네트워크 프리미티브를 들면 여기서 붉어진다.
const PRIMITIVES = [/\bfetch\s*\(/, /["']node:https?["']/, /["']https?["']/, /["']node:net["']/, /["']node:dgram["']/, /\bWebSocket\b/, /["']axios["']/, /["']undici["']/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else if (p.endsWith(".ts") && !p.endsWith(".spec.ts")) {
      out.push(p);
    }
  }
  return out;
}

describe("확장 아웃바운드 0", () => {
  it("src/**/*.ts 에 네트워크 프리미티브가 없다", () => {
    const hits: string[] = [];
    for (const file of walk(path.join(__dirname))) {
      const text = readFileSync(file, "utf8");
      for (const re of PRIMITIVES) {
        if (re.test(text)) {
          hits.push(`${path.relative(__dirname, file)}: ${re}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("외부 링크는 openExternal 로만 — 소스에 적힌 호스트는 oculpm.com 하나", () => {
    const hosts = new Set<string>();
    for (const file of walk(path.join(__dirname))) {
      for (const m of readFileSync(file, "utf8").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        hosts.add(m[1].toLowerCase());
      }
    }
    expect([...hosts].sort()).toEqual(["oculpm.com"]);
  });
});
