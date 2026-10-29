---
name: Ocul
description: The Ocul visual system as committed on the oculpm.com landing (dark Deep Forest family, Persuade surface).
colors:
  accent: "#34d095"
  accent-strong: "#2ac489"
  accent-text: "#5fe0ab"
  on-accent: "#06281c"
  accent-soft: "rgba(52, 208, 149, 0.15)"
  ground: "#121514"
  window: "#191d1b"
  content: "#1b1f1d"
  card: "#232826"
  inset: "#282e2b"
  ink: "#f1f4f1"
  ink-2: "#a6aea8"
  sep: "rgba(255, 255, 255, 0.08)"
  sep-2: "rgba(255, 255, 255, 0.15)"
  warn-text: "#f0b660"
  warn-soft: "rgba(234, 162, 63, 0.16)"
  danger-text: "#f7918a"
  add: "#6cd584"
typography:
  display:
    fontFamily: "Pretendard Landing, Pretendard Variable, Pretendard, Apple SD Gothic Neo, -apple-system, Segoe UI, Malgun Gothic, Noto Sans KR, sans-serif"
    fontSize: "clamp(42px, 5.4vw, 80px)"
    fontWeight: 800
    lineHeight: 1.06
    letterSpacing: "-0.036em"
  headline:
    fontFamily: "Pretendard Landing, Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "clamp(30px, 3.5vw, 50px)"
    fontWeight: 780
    lineHeight: 1.14
    letterSpacing: "-0.034em"
  title:
    fontFamily: "Pretendard Landing, Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "21px"
    fontWeight: 720
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  lede:
    fontFamily: "Pretendard Landing, Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "clamp(18px, 1.5vw, 21px)"
    fontWeight: 400
    lineHeight: 1.65
  body:
    fontFamily: "Pretendard Landing, Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Pretendard Landing, Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.5
  mono:
    fontFamily: "Ocul Mono Hangul, SF Mono, ui-monospace, JetBrains Mono, Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.75
rounded:
  pill: "999px"
  window: "14px"
  panel: "12px"
  control: "10px"
  tab: "8px"
  inner: "7px"
  small: "6px"
spacing:
  gutter: "32px"
  gutter-phone: "16px"
  container: "1200px"
  section: "152px"
  section-phone: "104px"
  block: "48px"
  stack: "22px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "48px"
  command-copy:
    backgroundColor: "{colors.window}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.control}"
    padding: "0 8px 0 16px"
    height: "48px"
  window-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.tab}"
    padding: "0 12px"
    height: "32px"
  window-tab-selected:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
  verdict-pill:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
  count-badge:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn-text}"
    rounded: "{rounded.pill}"
    padding: "1px 7px"
---

# Design System: Ocul

Scope: this file records the Ocul visual system as it was committed on the oculpm.com landing (`landing/home.css`, dark only, a Persuade surface). The landing palette is copied from the desktop app's dark family (`[data-theme="dark"]`, "Deep Forest") in `src/styles/tokens.css`. The app UI uses both the light and dark families from that file; the light family is not recorded here and the landing has no light tokens. **When the app's dark tokens change, the landing's `:root` must change with them.** Page strategy lives in `.impeccable/surfaces/landing-index-html.md`; product truth in `PRODUCT.md`.

## Overview

**Creative North Star: "The Page Is the App"**

The landing is drawn from the same materials as the product. It sits on the app's own deep, green-tinged charcoal, and the hero is the real app window: real 4.1 screens in a frame that works, with tabs you can switch and a question you can answer. Because page and window share one palette, the screenshots sit in the page instead of floating on it.

Everything outside that window stays flat and typographic. Structure comes from hairline rules, a table, a definition list, a three-step timeline and a release list, set in one sans family with mono for anything a terminal or a file would print. There is no decoration. Composition is left-aligned in a 1200px column. Type carries the hierarchy through weight and tight tracking, not color.

