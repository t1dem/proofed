import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, storedTheme } from "./App";
import { Landing } from "./Landing";
import { Try } from "./Try";
import "./index.css";

const path = window.location.pathname;
// "Break it yourself" wears the app's look: it shows the same run and report views.
const tryIt = path === "/try" || path.startsWith("/try/");
const app = path.startsWith("/app") || tryIt;
// Set before the first paint, so the app never flashes the landing's paper background.
if (app) {
  document.documentElement.dataset.app = "";
  document.documentElement.dataset.theme = storedTheme();
}

createRoot(document.getElementById("root")!).render(<StrictMode>{tryIt ? <Try /> : app ? <App /> : <Landing />}</StrictMode>);
