/** Anonymous per-install device id used for report cooldowns and subscriptions. */
export function getDeviceId(): string {
  let id = localStorage.getItem('wh_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('wh_device_id', id);
  }
  return id;
}
