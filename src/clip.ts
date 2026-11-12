import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Frame } from "./recorder.ts";

// Kane thinks for a few seconds between actions, and a screencast frame only arrives on repaint.
// Each frame is shown for its real duration, but long idle gaps are squeezed so the clip stays short.
const MAX_GAP = 0.8;
const HOLD_LAST = 3;

export function makeClip(frames: Frame[], base: string) {
  if (frames.length === 0) return undefined;
  const list = frames
    .map((f, i) => {
      const next = frames[i + 1];
      const duration = next ? Math.min(next.time - f.time, MAX_GAP) : HOLD_LAST;
      return `file '${f.file}'\nduration ${Math.max(duration, 0.04).toFixed(3)}`;
    })
    .join("\n");
  // The concat demuxer ignores the last duration unless the file is listed once more.
  const concat = `${base}.frames.txt`;
  writeFileSync(concat, `${list}\nfile '${frames.at(-1)?.file}'\n`);

  const mp4 = `${base}.mp4`;
  const gif = `${base}.gif`;
  const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
  ffmpeg("-f", "concat", "-safe", "0", "-i", concat, "-vf", "fps=25,scale=1280:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4);
  ffmpeg(
    "-i", mp4,
    "-vf", "fps=8,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
    gif,
  );
  return { mp4, gif };
}
