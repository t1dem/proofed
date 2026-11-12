import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Frame = { file: string; time: number };

// Only the fields of the three CDP events we listen to.
type CdpMessage = {
  method?: string;
  sessionId?: string;
  params?: {
    targetInfo?: { type: string; targetId: string };
    sessionId?: string;
    data?: string;
    metadata?: { timestamp: number };
  };
};

// Kane doesn't record video, so we attach to the same Chrome over CDP and keep every
// screencast frame with its timestamp. Frames are only sent when the page repaints,
// which is why the clip later replays them with their real durations.
export async function startRecorder(endpoint: string, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const { webSocketDebuggerUrl } = (await (await fetch(`${endpoint}/json/version`)).json()) as {
    webSocketDebuggerUrl: string;
  };
  const ws = new WebSocket(webSocketDebuggerUrl);
  const frames: Frame[] = [];
  let id = 0;
  const send = (method: string, params: object = {}, sessionId?: string) =>
    ws.send(JSON.stringify({ id: ++id, method, params, ...(sessionId && { sessionId }) }));

  const attached = new Set<string>();
  ws.onmessage = (event) => {
    const m: CdpMessage = JSON.parse(String(event.data));
    const info = m.params?.targetInfo;
    if (m.method === "Target.targetCreated" && info?.type === "page" && !attached.has(info.targetId)) {
      attached.add(info.targetId);
      send("Target.attachToTarget", { targetId: info.targetId, flatten: true });
    }
    if (m.method === "Target.attachedToTarget" && info?.type === "page") {
      send("Page.enable", {}, m.params?.sessionId);
      send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 1280, maxHeight: 800 }, m.params?.sessionId);
    }
    if (m.method === "Page.screencastFrame" && m.params?.data && m.params.metadata) {
      const file = join(outDir, `${String(frames.length).padStart(5, "0")}.jpg`);
      writeFileSync(file, Buffer.from(m.params.data, "base64"));
      frames.push({ file, time: m.params.metadata.timestamp });
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId }, m.sessionId);
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      send("Target.setDiscoverTargets", { discover: true });
      resolve();
    };
    ws.onerror = () => reject(new Error("Recorder could not connect to Chrome"));
  });

  return {
    frames,
    stop: () => {
      ws.close();
      return frames;
    },
  };
}
