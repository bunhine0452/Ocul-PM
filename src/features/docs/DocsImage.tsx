// 문서가 참조하는 이미지를 백엔드(docs_asset)로 읽어 data URI 로 렌더한다.
// Tauri webview 는 임의 파일 경로를 <img src> 로 직접 못 쓰므로 base64 로 받아 조립한다.
import { useEffect, useState } from "react";
import { commands } from "@/lib/bindings";

// 같은 문서를 오갈 때 재요청을 막는 단순 메모리 캐시 (relPath → data URI).
// 문서 뷰어 세션 동안만 유지되며 프로젝트 전환과 무관하게 경로가 키라 충돌 없음.
const cache = new Map<string, string>();

export function DocsImage({
  projectId,
  relPath,
  alt,
}: {
  projectId: number;
  /** 프로젝트-루트 기준 이미지 경로 (예: docs/img/logo.png). */
  relPath: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(() => cache.get(relPath) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cached = cache.get(relPath);
    if (cached) {
      setSrc(cached);
      setFailed(false);
      return;
    }
    let alive = true;
    setSrc(null);
    setFailed(false);
    void commands.docsAsset(projectId, relPath).then((res) => {
      if (!alive) return;
      if (res.status === "ok") {
        const uri = `data:${res.data.mime};base64,${res.data.base64}`;
        cache.set(relPath, uri);
        setSrc(uri);
      } else {
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId, relPath]);

  if (failed) {
    return <span className="docs-img-missing">이미지를 불러오지 못했습니다: {alt || relPath}</span>;
  }
  if (!src) {
    return <span className="docs-img-skeleton" aria-busy="true" aria-label="이미지 불러오는 중" />;
  }
  return <img className="docs-img" src={src} alt={alt ?? ""} loading="lazy" />;
}
