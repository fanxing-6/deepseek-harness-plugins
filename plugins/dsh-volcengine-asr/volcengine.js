import { Parser } from 'binary-parser';
import WebSocket from 'ws';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';

export const endpoint = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
export const resourceId = 'volc.seedasr.sauc.duration';

// 使用 binary-parser 描述官方协议，压缩和 JSON 交给标准库处理。
const responseSchema = new Parser()
  .bit4('version', { assert: 1 }).bit4('headerSize', { assert: value => value >= 1 })
  .bit4('messageType').bit4('flags')
  .bit4('serialization').bit4('compression').uint8('reserved')
  .skip(function () { return this.headerSize * 4 - 4; })
  .choice({ tag() { return this.flags & 1; }, choices: {
    0: new Parser(), 1: new Parser().int32be('sequence'),
  } })
  .choice({ tag() { return (this.flags & 4) >>> 2; }, choices: {
    0: new Parser(), 1: new Parser().int32be('event'),
  } })
  .choice({ tag: 'messageType', choices: {
    9: new Parser(), 15: new Parser().uint32be('code'),
  } })
  .uint32be('payloadSize')
  .buffer('payload', { length: 'payloadSize' }).saveOffset('end');

export function decodeResponse(bytes) {
  const frame = responseSchema.parse(bytes);
  if (frame.end !== bytes.length) throw new Error('语音响应长度不符');
  if (![0, 1].includes(frame.compression)) throw new Error('语音响应压缩格式不支持');
  const payload = frame.compression === 1
    ? gunzipSync(frame.payload, { maxOutputLength: 1024 * 1024 }) : frame.payload;
  if (frame.code === 45000002) throw new Error('没有采集到语音，请按住按钮再说话。');
  if (frame.code) throw new Error(`火山引擎 ${frame.code}：${payload.toString('utf8')}`);
  if (frame.serialization !== 1) throw new Error('语音响应序列化格式不支持');
  return { final: Boolean(frame.flags & 2), body: JSON.parse(payload.toString('utf8')) };
}

function encodeRequest(type, sequence, payload, final = false) {
  const compressed = gzipSync(payload);
  const header = Buffer.alloc(12);
  header.set([0x11, (type << 4) | (final ? 3 : 1), 0x11, 0]);
  header.writeInt32BE(final ? -sequence : sequence, 4);
  header.writeUInt32BE(compressed.length, 8);
  return Buffer.concat([header, compressed]);
}

export async function* recognize({ apiKey, audio, signal, maxSeconds = 120 }) {
  signal.throwIfAborted();
  if (!apiKey) throw new Error('缺少 VOLCENGINE_ASR_API_KEY');
  const socket = new WebSocket(endpoint, {
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': randomUUID(),
    },
    handshakeTimeout: 15000,
    maxPayload: 1024 * 1024,
  });
  const output = new PassThrough({ objectMode: true, highWaterMark: 64 });
  const lifetime = new AbortController();
  const abort = () => {
    output.destroy(signal.reason ?? new Error('听写已取消'));
    socket.terminate();
  };
  signal.addEventListener('abort', abort, { once: true });
  let finalReceived = false;
  let sentBytes = 0;
  let sender;
  let finalTimer;
  let sequence = 1;
  let transcript = '';
  const deadline = setTimeout(() => output.destroy(new Error('听写超过时间限制')), (maxSeconds + 30) * 1000);
  const initTimer = setTimeout(() => output.destroy(new Error('语音服务初始化超时')), 20000);
  socket.on('message', (bytes, binary) => {
    if (!binary) { output.destroy(new Error('语音服务返回了非二进制数据')); return; }
    try {
      const response = decodeResponse(bytes);
      if (response.final) finalReceived = true;
      if (!output.write({ kind: 'response', response })) output.destroy(new Error('语音响应积压超过限制'));
    } catch (error) {
      output.destroy(error);
    }
  });
  socket.on('error', error => output.destroy(error));
  socket.on('unexpected-response', (_request, response) => {
    response.resume();
    output.destroy(new Error(`火山引擎连接失败：HTTP ${response.statusCode}`));
  });
  socket.on('close', () => {
    if (finalReceived) output.end();
    else output.destroy(new Error('语音连接在最终结果返回前中断'));
  });
  // 提前订阅 error，连接期间发生的失败也由同一迭代器传递。
  const iterator = output[Symbol.asyncIterator]();
  let next = iterator.next();
  next.catch(() => {});
  const send = bytes => new Promise((resolve, reject) => {
    socket.send(bytes, error => error ? reject(error) : resolve());
  });
  try {
    await Promise.race([
      once(socket, 'open', { signal }),
      next.then(() => { throw new Error('语音连接初始化失败'); }),
    ]);
    await send(encodeRequest(1, sequence++, Buffer.from(JSON.stringify({
      user: { uid: 'dsh-dictation' },
      audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
      request: {
        model_name: 'bigmodel', enable_nonstream: true,
        enable_itn: true, enable_punc: true, show_utterances: true, result_type: 'full',
      },
    }))));
    let initialized = false;
    for (;;) {
      const entry = await next;
      if (entry.done) break;
      next = iterator.next();
      next.catch(() => {});
      const item = entry.value;
      if (item.kind === 'ack') { yield { type: 'ack', bytes: item.bytes }; continue; }
      const { body, final } = item.response;
      if (body.code && body.code !== 20000000) throw new Error(`火山引擎 ${body.code}：${body.message ?? '识别失败'}`);
      if (!initialized) {
        initialized = true;
        clearTimeout(initTimer);
        yield { type: 'ready', maxSeconds };
        sender = (async () => {
          for await (const bytes of audio) {
            lifetime.signal.throwIfAborted();
            if (bytes.length === 0 || bytes.length > 6400 || bytes.length % 2) throw new Error('音频数据长度无效');
            sentBytes += bytes.length;
            if (sentBytes > maxSeconds * 32000) throw new Error('录音超过时间限制');
            await send(encodeRequest(2, sequence++, bytes));
            if (!output.write({ kind: 'ack', bytes: sentBytes })) throw new Error('语音响应积压超过限制');
          }
          await send(encodeRequest(2, sequence++, Buffer.alloc(0), true));
          finalTimer = setTimeout(() => output.destroy(new Error('等待最终识别结果超时')), 15000);
        })();
        sender.catch(error => output.destroy(error));
      }
      const result = body.result;
      if (result?.text !== undefined && typeof result.text !== 'string') throw new Error('语音响应文本格式无效');
      if (result?.text) transcript = result.text;
      if (result?.text || final) yield { type: 'transcript', text: transcript, final, audioSeconds: sentBytes / 32000 };
      if (final) break;
    }
    if (!finalReceived) throw new Error('语音服务未返回最终结果');
    await sender;
  } finally {
    clearTimeout(deadline);
    clearTimeout(initTimer);
    clearTimeout(finalTimer);
    signal.removeEventListener('abort', abort);
    lifetime.abort();
    output.destroy();
    if (socket.readyState === WebSocket.OPEN && finalReceived) socket.close();
    else socket.terminate();
  }
}
