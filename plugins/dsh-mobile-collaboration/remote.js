import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
export const packageName = '@local/dsh-mobile-collaboration';
const codec = (name, schema) => ({ mode: 'strict', typeSymbol: `${packageName}#${name}`, create: () => schema });
export const TYPERT_REMOTE = createTypertRemoteInfo({ package: packageName, methods: {
  'mobileCollab/connect': {
    service: 'mobileCollab', invocation: { kind: 'direct' }, mode: 'stream',
    parameters: [], cancellation: { parameter: 'signal' },
    uplink: { codec: codec('Message', z.object({ json: z.string().max(8 * 1024 * 1024) }).strict()) },
    result: codec('Message', z.object({ json: z.string().max(8 * 1024 * 1024) }).strict()),
  },
} }, z);
