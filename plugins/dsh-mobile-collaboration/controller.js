import { phoneViewport } from './phone.js';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { Wire } from './wire.js';

export class Controller {
  state = { phones: [], selected: null, connected: false, error: '', suspended: false, joinUrl: '' };
  subscribers = new Set(); frames = new Set();
  pendingInputs = new Set();
  constructor(remote, mobile, label) { this.remote = remote; this.mobile = mobile; this.label = label; }
  getSnapshot = () => this.state;
  subscribe = fn => { this.subscribers.add(fn); return () => this.subscribers.delete(fn); };
  update(patch) {
    this.state = { ...this.state, ...patch };
    if (this.mobile) { document.documentElement.dataset.mobileCollabStatus = this.state.connected ? 'connected' : 'disconnected'; document.documentElement.dataset.mobileCollabError = this.state.error; }
    for (const fn of this.subscribers) fn();
  }
  onFrame(fn) { this.frames.add(fn); return () => this.frames.delete(fn); }
  send(data) {
    if (!this.handle) throw new Error('协同连接尚未就绪');
    if (data.type === 'command' && data.command.action === 'input') {
      data.command.requestId = crypto.randomUUID(); this.pendingInputs.add(data.command.requestId);
    }
    this.wire.send(data);
  }
  presence() { if (this.handle) this.send({ type: 'presence', visible: !document.hidden, viewport: phoneViewport() }); }
  watch(id) {
    this.send({ type: 'watch', phone: id });
    this.pendingInputs.clear();
    for (const fn of this.frames) fn({ type: 'stop' });
    this.update({ selected: id, error: '', suspended: id === null });
  }
  start() {
    this.wanted = true; clearTimeout(this.retry);
    if (this.abort) return;
    const abort = new AbortController(); this.abort = abort;
    this.handle = this.remote.mobileCollab.connect(abort.signal);
    this.wire = new Wire(json => this.handle.send({ json }), data => this.receive(data), { encode: text => gzipSync(strToU8(text)), decode: bytes => strFromU8(gunzipSync(bytes)) });
    this.send({ type: 'hello', mobile: this.mobile, label: this.label, visible: !document.hidden, viewport: phoneViewport() });
    this.heartbeat = setInterval(() => { if (this.handle) this.send({ type: 'ping' }); }, 15000);
    void (async () => {
      let reconnect = false;
      try {
        for await (const raw of this.handle) {
          if (this.abort !== abort) return;
          this.wire.receive(raw.json);
        }
        if (!abort.signal.aborted) throw new Error('协同连接已断开');
      } catch (error) {
        reconnect = /connect|断开|transport|socket|网络|timeout|closed|ECONN/i.test(error.message);
        if (!abort.signal.aborted) console.error('手机协同连接失败：', error.message);
        if (!abort.signal.aborted) this.update({ connected: false, selected: null, error: error.message, suspended: true });
      } finally {
        if (this.abort === abort) {
          this.stop(false, true);
          if (reconnect && this.wanted) this.retry = setTimeout(() => this.start(), 1500);
        }
      }
    })();
  }
  receive(data) {
    if (data.type === 'input-state') this.pendingInputs.delete(data.requestId);
    if (data.type === 'ready') this.update({ connected: true, error: '', suspended: false, joinUrl: data.joinUrl });
    if (data.type === 'phones') this.update({ phones: data.phones });
    if (data.type === 'notice') { this.pendingInputs.clear(); this.update({ error: data.text }); }
    if (data.type === 'offline') this.update({ phones: [], selected: null, error: '手机已断开，重新打开手机网页后可继续', suspended: false });
    if (data.type === 'stopped') this.update({ selected: null, error: '手机已结束协同', suspended: true });
    for (const fn of this.frames) fn(data);
  }
  stop(clear = true, reconnecting = false) {
    if (!reconnecting) { this.wanted = false; clearTimeout(this.retry); }
    clearInterval(this.heartbeat); this.abort?.abort(); this.handle?.dispose(); this.abort = null; this.handle = null;
    this.pendingInputs.clear();
    for (const fn of this.frames) fn({ type: 'stop' });
    this.update({ phones: [], connected: false, selected: null, ...(clear ? { error: '', suspended: false } : {}) });
  }
}
