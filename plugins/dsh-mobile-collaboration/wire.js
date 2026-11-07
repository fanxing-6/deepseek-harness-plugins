import { z } from 'zod';
const packet = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ack'), seq: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('chunk'), seq: z.number().int().nonnegative(), done: z.boolean(), data: z.array(z.number().int().min(0).max(255)).max(4096) }).strict(),
]);
export class Wire {
  pending = []; waiting = new Map(); parts = []; size = 0; queued = 0; nextSend = 0; nextReceive = 0;
  constructor(sendRaw, onMessage, codec) { this.sendRaw = sendRaw; this.onMessage = onMessage; this.codec = codec; }
  send(value) {
    const json = JSON.stringify(value);
    if (json.length > 32 * 1024 * 1024) throw new Error('页面内容超过协同传输限制');
    const bytes = this.codec.encode(json);
    this.queued += bytes.length;
    if (this.queued > 32 * 1024 * 1024) throw new Error('协同连接处理速度不足');
    for (let offset = 0; offset < bytes.length; offset += 4096) this.pending.push({ kind: 'chunk', seq: this.nextSend++, done: offset + 4096 >= bytes.length, data: Array.from(bytes.subarray(offset, offset + 4096)) });
    this.pump();
  }
  pump() {
    while (this.pending.length && this.waiting.size < 4) {
      const item = this.pending.shift(); this.waiting.set(item.seq, item.data.length);
      this.sendRaw(JSON.stringify(item));
    }
  }
  receive(raw) {
    const item = packet.parse(JSON.parse(raw));
    if (item.kind === 'ack') {
      const size = this.waiting.get(item.seq);
      if (size === undefined) throw new Error('协同传输确认无效');
      this.waiting.delete(item.seq); this.queued -= size; this.pump(); return;
    }
    if (item.seq !== this.nextReceive++) throw new Error('协同传输顺序无效');
    this.parts.push(Uint8Array.from(item.data)); this.size += item.data.length;
    if (this.size > 32 * 1024 * 1024) throw new Error('协同页面数据超过限制');
    this.sendRaw(JSON.stringify({ kind: 'ack', seq: item.seq }));
    if (item.done) {
      const bytes = new Uint8Array(this.size); let offset = 0;
      for (const part of this.parts) { bytes.set(part, offset); offset += part.length; }
      this.parts = []; this.size = 0;
      this.onMessage(JSON.parse(this.codec.decode(bytes)));
    }
  }
}
