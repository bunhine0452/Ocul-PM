import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
}

/** 아이콘 **표**(Record) 의 값 타입 — 손으로 쓴 것(IconProps)과 lucide 재수출이 한
 *  표에 섞일 때 쓴다. `typeof Lock` 처럼 한 컴포넌트의 타입을 빌리면 lucide 쪽
 *  (ForwardRefExoticComponent)이 들어가지 못한다. 호출 쪽이 실제로 넘기는 props 만. */
export type IconComponent = React.ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
  style?: React.CSSProperties;
  color?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}>;

// Reusable base wrapper to handle defaults
const IconWrapper = ({
  size = 16,
  strokeWidth = 2,
  children,
  className = "",
  ...props
}: IconProps & { children: React.ReactNode }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`lucide-icon ${className}`}
    {...props}
  >
    {children}
  </svg>
);

export const Save = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </IconWrapper>
);

export const Check = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="20 6 9 17 4 12" />
  </IconWrapper>
);

export const X = (props: IconProps) => (
  <IconWrapper {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </IconWrapper>
);

export const FolderOpen = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
  </IconWrapper>
);

export const Search = (props: IconProps) => (
  <IconWrapper {...props}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </IconWrapper>
);

/** 완료·잠금 표시. 이모지(🔒)를 대체한다 — 이모지는 OS 컬러 폰트로 그려져
 *  크기·색·광학 무게가 주변 아이콘과 따로 놀고 테마를 따르지 않는다. */
export const Lock = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </IconWrapper>
);

export const File = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </IconWrapper>
);

export const ImageFileIcon = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </IconWrapper>
);

export const ChevronRight = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="9 18 15 12 9 6" />
  </IconWrapper>
);

export const ChevronDown = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="6 9 12 15 18 9" />
  </IconWrapper>
);

export const ChevronLeft = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="15 18 9 12 15 6" />
  </IconWrapper>
);

// Sidebar collapse toggle (lucide `panel-left`): a panel with a left rail.
export const PanelLeft = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </IconWrapper>
);

export const Settings = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </IconWrapper>
);

export const Plus = (props: IconProps) => (
  <IconWrapper {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </IconWrapper>
);

// 코드 화면 파일 조작 (#file-ops-ui) — 새 파일 / 새 폴더. lucide file-plus·folder-plus.
export const GitBranch = (props: IconProps) => (
  <IconWrapper {...props}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
    <circle cx="6" cy="6" r="3" />
  </IconWrapper>
);

export const Tag = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
    <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
  </IconWrapper>
);

export const Target = (props: IconProps) => (
  <IconWrapper {...props}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </IconWrapper>
);

export const ArrowUp = (props: IconProps) => (
  <IconWrapper {...props}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </IconWrapper>
);

// Sparkles(✨)는 2026-09-02 에 이 파일에서 뺐다 — 손으로 쓴 것도, lucide 재수출도.
// "AI 기능이면 반짝이" 는 생성형 제품 UI 의 관용구라, 아이콘은 그 자리의 **동작**
// (포맷 · 초안 · 갱신 · 새 프로젝트 · 모델)을 말해야 한다. scripts/check-design-discipline.mjs
// 가 재유입을 막는다.

export const Copy = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </IconWrapper>
);

export const Sun = (props: IconProps) => (
  <IconWrapper {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </IconWrapper>
);

export const Moon = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </IconWrapper>
);

export const Terminal = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </IconWrapper>
);

export const ExternalLink = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </IconWrapper>
);

export const ArrowRight = (props: IconProps) => (
  <IconWrapper {...props}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </IconWrapper>
);

export const ArrowLeft = (props: IconProps) => (
  <IconWrapper {...props}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </IconWrapper>
);

export const AlertTriangle = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </IconWrapper>
);

// ─── Final UI Update (ui_v2) icons — lucide-react re-export ────────────────
//
// 03-design-system.md §8 directs new icons to flow through this single file as
// a lucide-react re-export (no hand-rolled SVG paths — UI-MASTER-PROMPT §3.3).
// The hand-rolled components above predate that rule and back 36 legacy call
// sites; converting them is a PR-UI 7 cleanup. New ui_v2 sidebar/toolbar icons
// use the lucide source of truth from here. lucide-react accepts size /
// strokeWidth / color props directly; the mockup's default stroke is 1.75, so
// ui_v2 call sites pass strokeWidth={1.75} (active rows bump to 2). Names that
// collide with a hand-rolled export above are aliased (…Icon suffix).
export {
  Sunrise,
  NotebookText,
  GitCompareArrows,
  Target as TargetIcon,
  SquareTerminal,
  Search as SearchIcon,
  BookText,
  Settings as SettingsIcon,
  Eye,
  FolderGit2,
  // Today — trigger badges + stat / panel icons.
  Bug,
  Wrench,
  TriangleAlert,
  History,
  Loader,
  // 변경 diff — diff toolbar + footer.
  ExternalLink as ExternalLinkIcon,
  GitBranch as GitBranchIcon,
  Check as CheckMark,
  // 단축키 치트시트.
  Keyboard,
  Filter,
  ShieldCheck,
  // 업데이트 알림 배너.
  Download,
  MoreHorizontal,
  ArrowDown,
  Columns2,
  Rows2,
  List,
  Inbox,
  Store,
} from "lucide-react";

/** 모두 접기 — 위아래 꺾쇠가 안으로 모인다 (lucide `chevrons-down-up`). */
