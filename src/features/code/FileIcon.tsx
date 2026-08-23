// 파일 아이콘 — 확장자별로 다른 색·글리프. 트리·탭·참조 패널이 공유한다.
//
// 방식: **언어는 브랜드색 모노그램 배지**(TS·RS·GO…), **성질이 있는 파일은
// 기존 lucide 아이콘 + 색**(이미지·잠금·git·설정·터미널·DB). 언어 로고를 전부
// 손으로 그리면 품질이 들쭉날쭉해지는데, 배지는 한 시스템이라 어느 확장자를
// 추가해도 같은 결을 유지한다 (JetBrains Fleet 이 같은 접근).
//
// 색은 의도적으로 **테마 토큰이 아니라 고정 브랜드색**이다 — TS 는 어느 테마에서든
// 파란색이어야 파일 종류가 한눈에 갈린다. 라이트/다크 양쪽에서 읽히도록 중간
// 명도로 고른다.
import { memo } from "react";

import {
  Folder,
  FolderOpen,
  File,
  ImageFileIcon,
  Lock,
  GitBranch,
  Settings,
  Terminal,
  Database,
  KeyRound,
} from "@/components/Icons";

type Spec =
  | { kind: "badge"; label: string; bg: string; fg?: string }
  | { kind: "react" }
  | { kind: "glyph"; glyph: "image" | "lock" | "git" | "gear" | "shell" | "db" | "key" | "doc" };

/** 정확한 파일명(소문자) 우선 — 확장자보다 강한 신호다 (pnpm-lock.yaml 등). */
const BY_NAME: Record<string, Spec> = {
  ".gitignore": { kind: "glyph", glyph: "git" },
  ".gitattributes": { kind: "glyph", glyph: "git" },
  ".gitmodules": { kind: "glyph", glyph: "git" },
  "cargo.lock": { kind: "glyph", glyph: "lock" },
  "package-lock.json": { kind: "glyph", glyph: "lock" },
  "pnpm-lock.yaml": { kind: "glyph", glyph: "lock" },
  "yarn.lock": { kind: "glyph", glyph: "lock" },
  dockerfile: { kind: "badge", label: "D", bg: "#2496ed" },
  makefile: { kind: "glyph", glyph: "shell" },
};

const BY_EXT: Record<string, Spec> = {
  // 언어 — 모노그램 배지 (브랜드색).
  rs: { kind: "badge", label: "RS", bg: "#cf5a3d" },
  ts: { kind: "badge", label: "TS", bg: "#3178c6" },
  mts: { kind: "badge", label: "TS", bg: "#3178c6" },
  cts: { kind: "badge", label: "TS", bg: "#3178c6" },
  js: { kind: "badge", label: "JS", bg: "#e9c744", fg: "#332b0a" },
  mjs: { kind: "badge", label: "JS", bg: "#e9c744", fg: "#332b0a" },
  cjs: { kind: "badge", label: "JS", bg: "#e9c744", fg: "#332b0a" },
  tsx: { kind: "react" },
  jsx: { kind: "react" },
  py: { kind: "badge", label: "PY", bg: "#3b76ab" },
  pyi: { kind: "badge", label: "PY", bg: "#3b76ab" },
  go: { kind: "badge", label: "GO", bg: "#00acd7" },
  c: { kind: "badge", label: "C", bg: "#659ad2" },
  h: { kind: "badge", label: "H", bg: "#8d7bbb" },
  cpp: { kind: "badge", label: "C+", bg: "#5e97d0" },
  cc: { kind: "badge", label: "C+", bg: "#5e97d0" },
  cxx: { kind: "badge", label: "C+", bg: "#5e97d0" },
  hpp: { kind: "badge", label: "H", bg: "#8d7bbb" },
  java: { kind: "badge", label: "J", bg: "#c98134" },
  kt: { kind: "badge", label: "K", bg: "#8a63f4" },
  kts: { kind: "badge", label: "K", bg: "#8a63f4" },
  swift: { kind: "badge", label: "S", bg: "#f0603b" },
  rb: { kind: "badge", label: "RB", bg: "#cc4a44" },
  php: { kind: "badge", label: "P", bg: "#7377ad" },
  cs: { kind: "badge", label: "C#", bg: "#8646a3" },
  dart: { kind: "badge", label: "D", bg: "#2fa8dd" },
  lua: { kind: "badge", label: "L", bg: "#5069c5" },
  zig: { kind: "badge", label: "Z", bg: "#f7a41d", fg: "#3a2c05" },
  wasm: { kind: "badge", label: "W", bg: "#654ff0" },
  vue: { kind: "badge", label: "V", bg: "#42b883" },
  svelte: { kind: "badge", label: "SV", bg: "#ff5c26" },
  sql: { kind: "glyph", glyph: "db" },
  sqlite: { kind: "glyph", glyph: "db" },
  db: { kind: "glyph", glyph: "db" },

  // 마크업·스타일 — 기호 배지.
  md: { kind: "badge", label: "MD", bg: "#519aba" },
  mdx: { kind: "badge", label: "MD", bg: "#519aba" },
  html: { kind: "badge", label: "<>", bg: "#e0593c" },
  htm: { kind: "badge", label: "<>", bg: "#e0593c" },
  xml: { kind: "badge", label: "<>", bg: "#8a97a8" },
  css: { kind: "badge", label: "#", bg: "#4b8fdd" },
  scss: { kind: "badge", label: "#", bg: "#ce6b9e" },
  sass: { kind: "badge", label: "#", bg: "#ce6b9e" },
  less: { kind: "badge", label: "#", bg: "#4b8fdd" },
  json: { kind: "badge", label: "{}", bg: "#b3a145", fg: "#2e2807" },
  jsonc: { kind: "badge", label: "{}", bg: "#b3a145", fg: "#2e2807" },

  // 설정·스크립트 — 성질 아이콘.
  yaml: { kind: "glyph", glyph: "gear" },
  yml: { kind: "glyph", glyph: "gear" },
  toml: { kind: "glyph", glyph: "gear" },
  ini: { kind: "glyph", glyph: "gear" },
  conf: { kind: "glyph", glyph: "gear" },
  cfg: { kind: "glyph", glyph: "gear" },
  properties: { kind: "glyph", glyph: "gear" },
  editorconfig: { kind: "glyph", glyph: "gear" },
  sh: { kind: "glyph", glyph: "shell" },
  bash: { kind: "glyph", glyph: "shell" },
  zsh: { kind: "glyph", glyph: "shell" },
  fish: { kind: "glyph", glyph: "shell" },
  lock: { kind: "glyph", glyph: "lock" },

  // 미디어.
  png: { kind: "glyph", glyph: "image" },
  jpg: { kind: "glyph", glyph: "image" },
  jpeg: { kind: "glyph", glyph: "image" },
  gif: { kind: "glyph", glyph: "image" },
  webp: { kind: "glyph", glyph: "image" },
  avif: { kind: "glyph", glyph: "image" },
  ico: { kind: "glyph", glyph: "image" },
  bmp: { kind: "glyph", glyph: "image" },
  svg: { kind: "glyph", glyph: "image" },
};

