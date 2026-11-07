import { TypertRemoteService, RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { recognize } from './volcengine.js';

export default class VolcSpeech extends TypertRemoteService {
  static inject = ['typert', 'credentials'];

  constructor(ctx, config) {
    super(ctx, 'volcSpeech');
    this.apiKeyRef = config.apiKeyRef ?? 'VOLCENGINE_ASR_API_KEY';
  }

  async *recognize(signal) {
    const credential = await this.ctx.credentials.resolve(this.apiKeyRef);
    if (!credential?.value) throw new RemoteError('volc-speech/credential', '豆包语音 API Key 尚未配置', {});
    const uplink = this.ctx.invocation.uplink();
    async function* audio() {
      for await (const item of uplink) {
        const bytes = Buffer.from(item.audioBase64, 'base64');
        if (bytes.toString('base64') !== item.audioBase64) throw new RemoteError('volc-speech/audio', '音频编码无效', {});
        yield bytes;
      }
    }
    try {
      yield* recognize({ apiKey: credential.value, audio: audio(), signal });
    } catch (error) {
      throw new RemoteError('volc-speech/recognition', error.message, {});
    }
  }
}
