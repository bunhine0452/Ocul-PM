// 파일 아이콘 — 확장자별 로고·글리프. 트리·탭·참조 패널·브레드크럼이 공유한다.
//
// v2 (2026-08-23): 균일한 색상자 모노그램을 버렸다 — 상자 안 글자는 어느
// 확장자든 같은 칩으로 보여서 "자리 표시" 티가 났다. 대신 세 층으로 그린다:
//
//   1. **진짜 로고가 사각형인 것만 사각형** — TS·JS 의 공식 로고가 실제로
//      모서리에 글자가 앉은 색 사각형이다. 그대로 그린다.
//   2. **도형으로 그릴 수 있는 로고는 도형으로** — 파이썬 두 마리 뱀(180° 회전
//      대칭), 리액트 원자, 러스트 기어, Vue 겹친 V, 마크다운 M↓.
//   3. 나머지는 **상자 없는 색 글자**(Seti 방식) 또는 성질 아이콘(이미지·잠금·
//      git·설정·터미널·DB·열쇠).
//
// 색은 의도적으로 테마 토큰이 아니라 고정 브랜드색 — TS 는 어느 테마에서든
// 파란색이어야 종류가 한눈에 갈린다. 라이트/다크 양쪽에서 읽히는 중간 명도.
import { memo } from "react";

import {
  File,
  ImageFileIcon,
  Lock,
  GitBranch,
  Settings,
  Terminal,
  Database,
  KeyRound,
} from "@/components/Icons";

export type IconSpec =
  | { kind: "corner"; label: string; bg: string; fg: string }
  | { kind: "letter"; label: string; color: string; mono?: boolean }
  | { kind: "logo"; logo: "react" | "python" | "rust" | "vue" | "markdown" }
  | { kind: "glyph"; glyph: "image" | "lock" | "git" | "gear" | "shell" | "db" | "key" | "doc" };

/** 정확한 파일명(소문자) 우선 — 확장자보다 강한 신호다 (pnpm-lock.yaml 등). */
const BY_NAME: Record<string, IconSpec> = {
  ".gitignore": { kind: "glyph", glyph: "git" },
  ".gitattributes": { kind: "glyph", glyph: "git" },
  ".gitmodules": { kind: "glyph", glyph: "git" },
  "cargo.lock": { kind: "glyph", glyph: "lock" },
  "package-lock.json": { kind: "glyph", glyph: "lock" },
  "pnpm-lock.yaml": { kind: "glyph", glyph: "lock" },
  "yarn.lock": { kind: "glyph", glyph: "lock" },
  dockerfile: { kind: "letter", label: "D", color: "#2496ED" },
  makefile: { kind: "glyph", glyph: "shell" },
};

const TS: IconSpec = { kind: "corner", label: "TS", bg: "#3178C6", fg: "#ffffff" };
const JS: IconSpec = { kind: "corner", label: "JS", bg: "#F7DF1E", fg: "#26261e" };

