# ezInstaDL

Discreet save buttons for Instagram photos, videos, carousels, Reels, and Stories.

A userscript for [Violentmonkey](https://violentmonkey.github.io/), Tampermonkey, and other managers that speak the same header format.

**Current version:** v0.1.2

Repository: [github.com/abb0r/ezInstaDL](https://github.com/abb0r/ezInstaDL)

## What it does

- Places a small control on each post image or video, including profile grid tiles and `/p/` permalinks.
- Single photo or video → one button.
- Carousel → two buttons: current slide, and the whole set.
- Reels and Stories get the same control on the media.
- Prefers the full-size URL Instagram already loaded for your session.
- Built to stay visible with uBlock Origin enabled.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/get-it/) (or Tampermonkey).
2. Open [`ezInstaDL.user.js`](https://raw.githubusercontent.com/abb0r/ezInstaDL/main/ezInstaDL.user.js).
3. Confirm the install prompt.
4. Reload Instagram.

Updates use the `@updateURL` in the script header, pointing at the `main` branch file.

## Use

Open the Instagram feed, a post, a Reel, or a Story. The control sits on the lower-right of the media. Click the single arrow to save the visible item. On carousels, the stacked icon saves every slide.

Filenames look like `username_shortcode.jpg` or `username_shortcode_02.mp4`.

## Limits

Instagram does not offer an official download API for the web feed. The script reads media that the page already requested. Markup and GraphQL shapes change without notice, so a future Instagram redesign can hide the buttons until the script is updated.

Live video and some ads are out of scope in v0.1.x.

## Privacy

The script runs entirely in your browser. It does not send media or account data to a third-party server. Saves go through the userscript manager (`GM_download` / `GM_xmlhttpRequest`).

## License

MIT. See [LICENSE](LICENSE).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
