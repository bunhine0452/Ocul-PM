import { SkeletonList } from "@/components/ui/Skeleton";
import { ErrorCard } from "@/components/ErrorCard";
// 문서(docs) 화면 — 프로젝트 루트의 `docs/` 폴더를 읽기 전용 위키처럼 보여준다.
// 좌: 파일 트리 / 우: 마크다운 본문. 상대 링크는 위키 내 이동, 외부 링크는 시스템
// 브라우저, 이미지는 백엔드(docs_asset)에서 base64 로 로드한다. (편집 기능은 후속.)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Components } from "react-markdown";

import { Toolbar } from "@/components/Toolbar";
import { Markdown } from "@/components/Markdown";
import { RefreshCw, BookText } from "@/components/Icons";
import { commands, type DocsTree as DocsTreeData, type DocsTreeNode } from "@/lib/bindings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/lib/toast";
import { DocsTree } from "./DocsTree";
import { DocsImage } from "./DocsImage";
import { classifyHref, isMarkdownPath } from "./resolveDocsPath";
import { t, useT } from "@/i18n";
import "./docs.css";

/** 트리에서 파일 경로만 DFS 순서로 모은다 (백엔드 정렬 그대로 → 첫 원소가 README/최상단 문서). */
function collectFiles(nodes: DocsTreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.is_dir) collectFiles(n.children, acc);
    else acc.push(n.relative_path);
  }
  return acc;
}

/** `docs/sub/01-x.md` → ["docs", "docs/sub"] (파일 자신 제외). 선택 문서 조상 폴더 펼침용. */
function ancestorDirs(path: string): string[] {
  const segs = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join("/"));
  return out;
}

interface DocsScreenV2Props {
  projectId: number;
}

