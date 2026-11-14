import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useState, useCallback, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { Copy, Check } from "./Icons";
import { useT } from "@/i18n";

// v2 U6 — react-markdown + remark-gfm + rehype-highlight(≈141KB) 를 lazy 경계
// 뒤로 보내기 위해 렌더 구현을 이 파일로 분리했다. 소비처는 계속
// `@/components/Markdown` 을 임포트한다 (래퍼가 Suspense 를 소유).

/** 원격(http/https/프로토콜 상대) 이미지 URL 인가 — data:/blob:/상대 경로는 아니다. */
export function isRemoteImageSrc(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src.trim());
}

/** 링크로 열 절대 URL (`//host/x` 는 https 로). */
function remoteHref(src: string): string {
  const s = src.trim();
  return s.startsWith("//") ? `https:${s}` : s;
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return href;
  }
}

/**
 * 웹뷰 CSP(`img-src 'self' data: blob:`)가 원격 이미지를 막는다 — 로드는 추적 픽셀
 * 송출이라 풀지 않는다. 깨진 아이콘 대신 "원격 이미지" 자리표시 + 링크로 그린다.
 * 클릭은 문서 레벨 가드(lib/externalLinks)가 기본 브라우저로 보낸다.
 */
function RemoteImageLink({ src, alt }: { src: string; alt?: string }) {
  const { t } = useT();
  const href = remoteHref(src);
  const label = alt?.trim() || hostOf(href);
  return (
    <a
      href={href}
      title={t("markdown.remoteImage", { url: href })}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-fs-3 text-muted-foreground no-underline hover:text-foreground"
    >
      <ImageOff size={13} aria-hidden="true" />
      <span>{label}</span>
    </a>
  );
}

/** Code block wrapper with a copy button overlay */
function CodeBlockWrapper({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    // Extract text content from the code block
    const codeEl = (children as { props?: { children?: unknown } } | null | undefined)?.props
      ?.children;
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
        className="absolute top-2 right-2 p-1 rounded-md bg-muted/80 border border-border/50 text-muted-foreground hover:text-foreground opacity-0 group-hover/code:opacity-100 transition-opacity duration-(--dur-1) cursor-pointer"
        aria-label={t("markdown.copyCode")}
      >
        {copied ? (
          <Check  className="text-(--ok-text)" size={15} />
        ) : (
          <Copy size={15} />
        )}
      </button>
      {copied && (
        <span className="absolute top-2 right-9 text-fs-3 font-bold text-primary bg-muted px-1.5 py-0.5 rounded-md border border-border opacity-0 group-hover/code:opacity-100 transition-opacity">
          {t("common.copied")}
        </span>
      )}
    </div>
  );
}

export default function MarkdownImpl({
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
  // 조판은 소비처의 한 벌이 쥔다(일지 상세 `.jd-prose`, 11-15). Tailwind Typography(prose prose-sm …)가
  // 14px/24px 로 이겨 일지 화면의 13px/1.7 이 닿지 않았고, 첫 줄 · 끝 줄 여백 리셋이 이 래퍼를 가리켜
  // 제목 위에 39px 빈 띠가 섰다. 래퍼는 이름만 남긴다.
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={urlTransform}
        components={{
          img: ({ src, alt }) =>
            typeof src === "string" && isRemoteImageSrc(src) ? (
              <RemoteImageLink src={src} alt={alt} />
            ) : (
              <img src={src} alt={alt} />
            ),
          pre: ({ children, className }) => (
            <CodeBlockWrapper className={className}>
              {children}
            </CodeBlockWrapper>
          ),
          code: ({ className, children }) => (
            <code className={codeClass(className, children)}>{children}</code>
          ),
          ...components,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** 꺾지 않을 인라인 코드의 길이 — 경로 꼬리 · 명령 이름 · 함수 이름은 대개 이 안이다. */
export const NOWRAP_CODE_MAX = 24;

/**
 * 인라인 코드 클래스 — 24자 이하 한 줄이면 `nowrap`(하이픈에서 두 조각으로 꺾이지 않게). 긴 것은 꺾인다.
 * 블록 코드(`pre` 안)에도 같은 렌더러가 불리지만 CSS 가 `:not(pre) > code` 만 본다.
 */
function codeClass(className: string | undefined, children: ReactNode): string | undefined {
  const short = typeof children === "string" && !children.includes("\n") && [...children].length <= NOWRAP_CODE_MAX;
  return [className, short ? "nowrap" : null].filter(Boolean).join(" ") || undefined;
}
