import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { storedTheme } from "./theme";
import "./index.css";

const path = window.location.pathname;
// "Break it yourself" wears the app's look: it shows the same run and report views.
const tryIt = path === "/try" || path.startsWith("/try/");
const app = path.startsWith("/app") || tryIt;
// Set before the first paint, so the app never flashes the landing's paper background.
// The landing is dark too: its body takes the page's colour before the first paint.
if (!app) document.documentElement.dataset.landing = "";
if (app) {
  document.documentElement.dataset.app = "";
  document.documentElement.dataset.theme = storedTheme();
  // The dashboard's sidebar and inset panel; "Break it yourself" is one plain page.
  if (!tryIt) document.documentElement.dataset.shell = "";
}

// Inside the landing's hero frame, scrollIntoView would scroll the landing too: keep it to the app's own panes.
if (app && window.top !== window.self) {
  document.documentElement.dataset.embed = "";
  Element.prototype.scrollIntoView = function (this: Element) {
    for (let box = this.parentElement; box; box = box.parentElement) {
      const { overflowY } = getComputedStyle(box);
      const scrolls =
        box === document.scrollingElement || ((overflowY === "auto" || overflowY === "scroll") && box.scrollHeight > box.clientHeight);
      if (!scrolls) continue;
      const el = this.getBoundingClientRect();
      const view = box === document.scrollingElement ? { top: 0, bottom: innerHeight } : box.getBoundingClientRect();
      if (el.top < view.top) box.scrollTop -= view.top - el.top;
      else if (el.bottom > view.bottom) box.scrollTop += Math.min(el.bottom - view.bottom, el.top - view.top);
      return;
    }
  };
}

const root = createRoot(document.getElementById("root")!);
const render = (Page: ComponentType) => root.render(<StrictMode><Page /></StrictMode>);
if (tryIt) void import("./Try").then(({ Try }) => render(Try));
else if (app) void import("./App").then(({ App }) => render(App));
else void import("./Landing").then(({ Landing }) => render(Landing));
