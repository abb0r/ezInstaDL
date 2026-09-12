// ==UserScript==
// @name         ezInstaDL
// @namespace    https://github.com/abb0r/ezInstaDL
// @version      0.1.8
// @description  Discreet save buttons for Instagram photos, videos, carousels, reels, and stories.
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
  const VERSION = "0.1.8";
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

  function requestUrl(input) {
    if (!input) return "";
    if (typeof input === "string") return input;
    try {
      if (typeof URL !== "undefined" && input instanceof URL) return input.href;
    } catch {
      /* ignore */
    }
    return input.url || "";
  }

  function looksLikeMediaRequest(url, contentType) {
    const u = String(url || "");
    const ct = String(contentType || "");
    if (/video|audio|mpegurl|dash\+xml|octet-stream|mp4|webm|m4a|aac|mp2t/i.test(ct)) return true;
    if (/\.(mp4|m4a|m4v|webm|mpd|m3u8|ts|aac)(\?|$)/i.test(u)) return true;
    if (/(scontent|cdninstagram|fbcdn|fbcdn\.net)/i.test(u) && !/graphql|\/api\//i.test(u)) return true;
    return false;
  }

  function looksLikeApiRequest(url, contentType) {
    if (looksLikeMediaRequest(url, contentType)) return false;
    const u = String(url || "");
    const ct = String(contentType || "");
    if (/json|javascript/i.test(ct)) return true;
    if (/graphql|query_hash|doc_id|\/api\/v1\/|polaris|ajax\/bulk-route/i.test(u)) return true;
    return false;
  }

  function hookFetch(target) {
    if (!target || typeof target.fetch !== "function") return;
    const raw = target.fetch;
    if (raw.__ezidl) return;
    const wrapped = function (input) {
      const url = requestUrl(input);
      const p = raw.apply(this, arguments);
      if (looksLikeMediaRequest(url, "")) return p;
      if (!looksLikeApiRequest(url, "") && url) return p;
      try {
        p.then((res) => {
          try {
            const ct = (res.headers && res.headers.get("content-type")) || "";
            if (looksLikeMediaRequest(res.url || url, ct)) return;
            if (!looksLikeApiRequest(res.url || url, ct) && ct && !/json|javascript|text\/plain/i.test(ct)) return;
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
    wrapped.__ezidl = true;
    try {
      target.fetch = wrapped;
    } catch {
      /* ignore */
    }
  }

  function hookNetwork() {
    hookFetch(window);
    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow && unsafeWindow !== window) {
        hookFetch(unsafeWindow);
      }
    } catch {
      /* isolated world */
    }

    const RawXHR = window.XMLHttpRequest;
    if (RawXHR && RawXHR.prototype) {
      const rawOpen = RawXHR.prototype.open;
      const rawSend = RawXHR.prototype.send;
      RawXHR.prototype.open = function (method, url) {
        try {
          this.__ezidlUrl = url ? String(url) : "";
        } catch {
          this.__ezidlUrl = "";
        }
        return rawOpen.apply(this, arguments);
      };
      RawXHR.prototype.send = function () {
        try {
          const url = this.__ezidlUrl || "";
          if (!looksLikeMediaRequest(url, "") && looksLikeApiRequest(url, "application/json")) {
            this.addEventListener("load", function () {
              try {
                if (this.responseType && this.responseType !== "" && this.responseType !== "text" && this.responseType !== "json") {
                  return;
                }
                ingestPayload(this.responseText);
              } catch {
                /* ignore */
              }
            });
          }
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

  const SHADOW_CSS = `
    :host {
      position: fixed;
      z-index: 2147483646;
      pointer-events: none;
    }
    .bar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      pointer-events: auto;
    }
    button {
      appearance: none;
      border: 0;
      margin: 0;
      width: 32px;
      height: 32px;
      border-radius: 999px;
      background: rgba(12, 12, 14, 0.88);
      color: #f3f3f4;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.16);
      pointer-events: auto;
    }
    button:hover { background: rgba(24, 24, 28, 0.96); }
    button:active { transform: scale(0.96); }
    button[disabled] { opacity: 0.45; cursor: default; }
    button svg { width: 15px; height: 15px; display: block; pointer-events: none; }
  `;

  const ICON_ONE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="M7.5 11.5 12 16l4.5-4.5"/><path d="M5 19h14"/></svg>`;
  const ICON_ALL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="12" height="12" rx="1.5"/><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15"/><path d="M11 11v6"/><path d="M8.5 14.5 11 17l2.5-2.5"/></svg>`;

  function toast(msg) {
    let n = document.getElementById(`${NS}-toast`);
    if (!n) {
      n = document.createElement("div");
      n.id = `${NS}-toast`;
      n.setAttribute("data-ezidl", "toast");
      n.style.cssText =
        "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:rgba(14,14,16,.92);color:#f4f4f5;font:500 12px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:10px;box-shadow:0 0 0 1px rgba(255,255,255,.1);max-width:240px;pointer-events:none;";
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
          onerror: (e) => reject(e || new Error("save failed")),
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
    const own = (root.getAttribute && root.getAttribute("href")) || "";
    const ownMatch = own.match(/\/(p|reel|reels)\/([^/?#]+)/);
    if (ownMatch) return ownMatch[2];
    const links = root.querySelectorAll
      ? root.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]')
      : [];
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
    if (w && h && w <= 140 && h <= 140) return true;
    const alt = (img.getAttribute("alt") || "").toLowerCase();
    if (alt.includes("profile picture")) return true;
    return false;
  }

  function imgUrl(img) {
    if (!img) return "";
    return (
      img.currentSrc ||
      img.src ||
      (img.srcset && img.srcset.split(",")[0].trim().split(" ")[0]) ||
      img.getAttribute("src") ||
      ""
    );
  }

  function isMediaImg(img) {
    if (!img || isAvatar(img)) return false;
    const src = imgUrl(img);
    if (src.startsWith("data:")) return false;
    const w = img.clientWidth || 0;
    const h = img.clientHeight || 0;
    if (w && h && (w < 90 || h < 90)) return false;
    return Boolean(src) || (w >= 160 && h >= 160);
  }

  function visibleBox(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  function intersectsView(el) {
    if (!visibleBox(el)) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 60 && r.top < window.innerHeight - 40 && r.right > 40 && r.left < window.innerWidth - 40;
  }

  function collectMedia(root) {
    if (!root || !root.querySelectorAll) return [];
    const out = [];
    const videos = root.querySelectorAll("video");
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (!visibleBox(v)) continue;
      const url = v.currentSrc || v.src || (v.querySelector("source") && v.querySelector("source").src) || "";
      out.push({ url, type: "video", el: v, area: v.clientWidth * v.clientHeight, inView: intersectsView(v) });
    }
    const imgs = root.querySelectorAll("img");
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!isMediaImg(img) || !visibleBox(img)) continue;
      out.push({
        url: imgUrl(img),
        type: "image",
        el: img,
        area: img.clientWidth * img.clientHeight,
        inView: intersectsView(img),
      });
    }
    return out;
  }

  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    const left = Math.max(r.left, 0);
    const right = Math.min(r.right, window.innerWidth);
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);
    return { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  function mediaFromEl(el) {
    if (!el) return null;
    if (el.tagName === "VIDEO") {
      const url = el.currentSrc || el.src || (el.querySelector("source") && el.querySelector("source").src) || "";
      return { url, type: "video", el };
    }
    return { url: imgUrl(el), type: "image", el };
  }

  function eachMediaEl(root, fn) {
    if (!root) return;
    if (root.tagName === "IMG" || root.tagName === "VIDEO") fn(root);
    if (!root.querySelectorAll) return;
    const nodes = root.querySelectorAll("img, video");
    for (let i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  function biggestOnScreenMedia(root) {
    const scope = root && (root.querySelectorAll || root.tagName) ? root : document;
    let best = null;
    eachMediaEl(scope, (el) => {
      if (el.tagName === "IMG" && isAvatar(el)) return;
      const vis = visibleRect(el);
      if (vis.width < 160 || vis.height < 160) return;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      const centerX = vis.left + vis.width / 2;
      const bias = centerX < window.innerWidth * 0.7 ? 1.3 : 0.75;
      const score = vis.width * vis.height * bias;
      if (!best || score > best.score) best = { el, score };
    });
    return best ? mediaFromEl(best.el) : null;
  }

  function currentDomMedia(root) {
    const tight = biggestOnScreenMedia(root);
    if (tight) return tight;
    const all = collectMedia(root);
    if (!all.length) {
      const tile = root && root.tagName === "IMG" ? root : root && root.querySelector && root.querySelector("img");
      if (tile && imgUrl(tile) && !isAvatar(tile)) {
        return { url: imgUrl(tile), type: "image", el: tile };
      }
      return null;
    }
    const visible = all.filter((m) => m.inView);
    const pool = visible.length ? visible : all;
    pool.sort((a, b) => b.area - a.area);
    const best = pool[0];
    return { url: best.url, type: best.type, el: best.el };
  }

  function mediaAnchor(root) {
    const hit = currentDomMedia(root);
    if (hit && hit.el) return hit.el;
    const r = root.getBoundingClientRect();
    if (r.height > window.innerHeight * 0.9) {
      const any = collectMedia(document.body);
      const vis = any.filter((m) => m.inView).sort((a, b) => b.area - a.area);
      if (vis[0]) return vis[0].el;
    }
    return root;
  }

  function hintRoot(root) {
    return (
      (root.closest && (root.closest('div[role="dialog"]') || root.closest("article") || root.closest("section"))) ||
      root
    );
  }

  function carouselHint(root) {
    const box = hintRoot(root);
    const next = box.querySelector('[aria-label="Next"], [aria-label="Weiter"]');
    const prev = box.querySelector('[aria-label="Go back"], [aria-label="Back"], [aria-label="Zurück"], [aria-label="Previous"]');
    return Boolean(next || prev);
  }

  function urlTokens(url) {
    if (!url) return { file: "", core: "", cacheKey: "" };
    const noq = url.split("?")[0];
    const file = (noq.split("/").pop() || "").replace(/\.(jpe?g|png|webp|mp4|mov|m4v)$/i, "");
    const core = file.replace(/_[nsep]\d*$/i, "");
    let cacheKey = "";
    try {
      cacheKey = new URL(url, location.href).searchParams.get("ig_cache_key") || "";
    } catch {
      const m = url.match(/ig_cache_key=([^&]+)/);
      cacheKey = m ? decodeURIComponent(m[1]) : "";
    }
    return { file, core, cacheKey: cacheKey.split(".")[0] };
  }

  function urlsMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.split("?")[0] === b.split("?")[0]) return true;
    const A = urlTokens(a);
    const B = urlTokens(b);
    if (A.cacheKey && B.cacheKey && A.cacheKey === B.cacheKey) return true;
    if (A.core && A.core.length > 8 && A.core === B.core) return true;
    if (A.file && A.file.length > 8 && A.file === B.file) return true;
    return false;
  }

  function matchUrlIndex(items, url) {
    if (!url || !items) return -1;
    for (let i = 0; i < items.length; i++) {
      if (urlsMatch(items[i].url, url)) return i;
    }
    return -1;
  }

  function indexFromDots(box, total) {
    const rows = box.querySelectorAll("div, span");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.children.length < 2 || row.children.length > 20) continue;
      if (total && row.children.length !== total) continue;
      const kids = Array.from(row.children);
      const widths = kids.map((k) => k.getBoundingClientRect().width);
      if (widths.some((w) => w < 3 || w > 40)) continue;
      let active = -1;
      let bestW = -1;
      for (let j = 0; j < kids.length; j++) {
        const st = window.getComputedStyle(kids[j]);
        const w = widths[j];
        const op = Number(st.opacity);
        const score = w * (op > 0.7 ? 2 : 1);
        if (score > bestW) {
          bestW = score;
          active = j;
        }
      }
      if (active >= 0) return active;
    }
    return -1;
  }

  function indexFromHiddenSlides(box, total) {
    const slides = Array.from(box.querySelectorAll("li"));
    if (slides.length < 2) return -1;
    const shown = [];
    for (let i = 0; i < slides.length; i++) {
      if (slides[i].getAttribute("aria-hidden") === "true") continue;
      const r = visibleRect(slides[i]);
      if (r.width < 80) continue;
      shown.push({ i, area: r.width * r.height });
    }
    if (!shown.length) return -1;
    shown.sort((a, b) => b.area - a.area);
    const idx = shown[0].i;
    if (total && idx >= total) return -1;
    return idx;
  }

  function currentIndex(root, total) {
    if (!total || total < 2) return 0;
    const box = hintRoot(root);
    const labeled = box.querySelector("[aria-label*=' of '], [aria-label*=' von ']");
    if (labeled) {
      const t = labeled.getAttribute("aria-label") || labeled.textContent || "";
      const m = t.match(/(\d+)\s*(of|von)\s*(\d+)/i);
      if (m) return Math.max(0, Math.min(total - 1, Number(m[1]) - 1));
    }
    const buttons = Array.from(box.querySelectorAll("button, div[role='button']"));
    for (let i = 0; i < buttons.length; i++) {
      const label = buttons[i].getAttribute("aria-label") || "";
      const m = label.match(/(\d+)\s*(of|von)\s*(\d+)/i);
      if (m) return Math.max(0, Math.min(total - 1, Number(m[1]) - 1));
    }
    const hiddenIdx = indexFromHiddenSlides(box, total);
    if (hiddenIdx >= 0) return hiddenIdx;
    const dotIdx = indexFromDots(box, total);
    if (dotIdx >= 0) return dotIdx;
    return 0;
  }

  function searchRoot(scope) {
    return (
      hintRoot(scope) ||
      viewerDialog() ||
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.body
    );
  }

  function isWeakVideoUrl(url, type) {
    if (type && type !== "video") return false;
    if (!url) return true;
    if (url.startsWith("blob:") || url.startsWith("data:")) return true;
    if (/^(mediasource|mediastream):/i.test(url)) return true;
    return false;
  }

  function pickCurrentItem(scope, items) {
    const vis = biggestOnScreenMedia(searchRoot(scope)) || currentDomMedia(searchRoot(scope));
    if (items && items.length) {
      if (vis && vis.url) {
        const matched = matchUrlIndex(items, vis.url);
        if (matched >= 0) return { item: items[matched], idx: matched };
      }
      const idx = currentIndex(scope, items.length);
      const cached = items[idx] || items[0];
      if (vis && isWeakVideoUrl(vis.url, vis.type) && cached) {
        return { item: cached, idx };
      }
      if (cached && cached.type === "video") return { item: cached, idx };
      if (vis && vis.url && !isWeakVideoUrl(vis.url, vis.type)) {
        return { item: { url: vis.url, type: vis.type }, idx };
      }
      return { item: cached, idx };
    }
    if (vis && vis.url && !isWeakVideoUrl(vis.url, vis.type)) return { item: vis, idx: -1 };
    return null;
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
    return { items: [{ url: one.url, type: one.type }], username, shortcode, id: shortcode };
  }

  function stop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
  }

  function bindAction(el, fn) {
    const run = (ev) => {
      stop(ev);
      fn(el);
    };
    ["pointerdown", "mousedown", "click", "touchstart"].forEach((type) => {
      el.addEventListener(type, run, true);
    });
  }

  async function downloadItems(list, meta, startLabel) {
    toast(startLabel);
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const name = filenameFor(
        item,
        meta,
        list.length === 1 && typeof meta.nameIndex === "number" ? meta.nameIndex : i,
        list.length > 1 ? list.length : meta.totalHint || 1,
      );
      try {
        await downloadUrl(item.url, name);
      } catch (err) {
        console.warn(LOG, "save failed", err);
        toast("Save failed");
        return;
      }
      if (i < list.length - 1) await new Promise((r) => setTimeout(r, 280));
    }
    toast(list.length > 1 ? `Saved ${list.length} files` : "Saved");
  }

  /** @type {Map<Element, { host: HTMLElement, scope: Element, shadow: ShadowRoot }>} */
  const overlays = new Map();

  function ensureOverlay(scope) {
    let rec = overlays.get(scope);
    if (rec && rec.host.isConnected) return rec;

    const host = document.createElement("div");
    host.setAttribute("data-ezidl", "1");
    host.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = SHADOW_CSS;
    const bar = document.createElement("div");
    bar.className = "bar";
    shadow.appendChild(style);
    shadow.appendChild(bar);
    document.documentElement.appendChild(host);

    rec = { host, scope, shadow };
    overlays.set(scope, rec);
    renderButtons(rec);
    return rec;
  }

  function renderButtons(rec) {
    const bar = rec.shadow.querySelector(".bar");
    if (!bar) return;
    bar.textContent = "";
    const resolved = resolveItems(rec.scope);
    const isCarousel = (resolved && resolved.items.length > 1) || carouselHint(rec.scope);

    const one = document.createElement("button");
    one.type = "button";
    one.setAttribute("aria-label", "Save visible");
    one.innerHTML = ICON_ONE;
    bindAction(one, async (btn) => {
      btn.disabled = true;
      const fresh = resolveItems(rec.scope) || resolved;
      if (!fresh) {
        btn.disabled = false;
        return;
      }
      const picked = pickCurrentItem(rec.scope, fresh.items);
      if (!picked || !picked.item || !picked.item.url) {
        btn.disabled = false;
        toast("Nothing to save");
        return;
      }
      try {
        await downloadItems(
          [{ url: picked.item.url, type: picked.item.type }],
          { ...fresh, totalHint: fresh.items.length, nameIndex: picked.idx >= 0 ? picked.idx : 0 },
          "Saving…",
        );
      } finally {
        btn.disabled = false;
      }
    });
    bar.appendChild(one);

    if (isCarousel) {
      const all = document.createElement("button");
      all.type = "button";
      all.setAttribute("aria-label", "Save set");
      all.innerHTML = ICON_ALL;
      bindAction(all, async (btn) => {
        btn.disabled = true;
        const fresh = resolveItems(rec.scope) || resolved;
        try {
          if (!fresh || fresh.items.length < 2) {
            const oneItem = currentDomMedia(rec.scope);
            if (oneItem) await downloadItems([oneItem], fresh || { username: "instagram", shortcode: "media" }, "Saving…");
            return;
          }
          await downloadItems(fresh.items, fresh, `Saving ${fresh.items.length}…`);
        } finally {
          btn.disabled = false;
        }
      });
      bar.appendChild(all);
    }
  }

  function placeOverlay(rec) {
    if (!rec.scope.isConnected) {
      rec.host.remove();
      overlays.delete(rec.scope);
      return;
    }
    const anchor = mediaAnchor(rec.scope);
    const r = anchor.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) {
      rec.host.style.display = "none";
      return;
    }
    const visibleTop = Math.max(r.top, 8);
    const visibleBottom = Math.min(r.bottom, window.innerHeight - 8);
    if (visibleBottom - visibleTop < 48) {
      rec.host.style.display = "none";
      return;
    }
    rec.host.style.display = "block";
    const width = rec.shadow.querySelector(".bar")?.getBoundingClientRect().width || 40;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, r.left + 8));
    const top = Math.max(8, visibleBottom - 40);
    rec.host.style.left = `${Math.round(left)}px`;
    rec.host.style.top = `${Math.round(top)}px`;
  }

  function repositionAll() {
    overlays.forEach((rec) => placeOverlay(rec));
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

  function isPostPath() {
    return /^\/p\//.test(location.pathname);
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

  function postFrame() {
    const dialog = document.querySelector('div[role="dialog"]');
    const root = dialog || document.querySelector("main") || document.body;
    const hit = currentDomMedia(root);
    if (hit && hit.el) return hit.el;
    return null;
  }

  function ingestPageHints() {
    const code = (location.pathname.match(/\/(p|reel|reels)\/([^/?#]+)/) || [])[2];
    if (!code || byShortcode.has(code)) return;
    const items = [];
    const ogVideo = document.querySelector('meta[property="og:video"], meta[property="og:video:secure_url"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogVideo && ogVideo.content) items.push({ url: ogVideo.content, type: "video" });
    if (ogImage && ogImage.content) items.push({ url: ogImage.content, type: "image" });
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      try {
        const data = JSON.parse(scripts[i].textContent || "");
        const img = data.image;
        const vid = data.video;
        if (typeof vid === "string") items.push({ url: vid, type: "video" });
        if (typeof img === "string") items.push({ url: img, type: "image" });
        if (Array.isArray(img) && img[0]) items.push({ url: String(img[0]), type: "image" });
      } catch {
        /* ignore */
      }
    }
    if (!items.length) return;
    remember({
      id: code,
      shortcode: code,
      username: hrefUsername(document.body) || undefined,
      items: items.filter((it, idx, arr) => arr.findIndex((x) => x.url === it.url) === idx),
    });
  }

  function gridCells() {
    const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    const cells = [];
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      if (a.closest("article")) continue;
      if (a.closest('div[role="dialog"]')) continue;
      const r = a.getBoundingClientRect();
      if (r.width < 72 || r.height < 72) continue;
      if (r.bottom < 0 || r.top > window.innerHeight + 200) continue;
      const img = a.querySelector("img");
      if (!img) continue;
      cells.push(a);
    }
    return cells;
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

  function viewerDialog() {
    const list = document.querySelectorAll('div[role="dialog"]');
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const r = d.getBoundingClientRect();
      if (r.width < 280 || r.height < 280) continue;
      if (r.bottom < 80 || r.top > window.innerHeight) continue;
      const area = r.width * r.height;
      if (!best || area > best.area) best = { el: d, area };
    }
    return best ? best.el : null;
  }

  function focusedMedia() {
    const dialog = viewerDialog();
    if (dialog) {
      return biggestOnScreenMedia(dialog) || currentDomMedia(dialog);
    }
    return (
      biggestOnScreenMedia(document) ||
      currentDomMedia(document.querySelector("main") || document.body) ||
      currentDomMedia(document.body)
    );
  }

  function scan() {
    const scopes = [];
    const dialog = viewerDialog();
    const focused = dialog || isPostPath() || isReelPath();

    if (isStoryPath()) {
      const frame = storyFrame();
      if (frame) scopes.push(frame);
    } else if (focused) {
      const hit = focusedMedia();
      if (hit && hit.el) scopes.push(hit.el);
      else scopes.push(document.querySelector("main") || document.body);
    } else {
      articleRoots().forEach((a) => scopes.push(a));
      gridCells().forEach((a) => scopes.push(a));
    }

    const unique = [];
    const seen = new Set();
    for (let i = 0; i < scopes.length; i++) {
      const scope = scopes[i];
      if (!scope || seen.has(scope)) continue;
      seen.add(scope);
      unique.push(scope);
    }
    const pruned = unique.filter((el) => !unique.some((other) => other !== el && other.contains(el)));

    const live = new Set();
    for (let i = 0; i < pruned.length; i++) {
      const scope = pruned[i];
      if (!currentDomMedia(scope) && !lookupRecord(scope)) continue;
      live.add(scope);
      const rec = ensureOverlay(scope);
      renderButtons(rec);
      placeOverlay(rec);
    }

    overlays.forEach((rec, scope) => {
      if (!live.has(scope)) {
        rec.host.remove();
        overlays.delete(scope);
      }
    });
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(() => {
    scanEmbeddedJson();
    ingestPageHints();
    scan();
    const obs = new MutationObserver(() => scheduleScan());
    obs.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("scroll", repositionAll, true);
    window.addEventListener("resize", repositionAll);
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        overlays.forEach((rec) => rec.host.remove());
        overlays.clear();
        scanEmbeddedJson();
        ingestPageHints();
      }
      scan();
    }, 700);
    console.info(LOG, "ready", VERSION);
  });
})();
