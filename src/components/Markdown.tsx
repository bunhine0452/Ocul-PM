import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useState, useCallback, type ReactNode } from "react";
import { Copy, Check } from "./Icons";
import { useTheme } from "@/lib/theme";

/** Code block wrapper with a copy button overlay */
function CodeBlockWrapper({ children, className }: { children: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    // Extract text content from the code block
    const codeEl = (children as any)?.props?.children;
    const text = typeof codeEl === "string" ? codeEl : String(codeEl ?? "");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback
    }
  }, [children]);

  return (
    <div className="relative group/code">
      <pre className={className}>{children}</pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1 rounded-md bg-muted/80 border border-border/50 text-muted-foreground hover:text-foreground opacity-0 group-hover/code:opacity-100 transition-opacity duration-150 cursor-pointer"
        aria-label="코드 복사"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-green-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
      {copied && (
        <span className="absolute top-2 right-9 text-[10px] font-bold text-primary bg-muted px-1.5 py-0.5 rounded-md border border-border opacity-0 group-hover/code:opacity-100 transition-opacity">
          복사됨
        </span>
      )}
    </div>
  );
}

export function Markdown({
  children,
  components,
  urlTransform,
}: {
  children: string;
  /**
   * Optional react-markdown component overrides, merged on top of the built-in
   * `pre` (copy button) renderer. The 문서(docs) 뷰어 passes `a`/`img` here to
   * intercept relative links and load images via the backend.
   */
  components?: Components;
  /**
   * Optional react-markdown URL transform. Defaults to react-markdown's safe
   * transform; the docs viewer passes an identity fn so relative `./foo.md`
   * and `../bar.png` URLs reach the custom `a`/`img` renderers untouched.
   */
  urlTransform?: (url: string) => string;
}) {
  // PR-UI 8b — Tailwind Typography's dark inversion applied via the theme
  // (no Tailwind dark-variant): add `prose-invert` only when the resolved
  // theme is dark. data-theme drives `resolvedTheme`.
  const { resolvedTheme } = useTheme();
  return (
    <div
      className={`
        prose prose-sm prose-neutral max-w-none
        ${resolvedTheme === "dark" ? "prose-invert" : ""}
        prose-pre:bg-muted prose-pre:text-foreground prose-pre:rounded-md
        prose-code:before:hidden prose-code:after:hidden
        prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5
        prose-pre:p-3 prose-pre:my-2
        prose-p:my-2 prose-headings:my-3
        prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
      `}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={urlTransform}
        components={{
          pre: ({ children, className }) => (
            <CodeBlockWrapper className={className}>
              {children}
            </CodeBlockWrapper>
          ),
          ...components,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
