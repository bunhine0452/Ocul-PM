// Code map inspector (우측 패널) — readability redesign 2026-06-17.
// User-facing, not a raw data dump. Leads with the two questions a PM/operator
// actually asks about a file: "what role does it play?" and "if I touch it,
// what breaks?". Then offers actions (open in editor / peek code) and only
// below that the developer detail (relations, symbols, calls).
import { useCallback, useEffect, useMemo, useState } from "react";
import { commands, type SymbolDef } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import {
  X,
  ExternalLink,
  FileCode,
  Eye,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
} from "@/components/Icons";
import { langColor } from "./palette";
import {
  EDGE_META,
  baseName,
  type FileRow,
  type GNode,
  type NeighborRel,
} from "./types";
import { t, useT, type I18nKey } from "@/i18n";

type Tone = "muted" | "ok" | "info" | "warn" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  muted: "bg-muted text-muted-foreground",
  ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  danger: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

// Plain-language role from the in/out degree, relative to the graph's hub
// threshold (top-tier degree). The labels are deliberately non-jargon.
function roleFor(inC: number, outC: number, hubT: number): { labelKey: I18nKey; tone: Tone; descKey: I18nKey } {
  const deg = inC + outC;
  if (deg === 0) return { labelKey: "graph.role.isolated", tone: "muted", descKey: "graph.role.isolatedDesc" };
  if (inC >= hubT && outC >= hubT) return { labelKey: "graph.role.hub", tone: "danger", descKey: "graph.role.hubDesc" };
  if (inC >= hubT) return { labelKey: "graph.role.core", tone: "warn", descKey: "graph.role.coreDesc" };
  if (outC >= hubT) return { labelKey: "graph.role.assembler", tone: "info", descKey: "graph.role.assemblerDesc" };
  if (outC === 0) return { labelKey: "graph.role.leaf", tone: "ok", descKey: "graph.role.leafDesc" };
  if (inC === 0) return { labelKey: "graph.role.entry", tone: "info", descKey: "graph.role.entryDesc" };
  return { labelKey: "graph.role.link", tone: "muted", descKey: "graph.role.linkDesc" };
}

function impactTone(n: number): { tone: Tone; warn: boolean } {
  if (n === 0) return { tone: "ok", warn: false };
  if (n <= 5) return { tone: "info", warn: false };
  if (n <= 20) return { tone: "warn", warn: true };
  return { tone: "danger", warn: true };
}

interface Props {
  projectId: number;
  projectRoot: string | null;
  node: GNode;
  unit: string; // "폴더" | "파일"
  fileById: Map<number, FileRow>;
  out: NeighborRel[];
  incoming: NeighborRel[];
  symbols: SymbolDef[] | null;
  callGroups: { from: string; list: { kind: string; callee: string; target_path: string | null; estimated: boolean }[] }[];
  hubThreshold: number;
  externalEditorCommand: string;
  /** 인앱 코드 화면으로 열기 (ShellV2 → GraphScreenV2 경유). */
  onOpenInCode?: (path: string, line: number | null) => void;
  onPick: (id: string) => void;
  onOpenFileNode: (fileId: number) => void;
  onClose: () => void;
}

