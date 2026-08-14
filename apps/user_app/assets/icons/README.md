# TapGo Premium Icon System

This directory contains TapGo's approved premium navigation icon system for
user-facing release surfaces. The approved family is the default icon direction
for TapGo from Release 1 onward.

## Canonical Visual Style

- Original premium 3D vector-like illustration.
- Frameless standalone object on a transparent background.
- Smooth rounded geometry with glossy controlled gradients.
- Subtle dimensional depth and balanced optical weight.
- Readable at mobile navigation and menu tile sizes.
- No embedded white tile, rounded-square background frame, watermark, text, or
  copied third-party branding.
- No chroma-key residue or opaque baked-in frame.

## Palette

Use a restrained TapGo premium palette:

- Deep navy for structure and trust.
- Electric blue for primary digital energy.
- Turquoise for friendly service accents.
- Restrained warm gold for premium highlights.

Do not introduce unrelated one-off palettes unless Product Owner approval is
recorded for that specific icon.

## Source And Output Format

- Canonical source canvas: `1024x1024`.
- Release output: transparent PNG with RGBA alpha.
- Source artwork must remain original TapGo artwork.
- External references, watermarks, or brand marks must not be committed.
- Preview boards such as `preview-complete.jpg` are review artifacts only and
  must not be packaged in the app.

## Naming Convention

- Use lowercase snake_case filenames.
- Name by user-facing action, not by temporary screen location.
- Examples:
  - `member_card.png`
  - `support_ticket.png`
  - `privacy_policy.png`

## Implementation Rules

- Use `PremiumTapGoIcon` for user-facing TapGo navigation and action icons.
- Keep action-to-asset mapping centralized in `PremiumTapGoIconAction`.
- Do not scatter raw asset paths across screens.
- New user-facing features must receive a matching approved premium asset before
  release.
- Do not mix Material Icons, flat SVGs, emoji, framed 3D icons, and premium PNGs
  on the same navigation surface.
- Material Icons are allowed only for asset-error fallbacks and standard system
  controls such as back, close, overflow, search, visibility, or chevron.
- Small functional controls do not require custom premium illustrations.

## Sizing And Padding

- Render through an equal square layout box.
- Preserve aspect ratio with `BoxFit.contain`.
- Preserve transparency.
- Use consistent optical padding per surface.
- Minor per-icon optical scale is allowed only when needed to match visual
  weight with the rest of the family.

## Accessibility

- Parent action widgets must provide the semantic label.
- Decorative icon images should be excluded from semantics when the parent
  already describes the action.
- Preserve minimum touch target sizes on tappable rows, cards, and tiles.
- Never replace platform-standard affordances with decorative artwork when the
  system control is clearer.

## Prohibited Styles

- Embedded white tiles or rounded-square frames.
- Chroma-key backgrounds.
- Emoji, clipart, Material Icons as final navigation artwork, or generic flat
  SVG packs.
- Text, watermarks, third-party branding, or copied reference marks.
- Low-resolution raster exports that blur at mobile size.

## Adding A New Icon

1. Confirm the feature is approved for release.
2. Create or approve a matching premium TapGo asset on a `1024x1024`
   transparent canvas.
3. Validate RGBA transparency, transparent corners, no chroma-key residue, and
   no opaque frame.
4. Add the PNG under the relevant icon folder with a snake_case filename.
5. Add a `PremiumTapGoIconAction` entry and central label mapping.
6. Use `PremiumTapGoIcon` from the UI surface.
7. Add widget tests proving the asset resolves and no legacy framed icon is used
   on the same navigation surface.

## Future Migration Inventory

Direct-mode and deferred-feature service icons remain outside the Release 1
scope. When those features become release candidates, migrate their visible
navigation icons into this premium system instead of mixing old SVG or framed
fallback styles with the approved premium family.
