# 02. TitleBar 재작성 — OS 네이티브 chrome 적용

> **작업 ID**: W1 / UI-1  
> **일자**: 2026-05-21  
> **참조**: MASTER-GUIDE §6.2 (TitleBar 재설계)

---

## 변경 요약

수동 macOS traffic light + JS `startDragging()` 핸들러를 제거하고, Tauri 2 표준 `data-tauri-drag-region`으로 전환. OS별 자동 분기.

## 변경 파일

### `src/components/TitleBar.tsx` (전면 재작성)

**제거된 것**:
- 수동 traffic light 버튼 3개 (닫기/최소화/최대화) — L80-102
  - macOS: `decorations: true` + `titleBarStyle: Overlay`로 네이티브 traffic light 사용
  - Windows/Linux: 네이티브 chrome이 처리
- JS `startDragging()` 핸들러 — L24-33
  - 버튼 클릭과 race condition 발생 가능했음
  - `data-tauri-drag-region` 표준이 더 안정적
- `handleDoubleClick` 핸들러 — L62-71
  - `data-tauri-drag-region`이 더블클릭 최대화도 자동 처리
- `getCurrentWindow` import (더 이상 필요 없음)
- `Maximize2`, `Minimize2`, `X` 아이콘 import (traffic light 제거)

**추가된 것**:
- `data-tauri-drag-region` 속성 (Tauri 2 표준 드래그)
- OS 감지 (`navigator.platform`) 기반 패딩 분기:
  - macOS: 좌측 80px (네이티브 traffic light 양보)
  - Windows/Linux: 좌측 16px
- `aria-label` 추가 (접근성, MASTER-GUIDE §6.5)
- `focus:outline-none` 제거 (키보드 포커스 링 유지)

**레이아웃 변경**:
```
Before:
[🔴🟡🟢] ────── [projectName / Dashboard] ────── [🌙]

After (macOS):
[80px 공백 = 네이티브 traffic light] [projectName / Dashboard] ────── [🌙]

After (Windows/Linux):  
[16px 패딩] [projectName / Dashboard] ────── [🌙] [🗕🗖🗙 = OS 네이티브]
```

## 해결된 문제
- ✅ Windows에서 어색한 macOS 색동 원 3개
- ✅ `startDragging()`과 버튼 클릭의 race condition
- ✅ 최대화 후 다시 줄였을 때 윈도우 위치 미복원 (window-state 플러그인과 연계)
- ✅ 아이콘 버튼 `aria-label` 부재