/** 파일명 → 아이콘 사양. 순수 함수라 매핑을 테스트한다. */
export function iconSpecFor(name: string): Spec {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;
  // `.env` · `.env.local` — 비밀이 든 파일은 열쇠로 밝힌다.
  if (lower === ".env" || lower.startsWith(".env.")) return { kind: "glyph", glyph: "key" };
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  const byExt = BY_EXT[ext];
  if (byExt) return byExt;
  // 알 수 없는 점 파일(.prettierrc 등)은 대개 도구 설정이다.
  if (lower.startsWith(".")) return { kind: "glyph", glyph: "gear" };
  return { kind: "glyph", glyph: "doc" };
}

const GLYPH_COLOR: Record<string, string> = {
  image: "#a684c9",
  git: "#e2593f",
  db: "#cf8e6d",
  key: "#c9a227",
  shell: "#5fa15c",
  // lock·gear·doc 은 내용이 아니라 성질이라 무채색 — 색이 있는 것만 눈에 띈다.
  lock: "var(--text-3)",
  gear: "var(--text-3)",
  doc: "var(--text-3)",
};

interface FileIconProps {
  name: string;
  isDir?: boolean;
  /** 폴더 전용 — 펼쳐져 있으면 열린 폴더로. */
  open?: boolean;
  size?: number;
  className?: string;
}

export const FileIcon = memo(function FileIcon({
  name,
  isDir = false,
  open = false,
  size = 16,
  className = "",
}: FileIconProps) {
  if (isDir) {
    const Icon = open ? FolderOpen : Folder;
    return <Icon size={size} className={`code-fico folder ${className}`} aria-hidden />;
  }
  const spec = iconSpecFor(name);
  if (spec.kind === "badge") {
    const single = spec.label.length === 1;
    return (
      <svg
        viewBox="0 0 16 16"
        width={size}
        height={size}
        className={`code-fico ${className}`}
        aria-hidden
      >
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill={spec.bg} />
        <text
          x="8"
          y="8.6"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={single ? 8.5 : 6.8}
          fontWeight={800}
          letterSpacing="-0.3"
          fontFamily='-apple-system, "Segoe UI", system-ui, sans-serif'
          fill={spec.fg ?? "#ffffff"}
        >
          {spec.label}
        </text>
      </svg>
    );
  }
  if (spec.kind === "react") {
    // 리액트 원자 — jsx/tsx. 로고 중 유일하게 도형만으로 정확히 그려진다.
    return (
      <svg
        viewBox="0 0 16 16"
        width={size}
        height={size}
        className={`code-fico ${className}`}
        aria-hidden
      >
        <g stroke="#58c4dc" strokeWidth="1" fill="none">
          <ellipse cx="8" cy="8" rx="6.4" ry="2.5" />
          <ellipse cx="8" cy="8" rx="6.4" ry="2.5" transform="rotate(60 8 8)" />
          <ellipse cx="8" cy="8" rx="6.4" ry="2.5" transform="rotate(120 8 8)" />
        </g>
        <circle cx="8" cy="8" r="1.5" fill="#58c4dc" />
      </svg>
    );
  }
  const color = GLYPH_COLOR[spec.glyph];
  const common = { size, className: `code-fico ${className}`, style: { color } };
  switch (spec.glyph) {
    case "image":
      return <ImageFileIcon {...common} aria-hidden />;
    case "lock":
      return <Lock {...common} aria-hidden />;
    case "git":
      return <GitBranch {...common} aria-hidden />;
    case "gear":
      return <Settings {...common} aria-hidden />;
    case "shell":
      return <Terminal {...common} aria-hidden />;
    case "db":
      return <Database {...common} aria-hidden />;
    case "key":
      return <KeyRound {...common} aria-hidden />;
    default:
      return <File {...common} aria-hidden />;
  }
});
