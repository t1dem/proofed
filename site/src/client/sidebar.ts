import { useCallback, useEffect, useState } from "react";
import { typing } from "./Inbox";

// The sidebar's width and whether it's hidden, kept per browser like the theme.
const KEY = "proofed-sidebar";
export const SIDEBAR = { min: 200, max: 360, base: 240 };
// Dragged this far past the narrowest width, the sidebar gives up and hides.
export const SNAP = SIDEBAR.min - 64;
// The page always keeps this much room next to the sidebar.
const PAGE_ROOM = 560;

type Stored = { width: number; hidden: boolean };

function stored(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Stored>;
    return { width: typeof value.width === "number" ? value.width : SIDEBAR.base, hidden: value.hidden === true };
  } catch {
    return { width: SIDEBAR.base, hidden: false };
  }
}

function store(value: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the sidebar stays as set for this page.
  }
}

export const clampWidth = (width: number) => Math.round(Math.min(Math.max(width, SIDEBAR.min), Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, innerWidth - PAGE_ROOM))));

export function useSidebar() {
  const [state, setState] = useState(stored);
  // A narrower window narrows the sidebar it shows, without forgetting the width that was chosen.
  const [, setViewport] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport(innerWidth);
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);
  useEffect(() => store(state), [state]);

  const toggle = useCallback(() => setState((s) => ({ ...s, hidden: !s.hidden })), []);
  const setWidth = useCallback((width: number) => setState({ width: clampWidth(width), hidden: false }), []);
  // A drag that hid it hands back the width it started at, so it comes back as it was.
  const hide = useCallback((width?: number) => setState((s) => ({ width: width ?? s.width, hidden: true })), []);

  // ⌘\ (Ctrl+\) anywhere but a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "\\" && (e.metaKey || e.ctrlKey) && !typing(e.target)) {
        e.preventDefault();
        toggle();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [toggle]);

  return { width: clampWidth(state.width), hidden: state.hidden, toggle, setWidth, hide };
}