const BY_EXT: Record<string, IconSpec> = {
  // 1층 — 공식 로고가 사각형인 것.
  ts: TS,
  mts: TS,
  cts: TS,
  js: JS,
  mjs: JS,
  cjs: JS,

  // 2층 — 도형 로고.
  tsx: { kind: "logo", logo: "react" },
  jsx: { kind: "logo", logo: "react" },
  py: { kind: "logo", logo: "python" },
  pyi: { kind: "logo", logo: "python" },
  rs: { kind: "logo", logo: "rust" },
  vue: { kind: "logo", logo: "vue" },
  md: { kind: "logo", logo: "markdown" },
  mdx: { kind: "logo", logo: "markdown" },

  // 3층 — 상자 없는 색 글자 (Seti 방식).
  go: { kind: "letter", label: "Go", color: "#00ACD7" },
  json: { kind: "letter", label: "{}", color: "#c7a94b", mono: true },
  jsonc: { kind: "letter", label: "{}", color: "#c7a94b", mono: true },
  html: { kind: "letter", label: "<>", color: "#E0593C", mono: true },
  htm: { kind: "letter", label: "<>", color: "#E0593C", mono: true },
  xml: { kind: "letter", label: "<>", color: "#8a97a8", mono: true },
  css: { kind: "letter", label: "#", color: "#4B8FDD" },
  scss: { kind: "letter", label: "#", color: "#CD6799" },
  sass: { kind: "letter", label: "#", color: "#CD6799" },
  less: { kind: "letter", label: "#", color: "#4B8FDD" },
  svelte: { kind: "letter", label: "S", color: "#FF3E00" },
  c: { kind: "letter", label: "C", color: "#659AD2" },
  h: { kind: "letter", label: "H", color: "#8D7BBB" },
  cpp: { kind: "letter", label: "C+", color: "#5E97D0" },
  cc: { kind: "letter", label: "C+", color: "#5E97D0" },
  cxx: { kind: "letter", label: "C+", color: "#5E97D0" },
  hpp: { kind: "letter", label: "H", color: "#8D7BBB" },
  java: { kind: "letter", label: "J", color: "#C98134" },
  kt: { kind: "letter", label: "K", color: "#8A63F4" },
  kts: { kind: "letter", label: "K", color: "#8A63F4" },
  swift: { kind: "letter", label: "S", color: "#F0603B" },
  rb: { kind: "letter", label: "R", color: "#CC4A44" },
  php: { kind: "letter", label: "P", color: "#7377AD" },
  cs: { kind: "letter", label: "C#", color: "#8646A3" },
  dart: { kind: "letter", label: "D", color: "#2FA8DD" },
  lua: { kind: "letter", label: "L", color: "#5069C5" },
  zig: { kind: "letter", label: "Z", color: "#F7A41D" },
  wasm: { kind: "letter", label: "W", color: "#654FF0" },
  sql: { kind: "glyph", glyph: "db" },
  sqlite: { kind: "glyph", glyph: "db" },
  db: { kind: "glyph", glyph: "db" },

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
export function iconSpecFor(name: string): IconSpec {
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
  image: "#A684C9",
  git: "#E2593F",
  db: "#CF8E6D",
  key: "#C9A227",
  shell: "#5FA15C",
  // lock·gear·doc 은 내용이 아니라 성질이라 무채색 — 색이 있는 것만 눈에 띈다.
  lock: "var(--text-3)",
  gear: "var(--text-3)",
  doc: "var(--text-3)",
};

const SANS = '-apple-system, "Segoe UI", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

function Svg({ size, className, children }: { size: number; className: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={className} aria-hidden>
      {children}
    </svg>
  );
}

/**
 * 파이썬 — 공식 로고는 180° 회전 대칭이라 위쪽 뱀 하나만 그리고 돌려서
 * 아래쪽을 얻는다 (색만 파랑→노랑).
 */
function PythonLogo() {
  const snake =
    "M7.9 1.1c-.7 0-1.4.06-2 .18-1.75.31-2.07 1-2.07 2.2v1.6h4.2v.55H2.95c-1.2 0-2.26.73-2.6 2.1-.38 1.6-.4 2.6 0 4.2.3 1.24 1 2.1 2.2 2.1h1.4V12.1c0-1.37 1.2-2.6 2.6-2.6h4.1c1.16 0 2.1-.96 2.1-2.13V3.5c0-1.14-.96-2-2.1-2.2-.72-.12-1.6-.2-2.75-.2z";
  const eye = "M6.1 2.3a.72.72 0 110 1.44.72.72 0 010-1.44z";
  return (
    <>
      <path d={snake} fill="#3776AB" />
      <path d={eye} fill="#ffffff" />
      <g transform="rotate(180 8 8)">
        <path d={snake} fill="#FFC331" />
        <path d={eye} fill="#ffffff" />
      </g>
    </>
  );
}

/** 러스트 — 로고의 뼈대인 기어. 원 + 이빨 8개 + 축 구멍. */
function RustLogo() {
  const teeth = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return (
      <line
        key={i}
        x1={8 + 4.6 * cos}
        y1={8 + 4.6 * sin}
        x2={8 + 6.8 * cos}
        y2={8 + 6.8 * sin}
      />
    );
  });
  return (
    <>
      <g stroke="#E0603A" strokeWidth="1.7" strokeLinecap="round" fill="none">
        <circle cx="8" cy="8" r="3.4" />
        {teeth}
      </g>
      <circle cx="8" cy="8" r="1.15" fill="#E0603A" />
    </>
  );
}

