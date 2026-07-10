import { useEffect, useState } from "react";
import { getPref, setPref } from "@/lib/storage";

export type Theme = "light" | "dark" | "contrast";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    getPref<Theme>("theme").then((t) => {
      if (t) setThemeState(t);
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    root.classList.remove("dark", "contrast");
    if (theme === "dark") root.classList.add("dark");
    if (theme === "contrast") root.classList.add("contrast");
    setPref("theme", theme);
  }, [theme, hydrated]);

  return { theme, setTheme: setThemeState };
}
