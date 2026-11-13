import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, storedTheme } from "./App";
import { Landing } from "./Landing";
import "./index.css";

const app = window.location.pathname.startsWith("/app");
// Set before the first paint, so the app never flashes the landing's paper background.
if (app) {
  document.documentElement.dataset.app = "";
  document.documentElement.dataset.theme = storedTheme();
}

createRoot(document.getElementById("root")!).render(<StrictMode>{app ? <App /> : <Landing />}</StrictMode>);