/** 리액트 — 원자. 로고 중 유일하게 도형만으로 정확히 그려진다. */
function ReactLogo() {
  return (
    <>
      <g stroke="#58C4DC" strokeWidth="1" fill="none">
        <ellipse cx="8" cy="8" rx="6.4" ry="2.5" />
        <ellipse cx="8" cy="8" rx="6.4" ry="2.5" transform="rotate(60 8 8)" />
        <ellipse cx="8" cy="8" rx="6.4" ry="2.5" transform="rotate(120 8 8)" />
      </g>
      <circle cx="8" cy="8" r="1.5" fill="#58C4DC" />
    </>
  );
}

/** Vue — 겹친 V 두 장. */
function VueLogo() {
  return (
    <>
      <path fill="#41B883" d="M1.2 2.4h3.1L8 8.8l3.7-6.4h3.1L8 14.6z" />
      <path fill="#35495E" d="M4.3 2.4h2.1L8 5.1l1.6-2.7h2.1L8 8.9z" />
    </>
  );
}

/** 마크다운 — 공식 마크: 둘러친 상자 + M + ↓. */
function MarkdownLogo() {
  return (
    <g stroke="#6A9FC0" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3.4" width="14" height="9.2" rx="1.6" />
      <path d="M3.4 10.2V5.9l1.9 2.3 1.9-2.3v4.3" />
      <path d="M11.5 5.9v3.6M9.9 8l1.6 2 1.6-2" />
    </g>
  );
}

/** 폴더 — 채운 도형이 외곽선보다 IDE 답다. 열림은 앞판이 젖혀진다. */
function FolderGlyph({ open }: { open: boolean }) {
  if (!open) {
    return (
      <path
        d="M1.6 4.9c0-.83.67-1.5 1.5-1.5h2.9c.4 0 .78.16 1.06.44l.98.96h5.36c.83 0 1.5.67 1.5 1.5v6.1c0 .83-.67 1.5-1.5 1.5H3.1c-.83 0-1.5-.67-1.5-1.5z"
        fill="currentColor"
      />
    );
  }
  return (
    <>
      <path
        d="M1.6 4.9c0-.83.67-1.5 1.5-1.5h2.9c.4 0 .78.16 1.06.44l.98.96h5.36c.83 0 1.5.67 1.5 1.5v1.1H1.6z"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M2.9 7.1h11c.74 0 1.28.7 1.09 1.42l-1.05 3.9c-.17.66-.77 1.11-1.45 1.11H2.35c-.72 0-1.25-.67-1.09-1.37l.9-4.2c.11-.5.55-.86 1.06-.86z"
        fill="currentColor"
      />
    </>
  );
}

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
  const cls = `code-fico ${className}`;
  if (isDir) {
    return (
      <Svg size={size} className={`${cls} folder`}>
        <FolderGlyph open={open} />
      </Svg>
    );
  }
  const spec = iconSpecFor(name);
  switch (spec.kind) {
    case "corner":
      // TS/JS 공식 로고 그대로 — 꽉 찬 사각형, 글자는 오른쪽 아래.
      return (
        <Svg size={size} className={cls}>
          <rect x="0.5" y="0.5" width="15" height="15" rx="2.2" fill={spec.bg} />
          <text
            x="13.6"
            y="13.4"
            textAnchor="end"
            fontSize="7"
            fontWeight={700}
            letterSpacing="-0.4"
            fontFamily={SANS}
            fill={spec.fg}
          >
            {spec.label}
          </text>
        </Svg>
      );
    case "letter":
      // 상자 없는 색 글자 — 글자 자체가 아이콘이다 (Seti 방식).
      return (
        <Svg size={size} className={cls}>
          <text
            x="8"
            y="8.7"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={spec.label.length >= 2 ? 8.6 : 11}
            fontWeight={800}
            letterSpacing="-0.5"
            fontFamily={spec.mono ? MONO : SANS}
            fill={spec.color}
          >
            {spec.label}
          </text>
        </Svg>
      );
    case "logo":
      return (
        <Svg size={size} className={cls}>
          {spec.logo === "react" ? <ReactLogo /> : null}
          {spec.logo === "python" ? <PythonLogo /> : null}
          {spec.logo === "rust" ? <RustLogo /> : null}
          {spec.logo === "vue" ? <VueLogo /> : null}
          {spec.logo === "markdown" ? <MarkdownLogo /> : null}
        </Svg>
      );
    default: {
      const color = GLYPH_COLOR[spec.glyph];
      const common = { size, className: cls, style: { color } };
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
    }
  }
});
