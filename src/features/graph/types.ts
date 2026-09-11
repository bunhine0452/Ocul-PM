// Shared shapes + path helpers for the code map (GraphScreenV2 + GraphInspector).

// Typed edge metadata. `imports` is on by default; the rest are opt-in (calls
// overlap imports heavily, so showing all at once is noisy).
import type { I18nKey } from "@/i18n";

export const EDGE_META: Record<string, { labelKey: I18nKey; color: string }> = {
  imports: { labelKey: "graph.edge.imports", color: "#8b93a1" },
  calls: { labelKey: "graph.edge.calls", color: "#e0a82e" },
  inherits: { labelKey: "graph.edge.inherits", color: "#a78bfa" },
  implements: { labelKey: "graph.edge.implements", color: "#5b9bff" },
};
export const EDGE_ORDER = ["imports", "calls", "inherits", "implements"];

export interface FileRow {
  fileId: number;
  path: string;
  language: string | null;
}
export interface FileEdge {
  source: number; // file_id
  target: number; // file_id
  type: string;
  estimated: boolean;
}
// A node in the rendered graph — a single file (file mode) or an aggregated
// folder (dir mode).
export interface GNode {
  id: string;
  kind: "file" | "dir";
  label: string;
  sub: string;
  path: string;
  language: string | null;
  fileIds: number[];
  inCount: number;
  outCount: number;
  /** dir 노드의 언어 구성 (상위 3 + 기타, ratio 합 1). near LOD 미니 바용. */
  langMix?: { color: string; ratio: number }[];
}
export interface GEdge {
  source: string;
  target: string;
  type: string;
  estimated: boolean;
  weight: number;
}
// A neighbour of the selected node, collapsed across edge types so the
// inspector shows one row per related node with the relation kinds it carries.
export interface NeighborRel {
  node: GNode;
  types: string[]; // imports | calls | inherits | implements
  estimated: boolean;
}

export function baseName(p: string): string {
  const a = p.split("/");
  return a[a.length - 1] || p;
}
export function dirOf(p: string): string {
  const a = p.split("/");
  a.pop();
  return a.join("/");
}
export function lastSeg(p: string): string {
  const a = p.split("/").filter(Boolean);
  return a[a.length - 1] || "/";
}
export function dirCrumb(p: string): string {
  return dirOf(p).split("/").slice(-2).join("/");
}

/**
 * 툴바 부제가 세는 자리의 단위 키 — 하나면 단수, 아니면 복수. 토글 라벨은
 * 단수 키를 그대로 쓴다. 한국어는 수가 없어 두 키가 같은 말이지만, 영어
 * "0 folder" 는 틀린 말이라 갈라 둔다 (2026-09-11 영어 순회, v3-release
 * `{#i18n-rest}`). `GraphScreenV2` 가 크기 래칫에 붙어 있어 여기 둔다.
 */
export function unitKey(mode: string, n: number): I18nKey {
  if (mode === "dir") return n === 1 ? "graph.unitDir" : "graph.unitDirs";
  return n === 1 ? "graph.unitFile" : "graph.unitFiles";
}
