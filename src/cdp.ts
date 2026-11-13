// A minimal Chrome DevTools Protocol client over the browser websocket.
// Only the events Proofed listens to are typed.

export type TargetInfo = { type: string; targetId: string };
export type ScreencastMetadata = { timestamp: number; deviceWidth: number; deviceHeight: number };
export type ExceptionDetails = { text: string; exception?: { description?: string; value?: unknown } };

type Events = {
  "Target.targetCreated": { targetInfo: TargetInfo };
  "Target.attachedToTarget": { sessionId: string; targetInfo: TargetInfo };
  "Page.screencastFrame": { data: string; sessionId: number; metadata: ScreencastMetadata };
  "Runtime.bindingCalled": { name: string; payload: string };
  "Runtime.exceptionThrown": { exceptionDetails: ExceptionDetails };
  "Page.loadEventFired": { timestamp: number };
};

type Message = {
  id?: number;
  method?: string;
  params?: unknown;
  sessionId?: string;
  result?: unknown;
  error?: { message: string };
};

export type Cdp = Awaited<ReturnType<typeof connectCdp>>;

export async function connectCdp(endpoint: string) {
  const { webSocketDebuggerUrl } = (await (await fetch(`${endpoint}/json/version`)).json()) as {
    webSocketDebuggerUrl: string;
  };
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("Could not connect to Chrome over CDP"));
  });

  let lastId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Map<string, Set<(params: never, sessionId?: string) => void>>();

  ws.onmessage = (event) => {
    const m: Message = JSON.parse(String(event.data));
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p?.reject(new Error(m.error.message));
      else p?.resolve(m.result);
    } else if (m.method) {
      for (const fn of listeners.get(m.method) ?? []) fn(m.params as never, m.sessionId);
    }
  };
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error("CDP connection closed"));
    pending.clear();
  };

  return {
    send<T = unknown>(method: string, params: object = {}, sessionId?: string): Promise<T> {
      const id = ++lastId;
      ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
      return new Promise<T>((resolve, reject) =>
        pending.set(id, { resolve: (v) => resolve(v as T), reject }),
      );
    },
    on<K extends keyof Events>(method: K, fn: (params: Events[K], sessionId?: string) => void) {
      const set = listeners.get(method) ?? new Set();
      set.add(fn as (params: never, sessionId?: string) => void);
      listeners.set(method, set);
    },
    close: () => ws.close(),
  };
}
