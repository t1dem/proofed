import { ChevronsLeftRight, Maximize, Minimize, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { RunScenario } from "../worker/runs";
import { focus, iconButton, plain } from "./ui";

export type Step = NonNullable<RunScenario["steps"]>[number];
// Play the clip from `at`; `n` makes a second click on the same step a new request.
export type Seek = { at: number; n: number };

const clock = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// The recording with its own controls. Its track marks where each of Kane's steps starts (the
// broken one in red), so a step leads to its moment in the clip and the clip lights up its step.
// Until it plays, the poster is the still: what the run ended on.
export function Recording({ clip, steps, seek, onTime }: { clip: NonNullable<RunScenario["clip"]>; steps?: Step[]; seek?: Seek; onTime?: (t: number) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [length, setLength] = useState<number>();
  const [time, setTime] = useState(0);
  const still = clip.jpg ?? clip.gif;
  const box = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);

  const playFrom = (at?: number) => {
    const v = video.current;
    if (!v) return;
    if (at !== undefined) v.currentTime = at;
    else if (v.ended) v.currentTime = 0;
    v.play().catch(() => {});
  };

  const toggle = () => (video.current?.paused === false ? video.current.pause() : playFrom());

  // Full screen in this tab: the clip with its controls. An iPhone can only put a <video> itself full
  // screen, with its own controls.
  useEffect(() => {
    const sync = () => setFull(!!box.current && document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) return void document.exitFullscreen();
    if (box.current?.requestFullscreen) return void box.current.requestFullscreen().catch(() => {});
    (video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
  };

  // A step picked below the clip.
  useEffect(() => {
    if (seek) playFrom(seek.at);
  }, [seek]);

  // The track follows every frame while playing; timeupdate alone moves it in visible jumps.
  const paint = () => {
    const v = video.current;
    if (v && fill.current && v.duration) fill.current.style.width = `${(v.currentTime / v.duration) * 100}%`;
  };
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // A page that crashed on load has no recording, only a screenshot of it (src/targets/precheck.ts).
  if (!clip.mp4) {
    const screenshot = !clip.gif;
    return still ? (
      <>
        <img src={still} alt={screenshot ? "What a user sees on opening the page" : "Where Kane's run ended"} className="block w-full" />
        {screenshot && <p className="border-t border-edge px-3.5 py-2 text-[13px] text-dim">What a user sees on opening the page</p>}
      </>
    ) : null;
  }

  const timeAt = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1) * (length ?? 0);
  };
  const scrub = (e: PointerEvent<HTMLElement>) => {
    if (video.current && length) video.current.currentTime = timeAt(e);
  };

  return (
    <div ref={box} className={`flex flex-col bg-bg ${full ? "h-full" : ""}`}>
      <div className={`relative bg-black ${full ? "min-h-0 flex-1" : ""}`}>
        <video
          ref={video}
          src={clip.mp4}
          poster={still}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setTime(t);
            onTime?.(t);
            paint();
          }}
          onClick={toggle}
          className={`block w-full cursor-pointer ${full ? "h-full object-contain" : "aspect-video"}`}
        />
        {!playing && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-14 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm">
              <Play size={22} fill="currentColor" className="ml-0.5" />
            </span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-edge px-1.5 py-1.5">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} className={iconButton}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <div
          className="relative mx-1 h-7 min-w-0 flex-1 cursor-pointer touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e);
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && scrub(e)}
        >
          <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-edge" />
          <span ref={fill} className="absolute left-0 top-1/2 h-1 w-0 -translate-y-1/2 rounded-full bg-dim" />
          {length &&
            steps?.map((step, i) =>
              step.at === undefined ? null : (
                <button
                  key={i}
                  type="button"
                  title={plain(step.remark)}
                  aria-label={`Play from step ${i + 1}: ${plain(step.remark)}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => playFrom(step.at)}
                  style={{ left: `${(step.at / length) * 100}%` }}
                  className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel transition-transform hover:scale-150 ${step.failed ? "bg-bad" : "bg-faint"} ${focus}`}
                />
              ),
            )}
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-faint">
          {clock(time)} / {clock(length)}
        </span>
        <button type="button" onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen" : "Full screen"} className={iconButton}>
          {full ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
      </div>
    </div>
  );
}

// The broken run's last frame over the passing one's, with a handle that wipes between them.
export function Compare({ before, after }: { before: string; after: string }) {
  const [x, setX] = useState(50);
  const move = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setX(Math.min(Math.max(((e.clientX - box.left) / box.width) * 100, 0), 100));
  };
  const chip = "pointer-events-none absolute top-3 rounded bg-black/65 px-1.5 py-0.5 text-[12px] font-medium text-white";
  return (
    <div
      className="relative cursor-ew-resize touch-pan-y select-none overflow-hidden"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && move(e)}
    >
      <img src={after} alt="After the fix: where Kane's run ended" draggable={false} className="block aspect-video w-full object-cover" />
      <img
        src={before}
        alt="Before the fix: where Kane's run ended"
        draggable={false}
        className="absolute inset-0 size-full object-cover"
        style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}
      />
      <span className={`${chip} left-3`}>Before</span>
      <span className={`${chip} right-3`}>After</span>
      <span className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.2)]" style={{ left: `${x}%` }} />
      <span
        role="slider"
        tabIndex={0}
        aria-label="Wipe between before and after"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(x)}
        onKeyDown={(e) => {
          const by = e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0;
          if (!by) return;
          e.preventDefault();
          setX((v) => Math.min(Math.max(v + by, 0), 100));
        }}
        style={{ left: `${x}%` }}
        className={`absolute top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-lg shadow-black/30 ${focus}`}
      >
        <ChevronsLeftRight size={16} />
      </span>
    </div>
  );
}
