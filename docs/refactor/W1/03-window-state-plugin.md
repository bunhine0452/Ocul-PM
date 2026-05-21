# 03. Window State 플러그인 + macOS Overlay

> **작업 ID**: W1 / UI-1  
> **일자**: 2026-05-21  
> **참조**: MASTER-GUIDE §6.2 (윈도우 크기/위치 영속화)

---

## 변경 요약

`tauri-plugin-window-state` 도입으로 윈도우 위치/크기를 자동 영속화. macOS에서 `titleBarStyle: Overlay`를 Rust 코드에서 적용.

## 변경 파일

### `src-tauri/Cargo.toml`
```diff
+ tauri-plugin-window-state = "2"
```

### `src-tauri/src/lib.rs`

**추가**:
1. `tauri_plugin_window_state` 플러그인 등록
   ```rust
   .plugin(tauri_plugin_window_state::Builder::default().build())
   ```
2. macOS 전용 titleBarStyle Overlay 설정 (`#[cfg(target_os = "macos")]`)
   ```rust
   #[cfg(target_os = "macos")]
   {
       use tauri::TitleBarStyle;
       if let Some(window) = app.get_webview_window("main") {
           let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
       }
   }
   ```

## 동작 설명

### Window State 플러그인
- 윈도우 위치, 크기, 최대화 상태를 자동 저장/복원
- `tauri.conf.json`의 `width: 1150, height: 780`은 최초 실행 시 기본값으로만 작동
- "내가 둔 자리에 안 돌아온다" 문제 해결

### macOS Overlay
- `decorations: true` 상태에서 `TitleBarStyle::Overlay` 적용
- 네이티브 traffic light가 콘텐츠 위에 겹침 (Cursor/Linear 스타일)
- 우리 TitleBar는 좌측 80px 공백으로 traffic light 양보
- Windows/Linux는 이 코드 미실행 → 네이티브 chrome 100%

## 해결된 문제
- ✅ 최대화 후 복원 시 윈도우 위치/크기 미복원
- ✅ macOS에서 네이티브 traffic light 부재 (수동 그리기 → OS 네이티브)
