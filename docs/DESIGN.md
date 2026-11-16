# Design

The look is taken from shipped apps (see `docs/moodboard.jpg`, `docs/inspo/`):
- **Doji** (try-on, outfit builder): white canvas, one text serif for all UI, a product grid with hairline
  dividers and two-line captions, white floating circle buttons with labels underneath, docked pieces
  as white pills.
- **Alta** (closet): grey filter pills (black when active), a closet count, text tabs where the active
  one is ink and the rest grey.
- **Doppl** (Your Looks): tall grey look cards; its red-orange marks only live/rendering state.

Tokens live in `web/src/index.css` (`@theme`):
- **Type:** Source Serif 4 (optical sizes). Roles: display 40, title 22, body 15, label 14, meta 13,
  caps 11 (uppercase, +0.08em).
- **Colour:**
  - Base: ink #111 on white. Secondary text #5c5c5c, meta #767676.
  - Lines: hairlines #ebebea. Grey layer: #f5f5f4.
  - Accent: #e8452c, for live state only.
- **Space:** 4px base. Page gutter 32 (16 on phone); 40 between columns; header 72.
- **Depth:** `shadow-float` for floating controls, `shadow-lift` for overlays. Nothing else casts a shadow.
- **Motion:**
  - One authored moment: a render reveal that wipes in top to bottom while blur clears.
  - Everything else is a state change of 150–400 ms.
  - Reduced motion is respected.
- **Dark mode:**
  - The header toggle cycles system → light → dark; the choice is stored in localStorage and applied
    before first paint.
  - Dark tokens are in `index.css` under `:root[data-theme="dark"]`: a warm near-black canvas, with
    hairline rings added to the shadows.
  - Product photos sit on a light plate (`--color-plate`) with `mix-blend-multiply`, so cutouts shot on
    white blend in instead of showing as white squares.
- **Wishlist:**
  - Follows Alta: underlined "Closet | Wishlist" tabs, store and price on each item, a heart marker on wishlist pieces, and "I bought it" to move a piece into the closet.
  - To add from a shop link (inspired by Acloset's and Whering's URL import), paste the link and pick the cleanest product photo.
- **Compare:**
  - Based on Lightroom's two-up and survey views: 2–4 equal columns, zoom linked across columns (scroll wheel, drag to pan, `0` to fit), and a strip under each column with a favourite button, Open and remove.
  - A filmstrip of all try-ons lets you build the compare set.
  - "Wipe" (Lightroom's before/after) needs exactly 2 looks.
  - Pieces that differ between looks are outlined.
- **Usage limits:**
  - Modelled on Claude's and Gemini's Settings → Usage pages (a bar, how much is used, when it resets), plus an Apple Activity-style ring in the header.
  - The bar spans the provider's free allowance, with a hatched band for the share the app holds back; the marker sits at the usable %.
  - Each image shows as a dot (filled = try-on, ring = cleanup) that pops in when it lands.
  - Numbers count up and down instead of jumping; the bar fills on a spring.
- **Typefaces** (You → Typeface; stored per browser, applied before first paint):
  - Source Serif 4 (default) and Newsreader (serifs).
  - Manrope and Geist (sans). The sans faces tighten heading tracking.
- **You page:** engine and limit changes are drafts until Save, with a floating save bar that has Discard. The typeface applies and saves instantly, and is kept on the server so every browser matches.
- **Versions** (based on Google Flow's bottom timeline):
  - A strip under the photo shows the original, then every try-on as V1, V2, … The one on stage is outlined, and dots mark its path back to the original.
  - Click a version (or use ←/→) to put it on stage. The next Try on adds the picked pieces to that version, so you can branch from any point, including the original.
  - Regenerate makes another take from the same base; Before shows the version it was made from. A render in progress shows as a live tile at the end.