export function DocsScreenV2({ projectId }: DocsScreenV2Props) {
  useT();
  const { state, setState } = useWorkspace();
  const [tree, setTree] = useState<DocsTreeData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [treeError, setTreeError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState<string>("");
  const [bodyState, setBodyState] = useState<"idle" | "loading" | "error">("idle");
  const [bodyError, setBodyError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const fileOrder = useMemo(() => collectFiles(tree?.nodes ?? []), [tree]);
  const fileSet = useMemo(() => new Set(fileOrder), [fileOrder]);

  const loadTree = useCallback(() => {
    setStatus("loading");
    setTreeError(null);
    void commands.docsTree(projectId).then((res) => {
      if (res.status === "ok") {
        setTree(res.data);
        setStatus("ready");
      } else {
        setTreeError(res.error);
        setStatus("error");
      }
    });
  }, [projectId]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // 트리 로드 후 초기 선택: 현재 선택이 유효하면 유지 → 영속 경로 → 첫 문서.
  useEffect(() => {
    if (status !== "ready") return;
    setSelected((prev) => {
      if (prev && fileSet.has(prev)) return prev;
      const persisted = state.docsActivePath;
      if (persisted && fileSet.has(persisted)) return persisted;
      return fileOrder[0] ?? null;
    });
  }, [status, fileSet, fileOrder, state.docsActivePath]);

  // 선택 문서 본문 로드.
  useEffect(() => {
    if (!selected) {
      setBody("");
      setBodyState("idle");
      return;
    }
    let alive = true;
    setBodyState("loading");
    setBodyError(null);
    void commands.docsRead(projectId, selected).then((res) => {
      if (!alive) return;
      if (res.status === "ok") {
        setBody(res.data);
        setBodyState("idle");
      } else {
        setBody("");
        setBodyError(res.error);
        setBodyState("error");
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId, selected]);

  // 선택 변경 시: 영속화 + 조상 폴더 펼치기 + 본문 스크롤 최상단.
  useEffect(() => {
    if (!selected) return;
    setState((prev) =>
      prev.docsActivePath === selected ? prev : { ...prev, docsActivePath: selected },
    );
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of ancestorDirs(selected)) next.add(dir);
      return next;
    });
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selected, setState]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const scrollToAnchor = useCallback((hash: string) => {
    const id = hash.replace(/^#/, "");
    if (!id) return;
    let el: Element | null = null;
    try {
      el = scrollRef.current?.querySelector(`#${CSS.escape(id)}`) ?? null;
    } catch {
      el = null;
    }
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // 마크다운 링크/이미지 가로채기. selected/fileSet 가 바뀌면 재생성.
  const mdComponents = useMemo<Components>(
    () => ({
      a({ href, children }) {
        if (!href) return <span>{children}</span>;
        const cls = classifyHref(href, selected ?? "");
        if (cls.kind === "external") {
          return (
            <a
              className="docs-link-ext"
              href={cls.href}
              onClick={(e) => {
                e.preventDefault();
                void commands.openUrl(cls.href);
              }}
            >
              {children}
            </a>
          );
        }
        if (cls.kind === "anchor") {
          return (
            <a
              href={cls.hash}
              onClick={(e) => {
                e.preventDefault();
                scrollToAnchor(cls.hash);
              }}
            >
              {children}
            </a>
          );
        }
        const exists = isMarkdownPath(cls.path) && fileSet.has(cls.path);
        return (
          <a
            className={"docs-link" + (exists ? "" : " missing")}
            href={cls.path}
            title={exists ? cls.path : t("docs.notFoundPath", { path: cls.path })}
            onClick={(e) => {
              e.preventDefault();
              if (exists) setSelected(cls.path);
              else toast.warning(t("docs.notFound", { path: cls.path }));
            }}
          >
            {children}
          </a>
        );
      },
      img({ src, alt }) {
        if (!src) return null;
        const cls = classifyHref(src, selected ?? "");
        if (cls.kind === "external") {
          return <img className="docs-img" src={cls.href} alt={alt ?? ""} loading="lazy" />;
        }
        if (cls.kind === "anchor") return null;
        return <DocsImage projectId={projectId} relPath={cls.path} alt={alt} />;
      },
    }),
    [selected, fileSet, projectId, scrollToAnchor],
  );

  const sub =
    status === "ready" && tree?.exists
      ? selected
        ? selected.replace(/^docs\//, "")
        : t("docs.pickDoc")
      : undefined;

  return (
    <>
      <Toolbar title={t("nav.docs")} sub={sub}>
        {(status === "ready" && tree?.exists) || status === "error" ? (
          <button
            type="button"
            className="docs-refresh"
            onClick={loadTree}
            title={t("docs.refresh")}
            aria-label={t("docs.refresh")}
          >
            <RefreshCw size={15} />
          </button>
        ) : null}
      </Toolbar>

      {status === "loading" ? (
        <div className="scroll">
          <div className="page">
            <SkeletonList rows={6} height={28} />
          </div>
        </div>
      ) : status === "error" ? (
        <div className="scroll">
          <div className="page">
            <ErrorCard title={t("docs.listFailed")} error={treeError} onRetry={loadTree} />
          </div>
        </div>
      ) : !tree?.exists ? (
        <DocsEmptyState />
      ) : (
        <div className="docs-body">
          <aside className="docs-sidebar">
            <DocsTree
              nodes={tree.nodes}
              selected={selected}
              expanded={expanded}
              onToggle={toggleDir}
              onSelect={setSelected}
            />
          </aside>
          <div className="docs-main" ref={scrollRef}>
            {selected == null ? (
              <div className="empty-hint">{t("docs.pickLeft")}</div>
            ) : bodyState === "loading" ? (
              <div className="empty-hint">{t("common.loading")}</div>
            ) : bodyState === "error" ? (
              <div className="empty-hint">
                {t("docs.readFailed")}
                <br />
                {bodyError}
              </div>
            ) : (
              <article className="docs-article">
                <Markdown components={mdComponents} urlTransform={(u) => u}>
                  {body}
                </Markdown>
              </article>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function DocsEmptyState() {
  useT();
  return (
    <div className="scroll">
      <div className="page">
        <div className="docs-empty">
          <BookText size={32} strokeWidth={1.5} className="docs-empty-ico" />
          <div className="docs-empty-title">{t("docs.noFolder")}</div>
          <p className="docs-empty-desc">
            {t("docs.noFolderHint1")} <code>docs/</code> {t("docs.noFolderHint2")}<code>.md</code>{t("docs.noFolderHint3")}
          </p>
        </div>
      </div>
    </div>
  );
}