**Key Characteristics:**
- One palette shared with the app's dark theme; one green accent.
- One elevated object, the app window. Hairlines everywhere else.
- Left-aligned, single column, generous section spacing (152px).
- Pretendard only, with Hangul inside code routed to Pretendard so mono text keeps its rhythm.
- Motion only responds to the visitor: a tab cross-fade and terminal lines arriving after an answer.

## Colors

A near-black green ground with sheet greys stepped toward light, near-white ink, and a single mint-green accent that stays rare.

### Primary
- **Verdict Mint** (accent): the fill of the primary download button, the outline of the live answer target in the hero window, the hint pill pointing at it, text selection, the focus ring, and the `⏺` marks in the terminal transcript. Text on it is always **Forest Ink** (on-accent).
- **Pressed Mint** (accent-strong): the hover fill of the primary button only.
- **Mint Text** (accent-text): the accent as text on dark sheets. Used for verdict and success marks (the 판정 ✓ pill, the 「sent」 confirmation, the copied state), version numbers in the release list, the 「new」 mark, highlighted `.oculpm/` paths in the folder tree, and the FAQ 「more」 toggle.
- **Mint Wash** (accent-soft): the background of the verdict pill.

### Neutral
- **Forest Ground** (ground): page background, sticky nav background, scrollbar track.
- **Window Sheet** (window): the app frame and its top bar, command-copy boxes, artifact and folder-tree panels, `kbd`.
- **Content Sheet** (content): the window's content area and the terminal screen.
- **Card Sheet** (card): the phone version of the question block and the 「sent」 chip.
- **Inset Sheet** (inset): the selected window tab, the 「copy」 tag inside a command box.
- **Paper Ink** (ink): headings, bold text, primary text.
- **Moss Grey** (ink-2): body copy under headings, nav links, captions, table secondary columns, footers.
- **Hairline** (sep) and **Strong Hairline** (sep-2): every divider, list rule and panel border. sep-2 is for section-opening rules, table headers and control outlines.

### Status (from the app)
- **Amber** (warn-text on warn-soft): the window-tab count badge and the 「Claude 가 물어요」 label, as the app shows them.
- **Added Green** (add): success lines in terminal and artifact text.
- **Danger Text** (danger-text): carried from the app family for parity. Not currently placed on the landing.

### Named Rules
**The One Accent Rule.** Mint fills only the primary action and the live answer target. Everywhere else it appears as text and only for marks that mean "done, passed, new or current". Never use it for decoration, section tints or illustration.

