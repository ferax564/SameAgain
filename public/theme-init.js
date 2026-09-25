// Applies the saved (or system) colour theme before first paint to avoid a light flash.
(function () {
  var dark = false;
  try {
    var saved = localStorage.getItem('same-again:theme');
    dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    dark = false;
  }
  if (dark) document.documentElement.classList.add('dark');
})();
