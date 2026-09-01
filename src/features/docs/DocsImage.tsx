// 문서가 참조하는 이미지를 백엔드(docs_asset)로 읽어 data URI 로 렌더한다.
// Tauri webview 는 임의 파일 경로를 <img src> 로 직접 못 쓰므로 base64 로 받아 조립한다.
import { useEffect, useState } from "react";
import { commands } from "@/lib/bindings";
import { t, useT } from "@/i18n";

// 같은 문서를 오갈 때 재요청을 막는 단순 메모리 캐시. 문서 뷰어 세션 동안만
// 유지된다.
//
// 키에 projectId 가 **반드시** 들어간다 (2026-09-01). 예전 주석은 "경로가 키라
// 충돌 없음" 이라 적었지만 정반대였다 — `docs/architecture.png` 처럼 흔한 이름을
// 두 프로젝트가 함께 가지면 먼저 읽힌 쪽 바이트가 다른 프로젝트의 문서에
// 그려졌다. 모듈 스코프라 탭을 열어 둘 필요도 없이 제자리 프로젝트 전환만으로
// 샜다. `codeBuffers.bufferKey` 와 같은 규약.
const cache = new Map<string, string>();

const cacheKey = (projectId: number, relPath: string) => `${projectId}:${relPath}`;

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
  useT();
  const [src, setSrc] = useState<string | null>(() => cache.get(cacheKey(projectId, relPath)) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cached = cache.get(cacheKey(projectId, relPath));
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
        cache.set(cacheKey(projectId, relPath), uri);
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
    return <span className="docs-img-missing">{t("docs.imgFailed", { name: alt || relPath })}</span>;
  }
  if (!src) {
    return <span className="docs-img-skeleton" aria-busy="true" aria-label={t("docs.imgLoading")} />;
  }
  return <img className="docs-img" src={src} alt={alt ?? ""} loading="lazy" />;
}
