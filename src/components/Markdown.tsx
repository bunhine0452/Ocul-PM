import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

export function Markdown({ children }: { children: string }) {
  return (
    <div
      className="
        prose prose-sm prose-neutral max-w-none
        prose-pre:bg-muted prose-pre:text-foreground prose-pre:rounded-md
        prose-code:before:hidden prose-code:after:hidden
        prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5
        prose-pre:p-3 prose-pre:my-2
        prose-p:my-2 prose-headings:my-3
        prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
      "
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
