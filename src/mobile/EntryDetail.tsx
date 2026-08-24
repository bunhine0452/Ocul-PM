// 일지 상세 — 목록(Summary)에서 열면 전문을 fetch 해 마크다운 렌더 (#mb3-screens).
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { commands } from "@/lib/bindings";
import { useT } from "@/i18n";
import { AgentTag, TypeChip } from "./tabs/shared";
import { ChevronLeft } from "@/components/Icons";

type FullEntry = Extract<Awaited<ReturnType<typeof commands.oculpmGetJournalEntry>>, { status: "ok" }>["data"];

export function EntryDetail({ projectId, relativePath, title, onClose }: {
  projectId: number;
  relativePath: string;
  title: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [entry, setEntry] = useState<FullEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void commands.oculpmGetJournalEntry(projectId, relativePath).then((res) => {
      if (!alive) return;
      if (res.status === "ok") setEntry(res.data);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [projectId, relativePath]);

  return (
    <div className="mob-root fixed inset-0 z-50 overflow-y-auto">
      <div className="mob-header sticky top-0 px-4 py-3 flex items-center gap-3">
        <button onClick={onClose} className="mob-link text-sm shrink-0 inline-flex items-center gap-0.5">
          <ChevronLeft size={15} /> {t("mobile.common.back")}
        </button>
        <span className="text-sm font-medium truncate">{title}</span>
      </div>
      <div className="px-4 py-3 space-y-3 pb-16">
        {error ? (
          <p className="text-sm mob-danger whitespace-pre-wrap">{error}</p>
        ) : entry === null ? (
          <p className="text-sm mob-text-3">{t("mobile.common.loading")}</p>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <TypeChip type={entry.frontmatter.type} />
              <AgentTag agentId={entry.frontmatter.agent.id} />
              <span className="text-[11px] mob-text-3">
                {entry.frontmatter.created_at.slice(0, 16).replace("T", " ")}
              </span>
            </div>
            <article className="mob-md text-[14px] leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body_markdown}</ReactMarkdown>
            </article>
          </>
        )}
      </div>
    </div>
  );
}
