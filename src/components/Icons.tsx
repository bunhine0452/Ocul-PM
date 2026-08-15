import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
}

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

export const CheckIcon = Check;

export const Loader2 = ({ className = "", ...props }: IconProps) => (
  <IconWrapper className={`animate-spin ${className}`} {...props}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </IconWrapper>
);

export const X = (props: IconProps) => (
  <IconWrapper {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </IconWrapper>
);

export const XIcon = X;

export const Folder = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </IconWrapper>
);

export const FolderOpen = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
  </IconWrapper>
);

export const RefreshCw = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </IconWrapper>
);

export const Play = (props: IconProps) => (
  <IconWrapper {...props}>
    <polygon points="5 3 19 12 5 21 5 3" />
  </IconWrapper>
);

export const Trash2 = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
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

export const ChevronRight = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="9 18 15 12 9 6" />
  </IconWrapper>
);

export const ChevronRightIcon = ChevronRight;

export const ChevronDown = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="6 9 12 15 18 9" />
  </IconWrapper>
);

export const ChevronDownIcon = ChevronDown;

export const ChevronUpIcon = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="18 15 12 9 6 15" />
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

export const Maximize2 = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </IconWrapper>
);

export const Minimize2 = (props: IconProps) => (
  <IconWrapper {...props}>
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="10" y1="14" x2="3" y2="20" />
  </IconWrapper>
);

export const FolderCode = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <path d="m8 10-2 2 2 2" />
    <path d="m12 14 2-2-2-2" />
  </IconWrapper>
);

export const MessageSquare = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </IconWrapper>
);

export const Network = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect x="16" y="16" width="6" height="6" rx="1" />
    <rect x="2" y="16" width="6" height="6" rx="1" />
    <rect x="9" y="2" width="6" height="6" rx="1" />
    <path d="M12 8v4" />
    <path d="M12 12H5v4" />
    <path d="M12 12h7v4" />
  </IconWrapper>
);

export const Calendar = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </IconWrapper>
);

export const Settings = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </IconWrapper>
);

export const Database = (props: IconProps) => (
  <IconWrapper {...props}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
  </IconWrapper>
);

export const Plus = (props: IconProps) => (
  <IconWrapper {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </IconWrapper>
);

export const Code2 = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="m18 16 4-4-4-4" />
    <path d="m6 8-4 4 4 4" />
    <path d="m14.5 4-5 16" />
  </IconWrapper>
);

export const KeyRound = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L20 4m0 0l2 2" />
  </IconWrapper>
);

export const LayoutDashboard = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </IconWrapper>
);

export const FileCode = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="m8 13-2 2 2 2" />
    <path d="m12 17 2-2-2-2" />
  </IconWrapper>
);

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

export const Clipboard = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </IconWrapper>
);

export const Target = (props: IconProps) => (
  <IconWrapper {...props}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </IconWrapper>
);

export const Undo = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </IconWrapper>
);

export const Pencil = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </IconWrapper>
);

export const ArrowUp = (props: IconProps) => (
  <IconWrapper {...props}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </IconWrapper>
);

export const Flame = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </IconWrapper>
);

export const OculIcon = (props: IconProps) => (
  <IconWrapper {...props}>
    <circle cx="12" cy="12" r="9" strokeWidth="1" strokeDasharray="3 3" className="opacity-60" />
    <path d="M2 12s3-6 10-6 10 6 10 6-3 6-10 6-10-6-10-6Z" />
    <circle cx="12" cy="12" r="3" />
    <circle cx="13" cy="11" r="0.5" fill="currentColor" />
  </IconWrapper>
);

export const Sparkles = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" />
    <path d="M19 17v4" />
    <path d="M3 5h4" />
    <path d="M17 19h4" />
  </IconWrapper>
);

export const Copy = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </IconWrapper>
);

