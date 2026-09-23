//! `tray.rs` 의 단위 테스트 — 파일 크기 래칫 때문에 떼어 냈다.

use super::*;

#[test]
fn frames_are_template_black_with_alpha() {
    {
        for attention in [false, true] {
            let img = render_icon(attention);
            let rgba = img.rgba();
            assert_eq!(rgba.len(), (SIZE * SIZE * 4) as usize);
            let mut any_alpha = false;
            let (pixels, _) = rgba.as_chunks::<4>();
            for px in pixels {
                assert_eq!([px[0], px[1], px[2]], GLYPH_RGB, "글리프는 한 색 + 알파");
                if px[3] > 0 {
                    any_alpha = true;
                }
            }
            assert!(any_alpha, "빈 아이콘 방지");
        }
    }
}

/// macOS 템플릿 규약 — 검정+알파만. 시스템이 메뉴바 색으로 다시 칠한다.
#[cfg(target_os = "macos")]
#[test]
fn mac_icon_is_a_black_template() {
    assert_eq!(GLYPH_RGB, [0, 0, 0]);
}

/// 비-mac 에는 템플릿이 없다 — 글리프 색이 **밝은** 작업 표시줄(Windows 10
/// 기본 흰색 계열)과 **어두운** 작업 표시줄(Windows 11 기본·GNOME 상단 바)
/// 양쪽에서 읽혀야 한다. WCAG 비텍스트 대비 3:1 을 문턱으로.
#[cfg(not(target_os = "macos"))]
#[test]
fn non_mac_icon_reads_on_light_and_dark_bars() {
    fn luminance(rgb: [u8; 3]) -> f64 {
        let lin = |c: u8| {
            let c = f64::from(c) / 255.0;
            if c <= 0.03928 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
    }
    fn contrast(a: [u8; 3], b: [u8; 3]) -> f64 {
        let (la, lb) = (luminance(a), luminance(b));
        (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
    }
    for bar in [[0xff, 0xff, 0xff], [0xf3, 0xf3, 0xf3]] {
        assert!(contrast(GLYPH_RGB, bar) >= 3.0, "밝은 바 {bar:?}");
    }
    for bar in [[0x1c, 0x1c, 0x1c], [0x00, 0x00, 0x00], [0x20, 0x20, 0x20]] {
        assert!(contrast(GLYPH_RGB, bar) >= 3.0, "어두운 바 {bar:?}");
    }
}

#[test]
fn attention_dot_changes_top_right_region() {
    let plain = render_icon(false);
    let attn = render_icon(true);
    assert_ne!(plain.rgba(), attn.rgba(), "주의 점이 실제로 그려져야 함");
}

#[test]
fn project_id_parses_from_active_key() {
    // 세션 id 에도 '-' 와 숫자가 섞이지만 project_id 는 첫 ':' 앞 전부.
    assert_eq!(project_id_of("7:20260730-001"), Some(7));
    assert_eq!(project_id_of("12:20260730-042"), Some(12));
    assert_eq!(project_id_of("nope:20260730-001"), None);
    assert_eq!(project_id_of(""), None);
}

/// R1 — 창 하나를 닫았다고 작업 중인 다른 창이 죽으면 안 된다.
#[test]
fn exits_only_when_no_window_remains() {
    // 남은 창이 없으면 옛 계약 그대로: 닫기 = 종료.
    assert!(should_exit_on_last_window_close(0, false));
    // 상주 설정 ON — 종료하지 않고 숨긴다 (기존 동작).
    assert!(!should_exit_on_last_window_close(0, true));
    // R1 — 창이 남아 있으면 무슨 일이 있어도 종료하지 않는다.
    assert!(!should_exit_on_last_window_close(3, false));
    assert!(!should_exit_on_last_window_close(3, true));
    assert!(!should_exit_on_last_window_close(1, false));
}

/// 회전 애니메이션 제거 회귀 방지 — 아이콘은 **입력이 같으면 언제나 같다**.
/// 위상 인자가 다시 생기면 이 테스트가 컴파일부터 깨진다.
#[test]
fn icon_is_deterministic_and_static() {
    assert_eq!(render_icon(false).rgba(), render_icon(false).rgba());
    assert_eq!(render_icon(true).rgba(), render_icon(true).rgba());
}
