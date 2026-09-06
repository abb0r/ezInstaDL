// ==UserScript==
// @name         ezInstaDL
// @namespace    https://github.com/abb0r/ezInstaDL
// @version      0.1.0
// @description  Discreet download buttons for Instagram photos, videos, carousels, reels, and stories.
// @author       abb0r
// @homepageURL  https://github.com/abb0r/ezInstaDL
// @supportURL   https://github.com/abb0r/ezInstaDL/issues
// @downloadURL  https://raw.githubusercontent.com/abb0r/ezInstaDL/main/ezInstaDL.user.js
// @updateURL    https://raw.githubusercontent.com/abb0r/ezInstaDL/main/ezInstaDL.user.js
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @icon         https://www.instagram.com/favicon.ico
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      cdninstagram.com
// @connect      fbcdn.net
// @connect      instagram.com
// @connect      *
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const NS = "ezidl";
  const VERSION = "0.1.0";
  const LOG = "[ezInstaDL]";

  /** @typedef {{ url: string, type: "image" | "video", width?: number, height?: number }} MediaItem */
  /** @typedef {{ id: string, shortcode?: string, username?: string, items: MediaItem[] }} PostRecord */

  /** @type {Map<string, PostRecord>} */
  const byShortcode = new Map();
  /** @type {Map<string, PostRecord>} */
  const byId = new Map();
  /** @type {PostRecord[]} */
  const records = [];

  const seenJson = new WeakSet();

  function bestUrl(versions) {
    if (!Array.isArray(versions) || !versions.length) return null;
    const scored = versions
      .filter((v) => v && typeof v.url === "string")
      .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
    return scored[0] || null;
  }

  function itemFromNode(node) {
    if (!node || typeof node !== "object") return null;

    const videoVersions = node.video_versions || node.videoVersions;
    const imageVersions =
      (node.image_versions2 && node.image_versions2.candidates) ||
      (node.imageVersions2 && node.imageVersions2.candidates) ||
      node.display_resources;

    if (node.video_url && typeof node.video_url === "string") {
      return { url: node.video_url, type: "video", width: node.dimensions?.width, height: node.dimensions?.height };
    }
    if (videoVersions) {
      const best = bestUrl(videoVersions);
      if (best) return { url: best.url, type: "video", width: best.width, height: best.height };
    }
    if (node.display_url && typeof node.display_url === "string") {
      return {
        url: node.display_url,
        type: node.is_video ? "video" : "image",
        width: node.dimensions?.width,
        height: node.dimensions?.height,
      };
    }
    if (imageVersions) {
      const best = bestUrl(imageVersions);
      if (best) return { url: best.url, type: "image", width: best.width, height: best.height };
    }
    return null;
  }

  function collectItems(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node.carousel_media) && node.carousel_media.length) {
      return node.carousel_media.map(itemFromNode).filter(Boolean);
    }
    const sidecar = node.edge_sidecar_to_children;
    if (sidecar && Array.isArray(sidecar.edges) && sidecar.edges.length) {
      return sidecar.edges.map((e) => itemFromNode(e && e.node)).filter(Boolean);
    }
    if (Array.isArray(node.carousel_media_items) && node.carousel_media_items.length) {
      return node.carousel_media_items.map(itemFromNode).filter(Boolean);
    }
    const single = itemFromNode(node);
    return single ? [single] : [];
  }

  function remember(rec) {
    if (!rec || !rec.items || !rec.items.length) return;
    records.push(rec);
    if (rec.shortcode) byShortcode.set(rec.shortcode, rec);
    if (rec.id) byId.set(String(rec.id), rec);
  }

  function ingestNode(node) {
    if (!node || typeof node !== "object") return;
    const shortcode = node.shortcode || node.code;
    const id = node.id || node.pk || node.media_id;
    const username =
      node.user?.username ||
      node.owner?.username ||
      node.user?.unique_id ||
      undefined;
    const items = collectItems(node);
    if (!items.length) return;
    if (!shortcode && !id) return;
    remember({
      id: String(id || shortcode),
      shortcode: shortcode ? String(shortcode) : undefined,
      username,
      items,
    });
  }

  function walkJson(value, depth) {
    if (value == null || depth > 28) return;
    if (typeof value !== "object") return;
    if (seenJson.has(value)) return;
    seenJson.add(value);

    if (!Array.isArray(value)) {
      const looksMedia =
        value.video_versions ||
        value.image_versions2 ||
        value.display_url ||
        value.video_url ||
        value.carousel_media ||
        value.edge_sidecar_to_children ||
        value.code ||
        value.shortcode;
      if (looksMedia) ingestNode(value);
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walkJson(value[i], depth + 1);
      return;
    }
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) walkJson(value[keys[i]], depth + 1);
  }

  function ingestPayload(data) {
    try {
      if (typeof data === "string") {
        const trimmed = data.trim();
        if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return;
        data = JSON.parse(trimmed);
      }
      walkJson(data, 0);
    } catch {
      /* ignore non-json */
    }
  }

  function hookNetwork() {
    const rawFetch = window.fetch;
    if (typeof rawFetch === "function") {
      window.fetch = function () {
        const p = rawFetch.apply(this, arguments);
        try {
          p.then((res) => {
            try {
              const ct = (res.headers && res.headers.get("content-type")) || "";
              if (!/json|javascript|text\/plain/i.test(ct) && ct) return;
              res.clone().text().then(ingestPayload).catch(() => {});
            } catch {
              /* ignore */
            }
          }).catch(() => {});
        } catch {
          /* ignore */
        }
        return p;
      };
    }

    const RawXHR = window.XMLHttpRequest;
    if (RawXHR && RawXHR.prototype) {
      const rawOpen = RawXHR.prototype.open;
      const rawSend = RawXHR.prototype.send;
      RawXHR.prototype.open = function () {
        try {
          this.__ezidl = true;
        } catch {
          /* ignore */
        }
        return rawOpen.apply(this, arguments);
      };
      RawXHR.prototype.send = function () {
        try {
          this.addEventListener("load", function () {
            try {
              ingestPayload(this.responseText);
            } catch {
              /* ignore */
            }
          });
        } catch {
          /* ignore */
        }
        return rawSend.apply(this, arguments);
      };
    }
  }

  function scanEmbeddedJson() {
    const scripts = document.querySelectorAll("script");
    for (let i = 0; i < scripts.length; i++) {
      const t = scripts[i].textContent;
      if (!t || t.length < 40) continue;
      if (t.indexOf("shortcode") === -1 && t.indexOf("video_versions") === -1 && t.indexOf("display_url") === -1) {
        continue;
      }
      ingestPayload(t);
    }
  }

  hookNetwork();

  const STYLE = `
    .${NS}-bar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      padding: 6px 4px 2px;
      pointer-events: none;
    }
    .${NS}-bar button {
      pointer-events: auto;
      appearance: none;
      border: 0;
      margin: 0;
      width: 30px;
      height: 30px;
      border-radius: 999px;
      background: rgba(12, 12, 14, 0.72);
      color: #f3f3f4;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.12);
      transition: background 150ms ease, transform 150ms ease, opacity 150ms ease;
      opacity: 0.82;
    }
    .${NS}-bar button:hover {
      background: rgba(20, 20, 24, 0.92);
      opacity: 1;
    }
    .${NS}-bar button:active { transform: scale(0.96); }
    .${NS}-bar button[disabled] { opacity: 0.45; cursor: default; }
    .${NS}-bar button svg { width: 15px; height: 15px; display: block; }
    .${NS}-toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      background: rgba(14,14,16,0.92);
      color: #f4f4f5;
      font: 500 12px/1.4 system-ui, -apple-system, sans-serif;
      padding: 10px 12px;
      border-radius: 10px;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.1);
      max-width: 240px;
      pointer-events: none;
    }
    .${NS}-story-wrap {
      position: absolute;
      right: 12px;
      bottom: 84px;
      z-index: 2147483000;
    }
    .${NS}-story-wrap .${NS}-bar { padding: 0; }
  `;

  const ICON_ONE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="M7.5 11.5 12 16l4.5-4.5"/><path d="M5 19h14"/></svg>`;
  const ICON_ALL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="12" height="12" rx="1.5"/><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15"/><path d="M11 11v6"/><path d="M8.5 14.5 11 17l2.5-2.5"/></svg>`;

  function injectStyle() {
    if (document.getElementById(`${NS}-style`)) return;
    const el = document.createElement("style");
    el.id = `${NS}-style`;
    el.textContent = STYLE;
    (document.head || document.documentElement).appendChild(el);
  }

  function toast(msg) {
    let n = document.getElementById(`${NS}-toast`);
    if (!n) {
      n = document.createElement("div");
      n.id = `${NS}-toast`;
      n.className = `${NS}-toast`;
      document.documentElement.appendChild(n);
    }
    n.textContent = msg;
    n.style.opacity = "1";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      n.style.opacity = "0";
    }, 2200);
  }

  function extFromUrl(url, type) {
    try {
      const clean = url.split("?")[0];
      const m = clean.match(/\.(jpe?g|png|webp|mp4|mov|m4v)$/i);
      if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
    } catch {
      /* ignore */
    }
    return type === "video" ? "mp4" : "jpg";
  }

  function safeName(s) {
    return String(s || "instagram")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "instagram";
  }

  function filenameFor(item, meta, index, total) {
    const user = safeName(meta.username || "user");
    const code = safeName(meta.shortcode || meta.id || "media");
    const ext = extFromUrl(item.url, item.type);
    if (total > 1) return `${user}_${code}_${String(index + 1).padStart(2, "0")}.${ext}`;
    return `${user}_${code}.${ext}`;
  }

  function gmDownload(url, name) {
    return new Promise((resolve, reject) => {
      if (typeof GM_download !== "function") {
        reject(new Error("GM_download missing"));
        return;
      }
      try {
        GM_download({
          url,
          name,
          saveAs: false,
          headers: { Referer: "https://www.instagram.com/" },
          onload: () => resolve(),
          onerror: (e) => reject(e || new Error("download failed")),
          ontimeout: () => reject(new Error("timeout")),
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function xhrBlob(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          responseType: "blob",
          headers: { Referer: "https://www.instagram.com/" },
          onload: (res) => {
            if (res.status >= 200 && res.status < 300 && res.response) resolve(res.response);
            else reject(new Error("status " + res.status));
          },
          onerror: () => reject(new Error("xhr error")),
        });
        return;
      }
      fetch(url, { credentials: "include" })
        .then((r) => {
          if (!r.ok) throw new Error("status " + r.status);
          return r.blob();
        })
        .then(resolve)
        .catch(reject);
    });
  }

  function saveBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.rel = "noopener";
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  }

  async function downloadUrl(url, name) {
    if (!url) throw new Error("no url");
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      const blob = await fetch(url).then((r) => r.blob());
      saveBlob(blob, name);
      return;
    }
    try {
      await gmDownload(url, name);
      return;
    } catch {
      /* fallback */
    }
    const blob = await xhrBlob(url);
    saveBlob(blob, name);
  }

  function hrefShortcode(root) {
    const links = root.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute("href") || "";
      const m = href.match(/\/(p|reel|reels)\/([^/?#]+)/);
      if (m) return m[2];
    }
    const path = location.pathname;
    const m2 = path.match(/\/(p|reel|reels)\/([^/?#]+)/);
    return m2 ? m2[2] : null;
  }

  function hrefUsername(root) {
    const path = location.pathname;
    const story = path.match(/^\/stories\/([^/?#]+)/);
    if (story) return story[1];
    const links = root.querySelectorAll('a[href^="/"]');
    for (let i = 0; i < links.length; i++) {
      const href = (links[i].getAttribute("href") || "").split("?")[0];
      if (!/^\/[A-Za-z0-9._]+\/?$/.test(href)) continue;
      if (/^\/(p|reel|reels|stories|direct|explore|accounts|about)\//.test(href + "/")) continue;
      const user = href.replace(/\//g, "");
      if (user && user !== "instagram") return user;
    }
    return null;
  }

  function isAvatar(img) {
    const w = img.clientWidth || img.naturalWidth || 0;
    const h = img.clientHeight || img.naturalHeight || 0;
    if (w && h && w <= 110 && h <= 110) return true;
    const alt = (img.getAttribute("alt") || "").toLowerCase();
    if (alt.includes("profile picture")) return true;
    return false;
  }

  function isMediaImg(img) {
    if (!img || isAvatar(img)) return false;
    const src = img.currentSrc || img.src || "";
    if (!src || src.startsWith("data:")) return false;
    const w = img.clientWidth || 0;
    const h = img.clientHeight || 0;
    if (w && h && (w < 140 || h < 140)) return false;
    return true;
  }

  function visibleBox(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    return true;
  }

  function currentDomMedia(root) {
    const videos = Array.from(root.querySelectorAll("video")).filter(visibleBox);
    if (videos.length) {
      const v = videos[0];
      const url = v.currentSrc || v.src || (v.querySelector("source") && v.querySelector("source").src) || "";
      if (url) return { url, type: "video" };
    }
    const imgs = Array.from(root.querySelectorAll("img")).filter((img) => isMediaImg(img) && visibleBox(img));
    if (!imgs.length) return null;
    imgs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    const img = imgs[0];
    return { url: img.currentSrc || img.src, type: "image" };
  }

  function carouselHint(root) {
    const next = root.querySelector('[aria-label="Next"], [aria-label="Weiter"]');
    const prev = root.querySelector('[aria-label="Go back"], [aria-label="Back"], [aria-label="Zurück"]');
    const dots = root.querySelectorAll('div[class] > div[style*="transform"], button[aria-label*="slide" i]');
    return Boolean(next || prev || (dots && dots.length > 2));
  }

  function currentIndex(root, total) {
    if (!total || total < 2) return 0;
    const labeled = root.querySelector("[aria-label*=' of '], [aria-label*=' von ']");
    if (labeled) {
      const t = labeled.getAttribute("aria-label") || labeled.textContent || "";
      const m = t.match(/(\d+)\s*(of|von)\s*(\d+)/i);
      if (m) return Math.max(0, Math.min(total - 1, Number(m[1]) - 1));
    }
    const buttons = Array.from(root.querySelectorAll("button, div[role='button']"));
    for (let i = 0; i < buttons.length; i++) {
      const label = buttons[i].getAttribute("aria-label") || "";
      const m = label.match(/(\d+)\s*(of|von)\s*(\d+)/i);
      if (m) return Math.max(0, Math.min(total - 1, Number(m[1]) - 1));
    }
    return 0;
  }

  function lookupRecord(root) {
    const code = hrefShortcode(root) || hrefShortcode(document.body);
    if (code && byShortcode.has(code)) return byShortcode.get(code);
    if (code) {
      for (const rec of records) {
        if (rec.shortcode === code) return rec;
      }
    }
    return null;
  }

  function resolveItems(root) {
    const rec = lookupRecord(root);
    const username = rec?.username || hrefUsername(root) || "instagram";
    const shortcode = rec?.shortcode || hrefShortcode(root) || "media";
    if (rec && rec.items.length) {
      return { items: rec.items, username, shortcode, id: rec.id };
    }
    const one = currentDomMedia(root);
    if (!one) return null;
    return { items: [one], username, shortcode, id: shortcode };
  }

  function stop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  }

  function makeButton(title, svg, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = svg;
    b.addEventListener("click", (ev) => {
      stop(ev);
      onClick(b);
    });
    b.addEventListener("mousedown", stop);
    b.addEventListener("pointerdown", stop);
    return b;
  }

  async function downloadItems(list, meta, startLabel) {
    toast(startLabel);
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const name = filenameFor(item, meta, i, list.length > 1 ? list.length : meta.totalHint || 1);
      try {
        await downloadUrl(item.url, name);
      } catch (err) {
        console.warn(LOG, "download failed", err);
        toast("Download failed");
        return;
      }
      if (i < list.length - 1) await new Promise((r) => setTimeout(r, 280));
    }
    toast(list.length > 1 ? `Saved ${list.length} files` : "Saved");
  }

  function findMediaMount(root) {
    const video = Array.from(root.querySelectorAll("video")).find(visibleBox);
    if (video) {
      return video.closest("div") || video.parentElement;
    }
    const img = Array.from(root.querySelectorAll("img")).find((n) => isMediaImg(n) && visibleBox(n));
    if (img) return img.closest("div") || img.parentElement;
    return null;
  }

  function attachBar(root, opts) {
    if (!root || root.querySelector(`:scope > .${NS}-bar, :scope .${NS}-bar`)) {
      const existing = root.querySelector(`.${NS}-bar`);
      if (existing && existing.isConnected) return;
    }
    const resolved = resolveItems(opts.scope || root);
    if (!resolved || !resolved.items.length) return;

    const isCarousel = resolved.items.length > 1 || carouselHint(opts.scope || root);
    const bar = document.createElement("div");
    bar.className = `${NS}-bar`;
    bar.dataset.ezidl = "1";

    const oneBtn = makeButton("Download current media", ICON_ONE, async (btn) => {
      btn.disabled = true;
      const fresh = resolveItems(opts.scope || root) || resolved;
      const idx = currentIndex(opts.scope || root, fresh.items.length);
      const item = fresh.items[idx] || currentDomMedia(opts.scope || root) || fresh.items[0];
      try {
        await downloadItems([item], { ...fresh, totalHint: fresh.items.length }, "Downloading…");
      } finally {
        btn.disabled = false;
      }
    });
    bar.appendChild(oneBtn);

    if (isCarousel) {
      const allBtn = makeButton("Download entire carousel", ICON_ALL, async (btn) => {
        btn.disabled = true;
        const fresh = resolveItems(opts.scope || root) || resolved;
        if (fresh.items.length < 2) {
          const one = currentDomMedia(opts.scope || root);
          if (one) await downloadItems([one], fresh, "Downloading…");
          btn.disabled = false;
          return;
        }
        try {
          await downloadItems(fresh.items, fresh, `Downloading ${fresh.items.length}…`);
        } finally {
          btn.disabled = false;
        }
      });
      bar.appendChild(allBtn);
    }

    if (opts.mode === "overlay") {
      const wrap = document.createElement("div");
      wrap.className = `${NS}-story-wrap`;
      wrap.appendChild(bar);
      const host = opts.mount || root;
      const style = window.getComputedStyle(host);
      if (style.position === "static") host.style.position = "relative";
      host.appendChild(wrap);
      return;
    }

    const mount = opts.mount || findMediaMount(opts.scope || root);
    if (!mount || !mount.parentElement) return;
    mount.insertAdjacentElement("afterend", bar);
  }

  function articleRoots() {
    return Array.from(document.querySelectorAll("article"));
  }

  function isStoryPath() {
    return /^\/stories\//.test(location.pathname);
  }

  function isReelPath() {
    return /^\/(reel|reels)\//.test(location.pathname);
  }

  function storyFrame() {
    const videos = Array.from(document.querySelectorAll("video")).filter(visibleBox);
    if (videos.length) return videos[0].closest("section") || videos[0].parentElement;
    const imgs = Array.from(document.querySelectorAll("img")).filter((n) => isMediaImg(n) && visibleBox(n));
    if (imgs.length) {
      imgs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
      return imgs[0].closest("section") || imgs[0].parentElement;
    }
    return null;
  }

  function reelFrame() {
    const main = document.querySelector("main") || document.body;
    const video = Array.from(main.querySelectorAll("video")).find(visibleBox);
    if (video) return video.closest("section") || video.closest("article") || main;
    return document.querySelector("article") || main;
  }

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }

  function scan() {
    injectStyle();
    if (isStoryPath()) {
      const frame = storyFrame();
      if (frame && !frame.querySelector(`.${NS}-bar`)) {
        attachBar(frame, { mode: "overlay", scope: frame, mount: frame });
      }
      return;
    }

    if (isReelPath()) {
      const frame = reelFrame();
      if (frame && !frame.querySelector(`.${NS}-bar`)) {
        attachBar(frame, { mode: "overlay", scope: frame, mount: frame });
      }
    }

    const articles = articleRoots();
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      if (article.querySelector(`.${NS}-bar`)) continue;
      if (!currentDomMedia(article) && !lookupRecord(article)) continue;
      attachBar(article, { mode: "below", scope: article });
    }
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(() => {
    injectStyle();
    scanEmbeddedJson();
    scan();
    const obs = new MutationObserver(() => scheduleScan());
    obs.observe(document.documentElement, { childList: true, subtree: true });
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        scanEmbeddedJson();
        scan();
      }
    }, 600);
    console.info(LOG, "ready", VERSION);
  });
})();
