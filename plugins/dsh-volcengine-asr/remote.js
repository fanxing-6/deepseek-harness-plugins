import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';

export const packageName = '@local/dsh-volcengine-asr';
const codec = (name, schema) => ({ mode: 'strict', typeSymbol: `${packageName}#${name}`, create: () => schema });
const output = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), maxSeconds: z.number() }),
  z.object({ type: z.literal('ack'), bytes: z.number() }),
  z.object({ type: z.literal('transcript'), text: z.string(), final: z.boolean(), audioSeconds: z.number() }),
]);
export const TYPERT_REMOTE = createTypertRemoteInfo({
  package: packageName,
  methods: {
    'volcSpeech/recognize': {
      service: 'volcSpeech', invocation: { kind: 'direct' }, mode: 'stream', parameters: [],
      cancellation: { parameter: 'signal' },
      uplink: { codec: codec('AudioChunk', z.object({ audioBase64: z.string().max(8536) }).strict()) },
      result: codec('RecognitionEvent', output),
    },
  },
}, z);
