import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { storedTheme } from "./theme";
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

const root = createRoot(document.getElementById("root")!);
const render = (Page: ComponentType) => root.render(<StrictMode><Page /></StrictMode>);
if (tryIt) void import("./Try").then(({ Try }) => render(Try));
else if (app) void import("./App").then(({ App }) => render(App));
else void import("./Landing").then(({ Landing }) => render(Landing));
