import { randomUUID } from 'node:crypto';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Wire } from './wire.js';

const viewport = z.object({ width: z.number().positive().max(10000), height: z.number().positive().max(10000), layoutWidth: z.number().positive().max(10000), layoutHeight: z.number().positive().max(10000), left: z.number(), top: z.number(), dpr: z.number().positive() }).strict();
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), id: z.number().int(), x: z.number(), y: z.number() }),
  z.object({ action: z.literal('hold'), id: z.number().int(), pressId: z.string().uuid(), phase: z.enum(['start', 'move', 'end', 'cancel']), x: z.number().finite().optional(), y: z.number().finite().optional() }),
  z.object({ action: z.literal('scroll'), id: z.number().int(), dx: z.number(), dy: z.number() }),
  z.object({ action: z.literal('input'), requestId: z.string().uuid(), id: z.number().int(), expected: z.string().max(100000), text: z.string().max(100000) }),
  z.object({ action: z.literal('blur'), id: z.number().int() }),
  z.object({ action: z.literal('file'), name: z.string().max(255), mime: z.string().max(100), data: z.string().max(28 * 1024 * 1024) }),
  z.object({ action: z.literal('select'), id: z.number().int(), value: z.string().max(10000) }),
  z.object({ action: z.literal('key'), id: z.number().int(), key: z.enum(['Escape', 'Tab']) }),
]);
const message = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), mobile: z.boolean(), label: z.string().max(80), visible: z.boolean(), viewport }),
  z.object({ type: z.literal('presence'), visible: z.boolean(), viewport }),
  z.object({ type: z.literal('watch'), phone: z.string().uuid().nullable() }),
  z.object({ type: z.literal('event'), event: z.object({ type: z.number(), timestamp: z.number() }).passthrough() }),
  z.object({ type: z.literal('command'), command }),
  z.object({ type: z.literal('notice'), text: z.string().max(300) }),
  z.object({ type: z.literal('input-state'), requestId: z.string().uuid(), id: z.number().int(), text: z.string().max(100000) }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('ping') }),
]);

export default class MobileCollaboration extends TypertRemoteService {
  static inject = ['typert'];
  peers = new Map();
  constructor(ctx, config) { super(ctx, 'mobileCollab'); this.joinUrl = new URL(config.joinUrl).href; }

  send(peer, data) {
    if (!peer || peer.closed) return;
    peer.wire.send(data);
  }
  enqueue(peer, json) {
    if (peer.closed) return;
    const item = { json };
    peer.bytes += item.json.length;
    if (peer.bytes > 16 * 1024 * 1024) { peer.failure = new Error('协同连接处理速度不足，请重新连接'); peer.closed = true; }
    else peer.queue.push(item);
    peer.wake?.();
  }
  roster() {
    const phones = [...this.peers.values()].filter(p => p.info?.mobile && !p.closed).map(p => ({ id: p.id, ...p.info }));
    for (const peer of this.peers.values()) if (peer.info && !peer.info.mobile) this.send(peer, { type: 'phones', phones });
  }
  unwatch(peer) {
    const phone = this.peers.get(peer.watching);
    if (phone && peer.hold) this.send(phone, { type: 'command', command: { ...peer.hold, phase: 'cancel' } });
    peer.hold = null;
    peer.watching = null;
    if (phone) {
      phone.watchers.delete(peer.id);
      if (!phone.watchers.size) this.send(phone, { type: 'stop' });
    }
  }
  receive(peer, raw) {
    const data = message.parse(raw);
    peer.seen = Date.now();
    if (data.type === 'hello') {
      if (peer.info) throw new Error('协同设备重复登记');
      peer.info = { mobile: data.mobile, label: data.label, visible: data.visible, viewport: data.viewport };
      this.send(peer, { type: 'ready', id: peer.id, joinUrl: this.joinUrl });
      this.roster(); return;
    }
    if (!peer.info) throw new Error('协同设备尚未登记');
    if (data.type === 'ping') return;
    if (data.type === 'presence') {
      peer.info.visible = data.visible; peer.info.viewport = data.viewport;
      this.roster();
      for (const id of peer.watchers) this.send(this.peers.get(id), { type: 'viewport', viewport: data.viewport, visible: data.visible });
    } else if (data.type === 'watch') {
      if (peer.info.mobile) throw new Error('手机连接不能控制其他设备');
      this.unwatch(peer);
      if (data.phone === null) return;
      const phone = this.peers.get(data.phone);
      if (!phone?.info?.mobile || phone.closed) { this.send(peer, { type: 'offline' }); this.roster(); return; }
      peer.watching = phone.id; phone.watchers.add(peer.id);
      for (const id of phone.watchers) this.send(this.peers.get(id), { type: 'reset', viewport: phone.info.viewport, visible: phone.info.visible });
      this.send(phone, { type: 'start' });
    } else if (data.type === 'event') {
      if (!peer.info.mobile) throw new Error('画面来源必须是手机');
      for (const id of peer.watchers) this.send(this.peers.get(id), data);
    } else if (data.type === 'command') {
      const phone = this.peers.get(peer.watching);
      if (!phone?.watchers.has(peer.id) || phone.closed) { this.unwatch(peer); this.send(peer, { type: 'offline' }); this.roster(); return; }
      if (data.command.action === 'hold') {
        if (data.command.phase === 'start') {
          if (peer.hold) this.send(phone, { type: 'command', command: { ...peer.hold, phase: 'cancel' } });
          peer.hold = data.command;
        } else {
          if (peer.hold?.pressId !== data.command.pressId) return;
          if (data.command.phase !== 'move') peer.hold = null;
        }
      }
      this.send(phone, data);
    } else if (data.type === 'notice' || data.type === 'input-state') {
      for (const id of peer.watchers) this.send(this.peers.get(id), data);
    } else if (data.type === 'stop') {
      for (const id of peer.watchers) { const viewer = this.peers.get(id); viewer.watching = null; this.send(viewer, { type: 'stopped' }); }
      peer.watchers.clear(); this.send(peer, { type: 'stop' });
    }
  }
  async *connect(signal) {
    const peer = { id: randomUUID(), queue: [], bytes: 0, watchers: new Set(), closed: false, seen: Date.now() };
    peer.wire = new Wire(json => this.enqueue(peer, json), data => this.receive(peer, data), { encode: text => gzipSync(text), decode: bytes => gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8') });
    const uplink = this.ctx.invocation.uplink();
    this.peers.set(peer.id, peer);
    const reading = (async () => {
      try { for await (const item of uplink) { if (peer.closed) break; peer.wire.receive(item.json); } }
      catch (error) { if (!signal.aborted) peer.failure = error; }
      finally { peer.closed = true; peer.wake?.(); }
    })();
    const abort = () => { peer.closed = true; peer.wake?.(); };
    signal.addEventListener('abort', abort, { once: true });
    const expiry = setInterval(() => { if (Date.now() - peer.seen > 45000) abort(); }, 15000);
    expiry.unref();
    try {
      while (!peer.closed) {
        if (!peer.queue.length) await new Promise(resolve => { peer.wake = resolve; });
        peer.wake = null;
        while (peer.queue.length && !peer.closed) { const item = peer.queue.shift(); peer.bytes -= item.json.length; yield item; }
      }
      if (peer.failure) throw peer.failure;
    } finally {
      clearInterval(expiry); signal.removeEventListener('abort', abort);
      this.unwatch(peer); this.peers.delete(peer.id);
      for (const id of peer.watchers) { const viewer = this.peers.get(id); if (viewer) { viewer.watching = null; this.send(viewer, { type: 'offline' }); } }
      this.roster(); void reading;
    }
  }
}
