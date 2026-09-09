# Changelog

All notable changes to ezInstaDL are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] — 2026-09-10

### Fixed

- Saving the current carousel slide always stored the first item. Off-screen slides still had a large layout box, so the picker never moved. The control now uses the on-screen intersection of each slide, matches that URL to the cached set, and falls back to the visible `img`/`video` src if needed.

## [0.1.5] — 2026-09-06

### Fixed

- Standalone `/p/{shortcode}/` pages often have a leftover small `role="dialog"` in the DOM. The script treated that as the viewer and never looked at the real photo. Dialogs are now ignored unless they are large and on screen.
- Permalink media is chosen as the largest on-screen `img`/`video` (left column preferred). If nothing matches, a fallback control is still pinned to the page so the button cannot disappear.

## [0.1.4] — 2026-09-06

### Fixed

- Opening a post from a profile left the grid controls in place. They were `position: fixed` over the modal, which looked like a field of buttons on the photo. A dialog or `/p/` permalink now shows a single control on the focused media and hides the grid overlays.
- Carousel detection on permalinks looks at the dialog/article around the image, not only inside the `img` node.

## [0.1.3] — 2026-09-06

### Fixed

- Direct `/p/{shortcode}/` pages wrapped the whole column in one tall container, so the control was painted below the viewport. The button now tracks the visible image or video and stays inside the window.
- Permalink media is chosen by on-screen area (not the first `video` on the page). `srcset` and Open Graph image/video tags are used when `currentSrc` is still empty.

## [0.1.2] — 2026-09-06

### Added

- Save controls on profile grids (posts / reels / tagged tiles), not only after opening a post.
- Save control on direct `/p/{shortcode}/` links. The media frame is found even when Instagram skips an `<article>` wrapper.

### Fixed

- Shortcode is read from the tile link itself, so grid items resolve the correct file.
- Scanner now reruns on a timer so late-rendered permalink media still gets a control.

## [0.1.1] — 2026-09-06

### Fixed

- Controls were covered by Instagram's invisible tap layer, so the icon showed but clicks never reached it. Buttons now sit in a top-level overlay with capture-phase handlers.
- uBlock Origin (Annoyances / social lists) hid the controls when attributes contained the word "Download". Labels are now "Save visible" / "Save set", and the UI lives in a closed shadow root so cosmetic filters cannot target the inner buttons.

### Changed

- Overlay is pinned to the lower-right of the visible media and follows scroll.

## [0.1.0] — 2026-09-06

### Added

- First public release of the Violentmonkey / Tampermonkey userscript.
- Discreet download control placed under feed posts and opened posts.
- Overlay control on Reels and Stories so the control stays reachable on tall media.
- Single-media posts show one button (current item).
- Carousel posts show two buttons: current slide, and every item in the carousel.
- Network sniffing of Instagram JSON responses to prefer full-size `video_versions` / `image_versions2` URLs over the compressed on-page preview.
- Fallback download path when `GM_download` is blocked (XHR blob + save).
- Filenames shaped as `{username}_{shortcode}` or `{username}_{shortcode}_{nn}` for carousels.

### Notes

- Stories and some live / ephemeral surfaces are best-effort. Instagram changes markup often; if a control is missing, refresh the page after the media has started playing.
- Only download media you have the right to keep.
