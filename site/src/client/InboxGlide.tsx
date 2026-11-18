import { Component, createRef, type ReactNode } from "react";

// Rows and group headings glide to where a new answer puts them (a pull request that turns
// "fixing" moves into its group) instead of jumping: the FLIP technique, keyed by `data-glide`.
// A class for getSnapshotBeforeUpdate: where everything is on screen just before React changes the
// DOM, mid-glide included, so an answer that lands while rows are still moving carries them on from
// where they are instead of restarting them from a spot they've already left.
export class Glide extends Component<{ children: ReactNode }> {
  box = createRef<HTMLDivElement>();
  // Where each element sits in the layout, without its glide, in page coordinates (so scrolling
  // between two answers doesn't read as a move).
  placed = new Map<string, number>();

  els = () => [...(this.box.current?.querySelectorAll<HTMLElement>("[data-glide]") ?? [])];
  onScreen = (el: HTMLElement) => el.getBoundingClientRect().top + scrollY;

  componentDidMount() {
    for (const el of this.els()) this.placed.set(el.dataset.glide!, this.onScreen(el));
  }

  getSnapshotBeforeUpdate() {
    return new Map(this.els().map((el) => [el.dataset.glide!, this.onScreen(el)]));
  }

  componentDidUpdate(_props: unknown, _state: unknown, seen: Map<string, number>) {
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const placed = new Map<string, number>();
    for (const el of this.els()) {
      const key = el.dataset.glide!;
      const gliding = el.getAnimations().filter((a) => a.id === "glide");
      const shift = gliding.length > 0 ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 : 0;
      const top = this.onScreen(el) - shift;
      placed.set(key, top);
      const was = this.placed.get(key);
      if (calm || this.placed.size === 0) continue;
      if (was === undefined) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
        continue;
      }
      // Not moved by this answer: a glide under way just carries on.
      if (Math.abs(was - top) <= 1) continue;
      const from = seen.get(key) ?? was;
      for (const a of gliding) a.cancel();
      const glide = el.animate([{ transform: `translateY(${from - top}px)` }, { transform: "none" }], {
        id: "glide",
        // Speeds up, then settles: a row that crosses the list doesn't leap off on the first frame.
        duration: 460,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      });
      // A row that passes over others travels above them on the page's own background, so their
      // text doesn't show through it.
      if (Math.abs(from - top) > el.offsetHeight) {
        const lift = { zIndex: "20", transition: "none", ...(getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)" && { backgroundColor: "var(--color-bg)" }) };
        Object.assign(el.style, lift);
        glide.onfinish = glide.oncancel = () => {
          for (const prop of Object.keys(lift)) el.style.removeProperty(prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
        };
      }
    }
    this.placed = placed;
  }

  // Its own stacking context: a lifted row stays above the other rows but never above what lies
  // outside the list, such as the filter menu open over it or the bars on a phone.
  render() {
    return (
      <div ref={this.box} className="isolate">
        {this.props.children}
      </div>
    );
  }
}
