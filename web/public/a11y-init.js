// Accessibility no-flash init (DEV-028). Loaded beforeInteractive from the root
// layout so saved preferences are applied to <html> before first paint (no
// flash of un-adjusted content). Served as a static file — NOT part of the
// React tree — so React 19 never tries to reconcile an inline <script>.
//
// Kept in sync with src/components/a11y/a11y-prefs.ts (A11Y_STORAGE_KEY +
// FLAG_KEYS + the text/cursor attributes). If you add an adjustment there,
// mirror the attribute here.
(function () {
  try {
    var p = JSON.parse(localStorage.getItem("avi-a11y") || "{}");
    var d = document.documentElement;
    if (p.text) d.setAttribute("data-a11y-text", p.text);
    ["contrast", "links", "headings", "font", "spacing", "motion"].forEach(function (k) {
      if (p[k]) d.setAttribute("data-a11y-" + k, "");
    });
    if (p.cursor) d.setAttribute("data-a11y-cursor", p.cursor);
  } catch {
    /* localStorage blocked — adjustments still apply once the widget mounts */
  }
})();
