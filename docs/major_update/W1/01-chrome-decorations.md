# 01. Chrome Decorations 전환 + App.css 정리

> **작업 ID**: W1 / UI-1  
> **일자**: 2026-05-21  
> **참조**: MASTER-GUIDE §6.2 (윈도우 chrome 처리)

---

## 변경 요약

`decorations: false` + `transparent: true` 조합으로 발생하던 모든 chrome 관련 버그를 OS 네이티브 chrome으로 전환하여 해결.

## 변경 파일

### `src-tauri/tauri.conf.json`
| 항목 | Before | After |
|---|---|---|
| `decorations` | `false` | `true` |
| `transparent` | `true` | `false` |
| `minWidth` | (없음) | `960` |
| `minHeight` | (없음) | `640` |

### `src/App.css`
- **제거**: L170-180의 `border-radius: 12px` + `background: transparent !important` + `overflow: hidden`
  - 이 CSS는 `decorations: false`일 때 수동으로 모서리를 둥글게 만들기 위한 것이었으나, OS가 chrome을 그리도록 변경했으므로 불필요
- **추가**: Changelog 카테고리 컬러 토큰 (G1 준비)
  ```css
  --cat-feature:  #5b8def;  /* blue */
  --cat-fix:      #e7785b;  /* coral */
  --cat-refactor: #8e7ae6;  /* purple */
  --cat-docs:     #4caf81;  /* green */
  --cat-test:     #d4a843;  /* amber */
  --cat-chore:    #888880;  /* gray */
  ```
- **변경**: dark mode `--muted-foreground` WCAG AA 개선
  - `#8e8b82` → `#a8a59c` (대비율 1단계 상향)

### `src/App.tsx`
- **제거**: L322 `rounded-xl border border-border` (루트 div)
- **제거**: L323 `style={{ WebkitMaskImage: "-webkit-radial-gradient(white, black)" }}`
  - WebkitMaskImage가 GPU 합성 경로를 가로채 React Flow/모달 z-index 잘림 유발

## 해결된 문제
- ✅ 풀스크린/최대화 시 12px 둥근 모서리로 데스크탑이 모서리로 비치던 문제
- ✅ WebkitMaskImage로 인한 드롭다운/React Flow 캔버스 클리핑
- ✅ 패널 무한 축소 시 UI 깨짐 (minWidth/minHeight 강제)
- ✅ dark mode 텍스트 대비 부족 (WCAG AA)