export function GraphInspector({
  projectId,
  projectRoot,
  node,
  unit,
  fileById,
  out,
  incoming,
  symbols,
  callGroups,
  hubThreshold,
  externalEditorCommand,
  onOpenInCode,
  onPick,
  onOpenFileNode,
  onClose,
}: Props) {
  useT();
  const role = roleFor(node.inCount, node.outCount, hubThreshold);

  // ── Change impact ("바꾸면 N개 파일에 영향") — reverse-dependency BFS. For a
  // folder we union every file path it owns. The headline metric of the panel.
  const [impact, setImpact] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setImpact(null);
    const paths =
      node.kind === "file"
        ? [node.path]
        : node.fileIds.map((id) => fileById.get(id)?.path).filter((p): p is string => !!p);
    if (paths.length === 0) {
      setImpact(0);
      return;
    }
    void commands.getChangeImpact(projectId, paths).then((res) => {
      if (alive) setImpact(res.status === "ok" ? res.data.affected.length : null);
    });
    return () => {
      alive = false;
    };
  }, [projectId, node, fileById]);

  const onOpenEditor = useCallback(async () => {
    if (!projectRoot) return;
    const res = await commands.openInEditor(projectRoot, node.path, externalEditorCommand, null);
    if (res.status === "error") toast.destructive(t("diff.editorFailed", { error: res.error }));
  }, [projectRoot, node.path, externalEditorCommand]);

  // Symbols grouped by kind, with a count per kind.
  const symbolGroups = useMemo(() => {
    if (!symbols) return null;
    const by = new Map<string, SymbolDef[]>();
    for (const s of symbols) (by.get(s.kind) ?? by.set(s.kind, []).get(s.kind)!).push(s);
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [symbols]);

  const callCount = callGroups.reduce((n, g) => n + g.list.length, 0);
  const imp = impact != null ? impactTone(impact) : null;

  return (
    <aside className="w-80 flex-none border-l border-border bg-card/40 overflow-y-auto scrollbar-thin">
      <div className="p-4 space-y-4">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate" title={node.path}>
              {node.kind === "dir" ? `${node.label}/` : node.label}
            </div>
            <div className="text-[11px] text-muted-foreground truncate" title={node.path}>
              {node.path || t("graph.root")}
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground cursor-pointer flex-none"
            title={t("common.close")}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Role badge ── */}
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${TONE_CLASS[role.tone]}`}>
            {t(role.labelKey)}
          </span>
          {node.kind === "file" && node.language ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-2 h-2 rounded-sm" style={{ background: langColor(node.language) }} />
              {node.language}
            </span>
          ) : node.kind === "dir" ? (
            <span className="text-[11px] text-muted-foreground">{t("graph.fileCount", { n: node.fileIds.length })}</span>
          ) : null}
        </div>
        {t(role.descKey) ? <p className="-mt-2 text-[11px] text-muted-foreground">{t(role.descKey)}</p> : null}

        {/* ── Change-impact headline ── */}
        <div className={`rounded-lg border px-3 py-2.5 ${imp ? TONE_CLASS[imp.tone] : "bg-muted text-muted-foreground"} border-transparent`}>
          <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-80">
            {imp?.warn ? <AlertTriangle size={12} /> : null}
            {t("graph.impact")}
          </div>
          <div className="mt-0.5 text-sm font-semibold">
            {impact == null ? (
              t("graph.computing")
            ) : impact === 0 ? (
              t("graph.noImpact")
            ) : (
              <>
                {t("graph.impactBody", { unit, n: impact })}
              </>
            )}
          </div>
        </div>

        {/* ── At-a-glance metrics ── */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label={t("graph.metricOut")} value={node.outCount} hint={t("graph.metricOutHint")} />
          <Metric label={t("graph.metricIn")} value={node.inCount} hint={t("graph.metricInHint")} />
          <Metric
            label={t("graph.symbols")}
            value={node.kind === "file" ? symbols?.length ?? "—" : node.fileIds.length}
            hint={node.kind === "file" ? t("graph.symbolsHintFile") : t("graph.symbolsHintDir")}
          />
        </div>

        {/* ── Actions (file only) ── */}
        {node.kind === "file" ? (
          <div className="flex items-center gap-2">
            {onOpenInCode ? (
              <button
                onClick={() => onOpenInCode(node.path, null)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border bg-background text-xs font-medium text-foreground hover:border-primary/50 cursor-pointer"
              >
                <FileCode size={13} /> {t("code.openInCode")}
              </button>
            ) : null}
            <button
              onClick={() => void onOpenEditor()}
              disabled={!projectRoot}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border bg-background text-xs font-medium text-foreground hover:border-primary/50 disabled:opacity-50 cursor-pointer"
            >
              <ExternalLink size={13} /> {t("graph.openEditor")}
            </button>
          </div>
        ) : null}

        {/* ── File peek (file only) ── */}
        {node.kind === "file" ? <CodePeek projectId={projectId} path={node.path} /> : null}

        {/* ── Relations ── */}
        <RelationList title={t("graph.relOut", { n: out.length })} dir="out" items={out} onPick={onPick} />
        <RelationList title={t("graph.relIn", { n: incoming.length })} dir="in" items={incoming} onPick={onPick} />

        {/* ── Folder: file list ── */}
        {node.kind === "dir" ? (
          <Section title={t("graph.filesSection", { n: node.fileIds.length })}>
            <ul className="space-y-0.5">
              {node.fileIds.map((fid) => {
                const f = fileById.get(fid);
                if (!f) return null;
                return (
                  <li key={fid}>
                    <button
                      onClick={() => onOpenFileNode(fid)}
                      title={f.path}
                      className="flex w-full items-center gap-1.5 text-left text-xs text-foreground hover:text-primary cursor-pointer"
                    >
                      <span className="w-1.5 h-1.5 rounded-sm flex-none" style={{ background: langColor(f.language) }} />
                      <span className="truncate">{baseName(f.path)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}

        {/* ── Symbols (file only) ── */}
        {node.kind === "file" ? (
          <Section title={t("graph.symbolsSection", { suffix: symbols ? ` (${symbols.length})` : "" })}>
            {symbols == null ? (
              <div className="text-xs text-muted-foreground">{t("common.loading")}</div>
            ) : symbols.length === 0 ? (
              <div className="text-xs text-muted-foreground">{t("graph.noSymbols")}</div>
            ) : (
              <div className="space-y-2">
                {symbolGroups!.map(([kind, defs]) => (
                  <div key={kind}>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                      {kind} · {defs.length}
                    </div>
                    <ul className="space-y-0.5">
                      {defs.map((s) => (
                        <SymbolRow key={`${s.kind}-${s.name}-${s.start_line}`} projectId={projectId} path={node.path} sym={s} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>
        ) : null}

        {/* ── Symbol-level calls (file only) ── */}
        {node.kind === "file" && callCount > 0 ? (
          <Section title={t("graph.callsSection", { n: callCount })}>
            <ul className="space-y-1.5">
              {callGroups.map((g) => (
                <li key={g.from || "__top"}>
                  <div className="text-[11px] font-mono text-foreground truncate" title={g.from || undefined}>
                    {g.from || t("graph.fileTop")}
                  </div>
                  <ul className="mt-0.5 space-y-0.5 pl-2 border-l border-border">
                    {g.list.map((c, i) => (
                      <li key={`${c.kind}-${c.callee}-${i}`} className="flex items-center gap-1.5 text-xs" title={c.target_path ?? undefined}>
                        <span className="text-[9px] uppercase text-muted-foreground flex-none w-7">
                          {c.kind === "calls" ? "→" : c.kind === "inherits" ? t("graph.edge.inherits") : t("graph.edge.implements")}
                        </span>
                        <span className="font-mono text-foreground truncate">{c.callee}</span>
                        {c.target_path ? (
                          <span className="text-[10px] text-muted-foreground truncate ml-auto">{baseName(c.target_path)}</span>
                        ) : null}
                        {c.estimated ? <span className="text-[9px] text-muted-foreground/70 flex-none">{t("graph.estimated")}</span> : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </aside>
  );
}

function Metric({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  useT();
  return (
    <div className="rounded-md border border-border bg-background py-1.5" title={hint}>
      <div className="text-sm font-semibold text-foreground tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  useT();
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{title}</div>
      {children}
    </div>
  );
}

function RelationList({
  title,
  dir,
  items,
  onPick,
}: {
  title: string;
  dir: "in" | "out";
  items: NeighborRel[];
  onPick: (id: string) => void;
}) {
  useT();
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("graph.none")}</div>
      ) : (
        <ul className="space-y-0.5">
          {items.map((r) => (
            <li key={r.node.id}>
              <button
                onClick={() => onPick(r.node.id)}
                title={r.node.path}
                className="group flex w-full items-center gap-1.5 text-left cursor-pointer"
              >
                {dir === "out" ? (
                  <ArrowRight size={11} className="text-muted-foreground flex-none" />
                ) : (
                  <span className="w-[11px] flex-none" />
                )}
                <span className="truncate text-xs text-foreground group-hover:text-primary">
                  {r.node.kind === "dir" ? `${r.node.label}/` : r.node.label}
                </span>
                <span className="ml-auto flex items-center gap-1 flex-none">
                  {/* 콜백 인자를 `t` 로 두면 번역 함수를 섀도잉한다 — `et`(edge type). */}
                  {r.types.map((et) => (
                    <span
                      key={et}
                      className="px-1 rounded text-[9px] font-medium"
                      style={{ background: `${EDGE_META[et]?.color ?? "#888"}22`, color: EDGE_META[et]?.color ?? "#888" }}
                    >
                      {EDGE_META[et] ? t(EDGE_META[et].labelKey) : et}
                    </span>
                  ))}
                  {r.estimated ? <span className="text-[9px] text-muted-foreground/70">{t("graph.estimated")}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// One symbol row that expands to an inline code preview (lazy read_file_range),
// mirroring SearchScreenV2's SymbolResult so the user can read a function
// without leaving the map.
function SymbolRow({ projectId, path, sym }: { projectId: number; path: string; sym: SymbolDef }) {
  useT();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && code == null && !loading) {
      setLoading(true);
      const res = await commands.readFileRange(projectId, path, sym.start_line, sym.end_line);
      setCode(res.status === "ok" ? res.data : t("graph.previewFailed", { error: res.status === "error" ? res.error : "" }));
      setLoading(false);
    }
  };

  return (
    <li>
      <button
        onClick={() => void toggle()}
        className="flex w-full items-center gap-1.5 text-left text-xs text-foreground hover:text-primary cursor-pointer"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={12} className="text-muted-foreground flex-none" />
        ) : (
          <ChevronRight size={12} className="text-muted-foreground flex-none" />
        )}
        <span className="truncate font-mono">{sym.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums flex-none">L{sym.start_line}</span>
      </button>
      {open ? (
        loading ? (
          <div className="mt-1 ml-4 text-[11px] text-muted-foreground">{t("common.loading")}</div>
        ) : (
          <pre className="mt-1 ml-4 max-h-56 overflow-auto rounded-md border border-border bg-background p-2 text-[11px] leading-snug font-mono text-foreground scrollbar-thin">
            {code}
          </pre>
        )
      ) : null}
    </li>
  );
}

// First lines of the file, lazily revealed. Cheap "what's in here" peek that
// doesn't pull the whole file unless asked.
function CodePeek({ projectId, path }: { projectId: number; path: string }) {
  useT();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && code == null && !loading) {
      setLoading(true);
      const res = await commands.readFileRange(projectId, path, 1, 40);
      setCode(res.status === "ok" ? res.data : t("graph.previewFailed", { error: res.status === "error" ? res.error : "" }));
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => void toggle()}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        aria-expanded={open}
      >
        <Eye size={13} /> {t("graph.preview")}
      </button>
      {open ? (
        loading ? (
          <div className="mt-1 text-[11px] text-muted-foreground">{t("common.loading")}</div>
        ) : (
          <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-background p-2 text-[11px] leading-snug font-mono text-foreground scrollbar-thin">
            {code}
          </pre>
        )
      ) : null}
    </div>
  );
}
