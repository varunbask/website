/* Same theme the visitor chose on the main site: light unless dark was picked. */
(function () {
  var theme = null;
  try { theme = localStorage.getItem("vb-theme"); } catch (e) { /* storage blocked */ }
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
})();
