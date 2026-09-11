// YAML frontmatter 울타리 분리 — `src-tauri/src/oculpm/frontmatter/mod.rs` 의
// `parse_frontmatter_and_body` 를 그대로 옮긴 것. 규칙은 그쪽 문서 주석이 SSOT:
// 여는 울타리는 파일 첫 줄의 `---` 만(앞 공백·BOM 불허), 닫는 울타리가 없으면
// 전부 본문(원문 무손실), YAML 이 깨지면 raw 만 보존하고 parsed=null.
import { parse as parseYaml } from "yaml";

export interface SplitFrontmatter {
  rawYaml: string;
  /** YAML 이 잘 파싱된 매핑. 깨졌거나 없으면 null. */
  parsed: Record<string, unknown> | null;
  body: string;
  warnings: string[];
}

export function splitFrontmatter(markdown: string): SplitFrontmatter {
  const rest = stripOpeningFence(markdown);
  if (rest === null) {
    return { rawYaml: "", parsed: null, body: markdown, warnings: [] };
  }
  const split = splitClosingFence(rest);
  if (split === null) {
    return {
      rawYaml: "",
      parsed: null,
      body: markdown,
      warnings: ["frontmatter opening fence '---' has no matching closing fence"],
    };
  }
  const [rawYaml, body] = split;
  const warnings: string[] = [];
  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = parseYaml(rawYaml);
    if (value === null || value === undefined) {
      warnings.push("frontmatter is empty");
    } else if (typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    } else {
      warnings.push("frontmatter is not a mapping");
    }
  } catch (e) {
    warnings.push(`yaml parse error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { rawYaml, parsed, body, warnings };
}

function stripOpeningFence(input: string): string | null {
  if (input.startsWith("---\n")) {
    return input.slice(4);
  }
  if (input.startsWith("---\r\n")) {
    return input.slice(5);
  }
  return null;
}

function splitClosingFence(rest: string): [string, string] | null {
  if (rest.startsWith("---\n")) {
    return ["", rest.slice(4)];
  }
  if (rest.startsWith("---\r\n")) {
    return ["", rest.slice(5)];
  }
  if (rest === "---") {
    return ["", ""];
  }
  let from = 0;
  for (;;) {
    const at = rest.indexOf("\n---", from);
    if (at < 0) {
      return null;
    }
    const after = at + 4;
    if (after === rest.length) {
      return [rest.slice(0, at), ""];
    }
    if (rest[after] === "\n") {
      return [rest.slice(0, at), rest.slice(after + 1)];
    }
    if (rest[after] === "\r" && rest[after + 1] === "\n") {
      return [rest.slice(0, at), rest.slice(after + 2)];
    }
    from = at + 1;
  }
}

/** 스칼라를 문자열로 — Rust `yaml_scalar` 와 같은 폭 (문자열·숫자·불리언). */
export function scalar(v: unknown): string | undefined {
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  if (v instanceof Date) {
    // yaml 라이브러리는 따옴표 없는 날짜를 Date 로 만든다 — 원문 날짜만 남긴다.
    return v.toISOString().slice(0, 10);
  }
  return undefined;
}
