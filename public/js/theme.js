// Light/dark mode. Loaded in <head> without defer so the page opens in the right theme, without a flash.
// With no saved choice it follows the device. The choice stays in this browser only.
(() => {
  'use strict';
  const root = document.documentElement;
  const KEY = 'theme';
  const deviceDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
  let chosen = null;
  try {
    chosen = localStorage.getItem(KEY);
  } catch {
    /* no storage */
  }
  const apply = () => {
    const now = chosen === 'light' || chosen === 'dark' ? chosen : deviceDark() ? 'dark' : 'light';
    root.dataset.themeNow = now;
    document.querySelectorAll('.theme-toggle').forEach((b) => {
      b.setAttribute('aria-label', now === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      b.title = b.getAttribute('aria-label');
    });
  };
  apply();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('.theme-toggle').forEach((b) =>
      b.addEventListener('click', () => {
        chosen = root.dataset.themeNow === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem(KEY, chosen);
        } catch {
          /* no storage */
        }
        apply();
      }),
    );
  });
})();
