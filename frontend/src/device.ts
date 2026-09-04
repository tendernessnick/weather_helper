import { storage } from './storage';

/** Anonymous per-install device id used for report cooldowns and subscriptions. */
export function getDeviceId(): string {
  let id = storage.get('wh_device_id');
  if (!id) {
    id = crypto.randomUUID();
    storage.set('wh_device_id', id);
  }
  return id;
}
