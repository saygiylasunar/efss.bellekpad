// BellekPad desktop window policy, independent of Electron for Node testing.
// Blocking UI shortcuts is supplemental: webPreferences.devTools=false is
// the authoritative in-window DevTools switch.
const BLOCK = new Set(["f12", "f5"]);
export function shouldBlockWindowShortcut(input) {
  if (!input || typeof input.key !== "string" || input.type !== "keyDown") return false;
  const key = input.key.toLowerCase();
  const ctrlLike = !!(input.control || input.meta);
  if (BLOCK.has(key) && !input.alt) return true;
  if (!ctrlLike) return false;
  if (key === "r") return true; // Prevent losing a dirty unsaved draft via reload.
  return !!input.shift && ["i", "j", "c"].includes(key); // Chromium inspectors.
}
