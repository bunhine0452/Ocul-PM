// Shared shapes + path helpers for the code map (GraphScreenV2 + GraphInspector).

// Typed edge metadata. `imports` is on by default; the rest are opt-in (calls
// overlap imports heavily, so showing all at once is noisy).
export const EDGE_META: Record<string, { label: string; color: string }> = {
  imports: { label: "import", color: "#8b93a1" },
  calls: { label: "호출", color: "#e0a82e" },
  inherits: { label: "상속", color: "#a78bfa" },
  implements: { label: "구현", color: "#5b9bff" },
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
