// One subscription per authenticated identity; RLS remains the security boundary.
export function createNotificationRuntime({ client, service, onCounts, onChange = () => {}, document: doc = globalThis.document, timers = globalThis }) {
  let uid = '', channel = null, generation = 0, inflight = null, again = false, retryTimer = null, connection = 0;
  const refresh = async () => {
    if (!uid) return;
    if (inflight) { again = true; return inflight; }
    const current = generation;
    const request = Promise.resolve().then(() => service.counts()).then(counts => {
      if (current === generation && uid) { onCounts(counts); onChange(); }
    }).catch(() => { /* Keep verified counts during temporary errors / pre-migration. */ }).finally(() => {
      if (current !== generation) return;
      inflight = null;
      if (again) { again = false; void refresh(); }
    });
    inflight = request;
    return request;
  };
  const switchUser = next => {
    next = String(next || '');
    if (next === uid) return;
    generation++; uid = next; inflight = null; again = false;
    timers.clearTimeout(retryTimer);
    if (channel) void client.removeChannel(channel);
    channel = null;
    onCounts({ tasks: 0, unread: 0 });
    if (!uid) return;
    const current = generation;
    const changed = () => { if (current === generation) void refresh(); };
    const connect = () => {
      if (current !== generation || !uid) return;
      const attempt = ++connection;
      channel = client.channel(`dashboard-notifications:${uid}:${generation}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_notifications', filter: `recipient_auth_user_id=eq.${uid}` }, changed)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_notification_tasks', filter: `recipient_auth_user_id=eq.${uid}` }, changed)
        .subscribe(status => {
          if (current !== generation || attempt !== connection) return;
          if (status === 'SUBSCRIBED') changed();
          if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            timers.clearTimeout(retryTimer);
            retryTimer = timers.setTimeout(() => {
              if (current !== generation) return;
              connection++;
              const old = channel; channel = null;
              if (old) void client.removeChannel(old);
              connect();
            }, 5000);
          }
        });
    };
    connect(); void refresh();
  };
  const visible = () => { if (doc?.visibilityState !== 'hidden') void refresh(); };
  const interval = timers.setInterval(visible, 60000);
  doc?.addEventListener('visibilitychange', visible);
  return { switchUser, refresh, dispose() {
    switchUser(''); timers.clearInterval(interval); timers.clearTimeout(retryTimer);
    doc?.removeEventListener('visibilitychange', visible);
  } };
}