**The Shared Palette Rule.** Every landing color is an app token. A color the app doesn't define doesn't go on the page. The transcript greys (#dfe5e0 text, #8a948d dim, #4a524d box) and the window-light grey (#3a403d) are the only literal values, and they reproduce what a terminal and a macOS frame look like.

## Typography

**Display Font:** Pretendard Landing (a self-hosted variable subset, wght 100–900), falling back to Pretendard, Apple SD Gothic Neo, system UI, Malgun Gothic and Noto Sans KR
**Body Font:** the same family
**Label/Mono Font:** Ocul Mono Hangul → SF Mono, ui-monospace, JetBrains Mono, Menlo, Consolas

**Character:** a single Korean-first grotesque does everything. The variable axis gives fine weight steps (550, 620, 650, 680, 720, 780, 800) so hierarchy can come from weight, not from a second face. Mono is reserved for literal machine text.

### Hierarchy
- **Display** (800, clamp 42–80px, line-height 1.06, -0.036em, `text-wrap: balance`, max 15em): the hero headline only. The closing headline is a sibling at 800, clamp 36–68px, -0.04em.
- **Headline** (780, clamp 30–50px, 1.14, -0.034em, max 16em): one per section.
- **Title** (720, 21px, 1.4, -0.02em): timeline steps. Release titles sit at 700/18px; definition terms and table first columns at 680/17px.
- **Lede** (400, clamp 18–21px, 1.65, Moss Grey, max 34em): the sentence under the hero headline. Section intros are 18px, max 36em.
- **Body** (400, 17px / 16px on phones, 1.7): running text. Secondary text is 15–16px, measure 44–52em.
- **Label** (650, 13px): table headers, button sub-labels, the copy tag, captions. Sentence case, never uppercase.
- **Mono** (0.86em inline; 14px in command boxes and the tree; 12.5px in artifacts; 12–13px for version strings): code, commands, timestamps, versions, paths, transcripts. Ligatures are off.

### Named Rules
**The Keep-All Rule.** Body text sets `word-break: keep-all` with `overflow-wrap: anywhere`, so Korean breaks between words (eojeol), never inside one.

**The Hangul-in-Mono Rule.** Any mono stack starts with Ocul Mono Hangul, a `unicode-range` face that sends only Hangul and CJK punctuation to Pretendard. A system monospace font gives each Hangul syllable two cells, which spreads Korean words apart. Latin text falls through to SF Mono.

**The Weight-Not-Color Rule.** Hierarchy comes from weight and tracking. Headings are Paper Ink; supporting text drops to Moss Grey. No colored headings.

## Layout

A single left-aligned column inside a 1200px container (`max-width: 1200px; padding: 0 32px`), with a 16px gutter at 720px and below. Nothing is centered: headlines, ledes, CTAs, captions and the closing block all hang from the left edge, and line lengths are capped in em (15–16em headlines, 34–52em prose).

Rhythm: 152px above each section (104px on phones), 168px above and 136px below the closing block. Content blocks sit 40–56px below their headline; items in a stack are 18–26px apart. The nav is a 60px sticky bar on the ground with a bottom hairline.

The few multi-column structures are information layouts, not card grids: a three-column timeline under a top rule (gap 48px), a two-column definition list (column gap 64px), a two-column local/tree split (gap 64px) and a 120px + fluid release grid. At 1000px all of these collapse to one column and the nav links hide. At 720px the table becomes stacked rows, CTAs go full width, and the window's live question block moves above the window at a readable size. Short desktop viewports (≤820px tall) tighten the hero top padding to 40px so the window's top bar stays in the first view.

## Elevation & Depth

Flat by default, with depth from tonal sheets (ground → window → content → card → inset) and hairlines. There is one exception, and it is the point: the app window carries a deep, layered shadow and a 1px light ring, so it reads as the one physical object on the page.

### Shadow Vocabulary
- **Window lift** (`box-shadow: 0 0 0 1px rgba(255,255,255,0.09), 0 40px 90px -30px rgba(0,0,0,0.75), 0 12px 30px -12px rgba(0,0,0,0.5)`): the hero app frame only.
- **Screenshot contact** (`box-shadow: 0 14px 30px -18px rgba(0,0,0,0.7)`): a tight, low shadow under the small timeline screenshots, which are also pieces of the app. Not for panels or text blocks.
- **Pointer lift** (`box-shadow: 0 8px 20px -6px rgba(0,0,0,0.6)`): the hint pill floating over the window.
- **Ring as border** (`box-shadow: 0 0 0 1px var(--sep-2)` / `0 0 0 2px var(--accent)`): outlines on overlays positioned over screenshots. These are borders, not elevation.

### Named Rules
**The One Object Rule.** Only app imagery gets lifted. Text panels, the table, the definition list, the tree and the command boxes sit flat on a sheet colour with a hairline border.

## Shapes

Softly rounded, with radius stepping down as elements nest: window 14px → panels (folder tree, phone question block) 12px → buttons, command boxes, screenshots, artifacts 10px → nav CTA, tabs, find box 8px → inner tags and overlay targets 7px → focus ring and terminal box 6px → `kbd` 5px. Pills (999px) are reserved for small status marks: the verdict pill, the count badge, the hint, the amber label. Chevrons are drawn with two borders rotated 45°, not icons. The only other geometry is the three grey window lights (12px circles).

## Components

### Buttons
Quiet and solid, built to be pressed once.
- **Shape:** gently rounded (10px), 48px tall, 22px side padding, 650 weight at 16px, optional 18px SVG icon at a 10px gap and a 13px sub-label.
- **Primary:** Verdict Mint fill and border, Forest Ink text. There is one per viewport: the download button.
- **Hover / Focus:** the fill moves to Pressed Mint over 160ms (ease-out `cubic-bezier(0.16, 1, 0.3, 1)`). Focus is a 2px mint outline at a 3px offset.
- **Secondary:** transparent with a Strong Hairline border and Paper Ink text. On hover it gets a 5% white wash and a 24% border. The nav CTA is the same button at 36px, 14px text, 8px radius.

### Command copy
A button that looks like a shell line: a Window Sheet box with a Strong Hairline border, 48px tall, holding a mono command with a Moss Grey `$ ` prompt and an Inset Sheet 「copy」 tag on the right that turns Mint Text once copied. A two-line variant stacks two commands at 13px. It is how the plugin install is offered next to the primary button.

### Window tabs
Five 32px tabs in the app frame's top bar: Moss Grey text, 8px radius. The selected tab is an Inset Sheet fill with Paper Ink text at 650. An amber count badge (11px, 700, pill) can sit inside a tab. Switching tabs cross-fades the screens over 220ms.

### Lists, table, definitions
- **Timeline:** three columns under a Strong Hairline top rule. Each step has a mono timestamp in Moss Grey inside the title, a screenshot or an artifact panel, and a short paragraph.
- **Table:** collapsed borders; a 13px Moss Grey header row over a Strong Hairline; body rows divided by hairlines with 20px vertical padding. The first column is weighted 680, the second is Moss Grey at 15px, and citations go below at 13px.
- **Definition list:** two columns, each term/description pair opened by a hairline. Term at 680/17px, description Moss Grey at 15.5px.
- **Release list and FAQ:** rows opened by hairlines. FAQ disclosures use a drawn chevron that rotates over 200ms.

### Machine-text panels
Artifacts, the folder tree and the terminal screen share one treatment: a Window or Content sheet, a hairline border, a 10–12px radius, and mono text in transcript grey, with dim lines in #8a948d, success in Added Green and marks in mint. The verdict pill (Mint Text on Mint Wash, 12px/700, pill) is the only chip inside them.

### App window (signature)
The hero object: a 14px-radius Window Sheet frame with Window lift, a 46px top bar (grey lights, project name with a drawn chevron, five tabs, a find box), and a content area held at the 1180:676 ratio of the real screenshots. On the Today screen, transparent buttons outlined with a 2px mint ring sit over the real answer buttons, with a mint hint pill beside them. Answering hides both, shows a 「sent」 chip, switches to the terminal tab, and reveals four transcript lines one after another (280ms each, staggered by 160ms).

## Do's and Don'ts

### Do:
- **Do** take every color from the app's dark family in `src/styles/tokens.css` and update the landing when those tokens change.
- **Do** keep the composition left-aligned in the 1200px container with 32px gutters (16px at ≤720px).
- **Do** keep the app window as the only deeply shadowed object. Divide everything else with hairlines (sep, sep-2).
- **Do** use a real table or definition list when content has two parts, and a hairline-ruled list for sequences.
- **Do** set `word-break: keep-all` on Korean text and begin every mono stack with the Hangul-routing face.
- **Do** keep motion tied to what the visitor does (the 220ms tab cross-fade, transcript lines after an answer) and remove it under `prefers-reduced-motion`.

### Don't:
- **Don't** use glow, gradients, glass or backdrop blur, or pulsing.
- **Don't** fade, slide or animate anything in on scroll or page load.
- **Don't** center a SaaS-style hero, or lay out features as a grid of identical cards.
- **Don't** add uppercase or small-caps eyebrow labels above headings.
- **Don't** fill anything with the accent except the primary action and the live answer target.
- **Don't** introduce a second typeface or a system display face. Pretendard does display, body and labels.