export const ScanSearch = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.32 8.38a.75.75 0 0 1 1.01-1.12l2.2 1.98 3.44-4.27z" />
    <path d="M2 8V6a2 2 0 0 1 2-2h2" />
    <path d="M20 8V6a2 2 0 0 0-2-2h-2" />
    <path d="M2 16v2a2 2 0 0 0 2 2h2" />
    <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
    <circle cx="14.5" cy="14.5" r="2.5" />
    <path d="M16.5 16.5 20 20" />
  </IconWrapper>
);

export const FileDiff = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M12 18v-6" />
    <path d="M9 15h6" />
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

export const Monitor = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
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

export const Rocket = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </IconWrapper>
);

export const Clock = (props: IconProps) => (
  <IconWrapper {...props}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </IconWrapper>
);

export const MessageCircle = (props: IconProps) => (
  <IconWrapper {...props}>
    <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
  </IconWrapper>
);

export const ClipboardCheck = (props: IconProps) => (
  <IconWrapper {...props}>
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="m9 14 2 2 4-4" />
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
  Sparkles as SparklesIcon,
  Search as SearchIcon,
  // 문서(docs) 뷰어 사이드바 슬롯.
  BookText,
  Moon as MoonIcon,
  Sun as SunIcon,
  Settings as SettingsIcon,
  Eye,
  FolderGit2,
  ChevronsUpDown,
  // PR-UI 2 (Today) — trigger badges + stat / panel icons.
  Bug,
  Wrench,
  TriangleAlert,
  GitCommitVertical,
  FileCode2,
  Bot,
  TrendingUp,
  Star,
  History,
  ListTodo,
  Loader,
  // PR-UI 3 (작업 일지) — cycle-retry flag.
  RotateCcw,
  // PR-UI 4 (변경 diff) — diff toolbar + footer.
  ExternalLink as ExternalLinkIcon,
  GitBranch as GitBranchIcon,
  Check as CheckMark,
  // PR-UI 5 (도구 4 화면) — search scope / terminal watch / planner filter / ai compose.
  Activity,
  Paperclip,
  Filter,
  Variable,
  CaseSensitive,
  // PR-UI 6 (Settings) — keyring status chips + advanced / about.
  ShieldCheck,
  ShieldAlert,
  Info,
  // PR-R5/release — update notifier banner.
  Download,
  // 스킬 관리 화면 — 사이드바 슬롯 + 빈 상태.
  Puzzle,
  // AI 패널 개편 — 중지 / 맨아래 스크롤 / 새 대화.
  Square,
  ArrowDown,
  SquarePen,
  // 터미널 개편 — 가로/세로 분할.
  Columns2,
  Rows2,
  // 터미널 도크 (2026-08-15) — 붙이는 자리(하단/왼쪽) + 창으로 분리.
  // `PanelLeft` 는 이 파일 위쪽에 손으로 쓴 같은 도형이 있어 별칭으로 받는다.
  PanelBottom,
  PanelLeft as PanelLeftDock,
  PanelRight,
  SquareArrowOutUpRight,
  // i18n Phase 0 — 설정 → 모양 → 언어.
  Languages,
  // 프로젝트 아이덴티티 글리프 10종 (시작 화면 카드 · 탭).
  //
  // 손으로 그렸다가 되돌렸다 — 15px 에서 고양이가 눈처럼, 선인장이 막대사탕처럼
  // 보였다. 작은 크기의 선화는 곡률·간격이 조금만 어긋나도 다른 물건이 된다.
  // lucide 는 그 크기에서 검증된 지오메트리를 준다.
  //
  // 고르는 기준은 "귀엽다" 만이 아니라 **실루엣 구별**이다 — 동물 얼굴을 여럿
  // 넣으면 작은 크기에서 전부 같은 원이 된다. 뾰족·긴귀·물결·삼각·기둥·고리로
  // 윤곽이 겹치지 않게 골랐다.
  Cat,
  Rabbit,
  Ghost,
  // Rocket 은 이 파일 위쪽에 이미 손으로 쓴 같은 도형이 있다 — 재수출하면 충돌.
  Sprout,
  IceCreamCone,
  Coffee,
  Donut,
  Fish,
  Gem,
} from "lucide-react";
