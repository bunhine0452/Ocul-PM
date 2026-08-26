// 코드 화면이 **에디터 대신 미리보기로** 여는 파일 — 확장자 하나로 갈린다.
//
// 왜 백엔드 판정을 안 쓰나: `code_read` 의 바이너리 판정(선두 8KB 의 NUL)은
// "텍스트가 아니다" 까지만 말해 준다. 무엇으로 그릴지는 거기서 나오지 않고,
// 2MB 편집 상한에 먼저 걸려 스크린샷 한 장은 열어 보기도 전에 "너무 큼" 이 된다.
// 그래서 파일을 **읽기 전에** 여기서 가르고, 미리보기는 자기 상한(16MB)을 쓴다.

/** 미리보기로 여는 종류. 그릴 태그가 갈리므로 이 축만 있으면 충분하다. */
export type PreviewKind = "image" | "pdf";

/**
 * 웹뷰가 `<img>` 로 바로 그릴 수 있는 래스터/벡터 포맷.
 *
 * **svg 는 일부러 뺐다** — 텍스트이자 곧 코드라 편집 대상이다. 여기 넣으면
 * 프로젝트의 아이콘 하나를 이 화면에서 못 고치게 된다 (VS Code 도 svg 는
 * 에디터로 열고 미리보기는 따로 연다).
 */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);

/** `docs/img/logo.png` → "image", `a/b.pdf` → "pdf", 그 외 null(=에디터로). */
export function previewKindFor(path: string): PreviewKind | null {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  // `dot <= 0` — 확장자가 없거나 `.gitignore` 처럼 이름 전체가 확장자인 점 파일.
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "pdf") return "pdf";
  return IMAGE_EXTS.has(ext) ? "image" : null;
}
