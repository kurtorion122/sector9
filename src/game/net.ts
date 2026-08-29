import { Msg } from "./defs";

type Handler = (m: Msg) => void;

export function wsUrl() {
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  return `${proto}${location.host}/ws`;
}

export class NetClient {
  ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private queue: Msg[] = [];
  connected = false;
  closedByUs = false;

  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;

  connect() {
    try {
      this.ws = new WebSocket(wsUrl());
    } catch {
      this.ws = null;
      window.setTimeout(() => this.onClose && this.onClose(), 0);
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      for (const m of this.queue) this.rawSend(m);
      this.queue = [];
      if (this.onOpen) this.onOpen();
    };
    this.ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as Msg;
        const set = this.handlers.get(m.t);
        if (set) for (const h of set) h(m);
        const any = this.handlers.get("*");
        if (any) for (const h of any) h(m);
      } catch {
        /* ignore */
      }
    };
    this.ws.onclose = () => {
      this.connected = false;
      if (this.onClose) this.onClose();
    };
    this.ws.onerror = () => {
      /* onclose will follow */
    };
  }

  on(type: string, cb: Handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(cb);
    return () => this.handlers.get(type)?.delete(cb);
  }

  send(m: Msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.rawSend(m);
    else this.queue.push(m);
  }

  private rawSend(m: Msg) {
    try {
      this.ws!.send(JSON.stringify(m));
    } catch {
      /* ignore */
    }
  }

  close() {
    this.closedByUs = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.connected = false;
  }
}
