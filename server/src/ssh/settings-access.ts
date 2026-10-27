import type { AppSettings } from '../../../shared/types.js';
import { getStore } from '../core/store.js';

/** Read current settings (typed). */
export function getSettings(): AppSettings {
  return getStore().data.settings;
}
