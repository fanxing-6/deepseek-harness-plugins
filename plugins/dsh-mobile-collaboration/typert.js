import { packageName, TYPERT_REMOTE } from './remote.js';
export const TYPERT = { package: packageName, face: 'host', schemas: [], get invocations() { return TYPERT_REMOTE.descriptors; }, model: { services: [], events: [], objects: [] } };
