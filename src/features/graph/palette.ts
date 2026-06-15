// Per-language colors for the code map (GitHub-linguist-ish). Keyed by the
// lowercase `language` string the backend stores on each file. Falls back to a
// neutral token color so unknown languages still render. Shared by the node
// stripe + the legend.
const LANG_COLORS: Record<string, string> = {
  typescript: "#3178c6",
  tsx: "#3178c6",
  javascript: "#f1e05a",
  jsx: "#f1e05a",
  rust: "#dea584",
  python: "#3572a5",
  go: "#00add8",
  java: "#b07219",
  kotlin: "#a97bff",
  c: "#555555",
  cpp: "#f34b7d",
  "c++": "#f34b7d",
  csharp: "#178600",
  "c#": "#178600",
  ruby: "#701516",
  php: "#4f5d95",
  swift: "#f05138",
  html: "#e34c26",
  css: "#563d7c",
  scss: "#c6538c",
  json: "#8c8c8c",
  yaml: "#cb171e",
  markdown: "#083fa1",
  shell: "#89e051",
  bash: "#89e051",
  sql: "#e38c00",
  vue: "#41b883",
  svelte: "#ff3e00",
  astro: "#ff5a03",
};

export function langColor(language: string | null | undefined): string {
  if (!language) return "var(--text-3)";
  return LANG_COLORS[language.toLowerCase()] ?? "var(--text-3)";
}
