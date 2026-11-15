export class Net {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.handlers = new Map();
    this.closeHandlers = [];
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  onClose(fn) {
    this.closeHandlers.push(fn);
  }

  emit(type, payload) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(payload);
  }

  connect() {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      return this.pendingConnect || Promise.reject(new Error('连接中'));
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.pendingConnect = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          this.ws.close();
        } catch {}
        reject(new Error('连接超时'));
      }, 7000);

      this.ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connected = true;
        this.emit('open', {});
        resolve();
      };
      this.ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connected = false;
        reject(new Error('网络连接失败'));
      };
      this.ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.pendingConnect = null;
        if (settled) {
          for (const fn of this.closeHandlers) fn(wasConnected);
        }
      };
      this.ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        this.emit('message', msg);
        if (msg && msg.t) this.emit(msg.t, msg);
      };
    });
    return this.pendingConnect;
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.connected = false;
  }
}
