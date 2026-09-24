/* ============================================================
   VP Education Group: language switching

   The English lives in index.html. translations.js holds every
   other language, keyed by the exact English string. Switching
   walks the page and swaps each piece of text; switching back to
   English restores the cached original.

   Layout never moves on switch: every element marked .i18n-w or
   .i18n-h gets invisible "ghost" copies of the same text in every
   other language, so its box is already as wide (or tall) as the
   longest language (see styles.css).

   The reviews are built by script.js, which uses the helpers this
   file exposes on window.VB_I18N.
   ============================================================ */

const LANGS = {
  en: { tag: "en",    flag: "🇺🇸", name: "English" },
  zh: { tag: "zh-CN", flag: "🇨🇳", name: "中文" },
  es: { tag: "es",    flag: "🇪🇸", name: "Español" },
  fr: { tag: "fr",    flag: "🇫🇷", name: "Français" },
  ko: { tag: "ko",    flag: "🇰🇷", name: "한국어" }
};
const LANG_CODES = Object.keys(LANGS);
const STORAGE_KEY = "vb-lang";

const normalize = (s) => s.replace(/\s+/g, " ").trim();

/* English key -> that language's string (English itself, or a fallback). */
function translate(key, lang) {
  if (lang === "en") return key;
  const entry = UI[key];
  return (entry && entry[lang]) || key;
}

function currentLang() {
  return document.documentElement.dataset.lang || "en";
}

/* Invisible copies of the text in every other language, so the host's
   box is sized for the longest one. `variants` is [{ lang, text }];
   `visible` is the text already showing, which needs no ghost. */
function setGhosts(host, variants, visible) {
  host.querySelectorAll(":scope > .i18n-ghost").forEach((g) => g.remove());
  const seen = new Set([visible]);
  for (const v of variants) {
    if (!v.text || seen.has(v.text)) continue;
    seen.add(v.text);
    const ghost = document.createElement("span");
    ghost.className = "i18n-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("data-no-translate", "");
    ghost.lang = LANGS[v.lang].tag;
    ghost.textContent = v.text;
    host.appendChild(ghost);
  }
}

function ghostsFor(key, lang) {
  return LANG_CODES.filter((l) => l !== lang).map((l) => ({ lang: l, text: translate(key, l) }));
}

/* ------------------------------------------------------------
   Swap the page between languages
   ------------------------------------------------------------ */
const TRANSLATABLE_ATTRS = ["aria-label", "title", "alt", "placeholder", "content"];
const originalText = new Map();

/* Elements script.js owns (the reviews), the language menu, and the
   ghosts themselves are left alone. */
function isBlocked(el) {
  for (; el; el = el.parentElement) {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return true;
    if (el.hasAttribute("data-no-translate")) return true;
  }
  return false;
}

function collectTextNodes() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return isBlocked(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

function applyLanguage(lang) {
  if (!LANGS[lang]) lang = "en";

  for (const node of collectTextNodes()) {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const original = originalText.get(node);
    const key = normalize(original);
    const known = Object.prototype.hasOwnProperty.call(UI, key);
    node.nodeValue = lang === "en" || !known ? original : translate(key, lang);

    const host = node.parentElement.closest(".i18n-w, .i18n-h");
    if (host) setGhosts(host, known ? ghostsFor(key, lang) : [], normalize(node.nodeValue));
  }

  for (const el of document.querySelectorAll("body *, head meta[name='description']")) {
    if (isBlocked(el)) continue;
    for (const attr of TRANSLATABLE_ATTRS) {
      if (!el.hasAttribute(attr)) continue;
      const cacheKey = "i18nOrig" + attr.replace(/(^|-)([a-z])/g, (m, d, c) => c.toUpperCase());
      if (el.dataset[cacheKey] === undefined) el.dataset[cacheKey] = el.getAttribute(attr);
      el.setAttribute(attr, translate(normalize(el.dataset[cacheKey]), lang));
    }
  }

  const root = document.documentElement;
  if (!root.dataset.titleEn) root.dataset.titleEn = document.title;
  document.title = translate(root.dataset.titleEn, lang);

  root.lang = LANGS[lang].tag;
  root.dataset.lang = lang;

  updateMenu(lang);

  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (e) {
    /* private browsing: the choice just will not persist */
  }

  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

/* ------------------------------------------------------------
   The language menu
   ------------------------------------------------------------ */
const menu = document.getElementById("lang-menu");
const menuButton = document.getElementById("lang-toggle");
const menuList = document.getElementById("lang-list");
const options = [...menuList.querySelectorAll("[role='option']")];

function updateMenu(lang) {
  const label = translate("Language", lang);
  menuButton.querySelector(".lang-flag").textContent = LANGS[lang].flag;
  menuButton.querySelectorAll(".lang-label > span").forEach((s) => {
    s.classList.toggle("current", s.dataset.lang === lang);
  });
  menuButton.setAttribute("aria-label", label + ": " + LANGS[lang].name);
  menuList.setAttribute("aria-label", label);
  options.forEach((o) => o.setAttribute("aria-selected", String(o.dataset.lang === lang)));
}

function openMenu() {
  menuList.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
  (options.find((o) => o.dataset.lang === currentLang()) || options[0]).focus();
}

function closeMenu(refocus) {
  if (menuList.hidden) return;
  menuList.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
  if (refocus) menuButton.focus();
}

menuButton.addEventListener("click", () => (menuList.hidden ? openMenu() : closeMenu(false)));
menuButton.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    openMenu();
  }
});

options.forEach((o) => {
  o.addEventListener("click", () => {
    applyLanguage(o.dataset.lang);
    closeMenu(true);
  });
});

menuList.addEventListener("keydown", (e) => {
  const i = options.indexOf(document.activeElement);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    options[(i + 1) % options.length].focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    options[(i - 1 + options.length) % options.length].focus();
  } else if (e.key === "Home") {
    e.preventDefault();
    options[0].focus();
  } else if (e.key === "End") {
    e.preventDefault();
    options[options.length - 1].focus();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (i >= 0) options[i].click();
  } else if (e.key === "Escape") {
    closeMenu(true);
  } else if (e.key === "Tab") {
    closeMenu(false);
  }
});

document.addEventListener("click", (e) => {
  if (!menu.contains(e.target)) closeMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu(true);
});

/* ------------------------------------------------------------
   Pick the starting language: saved choice, else the browser's
   language if we have it, else English.
   ------------------------------------------------------------ */
function startingLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS[saved]) return saved;
  } catch (e) {
    /* storage blocked */
  }
  for (const tag of navigator.languages || [navigator.language || ""]) {
    const code = tag.toLowerCase().slice(0, 2);
    if (LANGS[code]) return code;
  }
  return "en";
}

window.VB_I18N = { LANGS, LANG_CODES, translate, currentLang, setGhosts, ghostsFor, applyLanguage };

applyLanguage(startingLang());
