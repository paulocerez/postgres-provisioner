/*
 * Runs synchronously in <head>, before the bundle and before first paint, so
 * the page never flashes light before React can apply the stored theme. Kept in
 * /public rather than inline because the server sends `script-src 'self'`.
 *
 * The storage key and value shape are mirrored by src/theme.tsx.
 */
(function () {
  var stored;
  try {
    // Safari in private mode throws on localStorage access rather than
    // returning null, which would leave the app unrendered.
    stored = window.localStorage.getItem('theme');
  } catch (_) {
    stored = null;
  }
  var dark =
    stored === 'dark' ||
    ((stored === 'system' || stored === null) &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
