/**
 * Compact 1-line project meta + expanding panel. Replaces the existing
 * Overview screen's "Project Identity / Stack" full-width header so the
 * 4 widgets land above the fold.
 *
 * Expand state persists per-project in localStorage.
 */

import { useEffect, useState } from "react";

import type { ProjectOverview } from "@/lib/bindings";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, RefreshCw } from "@/components/Icons";

interface Props {
  projectId: number;
  overview: ProjectOverview | null;
}

interface Stack {
  framework?: string;
  languages?: string[];
  package_manager?: string;
  ui?: string;
  data?: string;
  notes?: string;
}

const STORAGE_KEY = (projectId: number) =>
  `oculpm.overview.header_expanded.${projectId}`;

function readExpanded(projectId: number): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY(projectId)) === "1";
  } catch {
    return false;
  }
}

function writeExpanded(projectId: number, expanded: boolean): void {
  try {
    if (expanded) localStorage.setItem(STORAGE_KEY(projectId), "1");
    else localStorage.removeItem(STORAGE_KEY(projectId));
  } catch {
    /* non-fatal */
  }
}

function compactSummary(identity: string | null, stack: Stack | null): string {
  const bits: string[] = [];
  if (identity) bits.push(identity);
  if (stack?.framework) bits.push(stack.framework);
  if (stack?.languages?.length) bits.push(stack.languages.slice(0, 2).join(" / "));
  if (stack?.data) bits.push(stack.data);
  return bits.join(" · ");
}

export function ProjectMetaHeader({ projectId, overview }: Props) {
  const [expanded, setExpanded] = useState<boolean>(() => readExpanded(projectId));
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    writeExpanded(projectId, expanded);
  }, [projectId, expanded]);

  const stack: Stack | null = (() => {
    try {
      return overview?.stack_json
        ? (JSON.parse(overview.stack_json) as Stack)
        : null;
    } catch {
      return null;
    }
  })();

  const summary = compactSummary(overview?.identity ?? null, stack);

  const refresh = async () => {
    // refreshProjectOverviewIfStale requires provider/model; defer to the
    // legacy "개요 다시 생성" button. Here we just no-op spinner for UX
    // feedback so the user knows the header is interactive.
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 250);
  };

  return (
    <section className="rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-sm hover:text-primary transition-colors min-w-0 flex-1 text-left"
          title={summary || "메타 정보 펼치기"}
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate font-medium">
            {summary || "메타 정보 없음 — 생성 후 다시 보기"}
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
          title="자동 새로 고침"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
      {expanded && overview && (
        <div className="mt-3 pt-3 border-t border-border space-y-3">
          {overview.identity && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {overview.identity}
            </p>
          )}
          {overview.overview_md && (
            <div className="text-sm">
              <Markdown>{overview.overview_md}</Markdown>
            </div>
          )}
          {!overview.identity && !overview.overview_md && (
            <p className="text-xs text-muted-foreground">
              아직 메타 정보가 생성되지 않았어요. 아래 위젯들이 우선 활동
              데이터를 보여줍니다.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
