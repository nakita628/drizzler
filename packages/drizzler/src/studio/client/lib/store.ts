import { create } from "zustand";
import { loadString, saveString } from "./storage.js";

export type Theme = "light" | "dark";

/** Whether the page is following the schema file: the server's event stream is open, not yet, or lost. */
export type Connection = "connecting" | "live" | "offline";

const THEME_KEY = "drizzler-studio:theme";
const SIDEBAR_KEY = "drizzler-studio:sidebar";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.setProperty("color-scheme", theme);
}

// The scheme the operating system asks for, light where the browser cannot say.
function systemTheme(): Theme {
  const prefersDark =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function initialTheme(): Theme {
  const stored = loadString(THEME_KEY);
  const theme: Theme = stored === "light" || stored === "dark" ? stored : systemTheme();
  applyTheme(theme);
  return theme;
}

type UiStore = {
  readonly theme: Theme;
  readonly connection: Connection;
  readonly sidebarOpen: boolean;
  readonly paletteOpen: boolean;
  readonly toggleTheme: () => void;
  readonly setConnection: (connection: Connection) => void;
  readonly toggleSidebar: () => void;
  readonly openPalette: () => void;
  readonly closePalette: () => void;
};

export const useUiStore = create<UiStore>()((set, get) => ({
  theme: initialTheme(),
  connection: "connecting",
  sidebarOpen: loadString(SIDEBAR_KEY) !== "closed",
  // The palette is a moment, not a setting: it opens on the shortcut and is gone again.
  paletteOpen: false,
  toggleTheme() {
    const theme = get().theme === "dark" ? "light" : "dark";
    saveString(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  setConnection(connection) {
    set({ connection });
  },
  toggleSidebar() {
    const sidebarOpen = !get().sidebarOpen;
    saveString(SIDEBAR_KEY, sidebarOpen ? "open" : "closed");
    set({ sidebarOpen });
  },
  openPalette() {
    set({ paletteOpen: true });
  },
  closePalette() {
    set({ paletteOpen: false });
  },
}));
