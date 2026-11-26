import { AsyncLocalStorage } from 'node:async_hooks';
import type { TrafficBinding } from './traffic.js';
/** Per-request/worker action only; never identity or authorization. */
export const configurationAction = new AsyncLocalStorage<TrafficBinding>();
