const LIMIT = 30;
export function createNotificationService(client) {
  const historyArgs = ({ before, filters = {} } = {}) => ({ p_before_time: before?.created_at || null, p_before_id: before?.id || null,
    p_domain: filters.domain || null, p_from_date: filters.from || null, p_to_date: filters.to || null });
  const page = async (rpc, options) => {
    const { data, error } = await client.rpc(rpc, historyArgs(options));
    if (error) throw error;
    return { rows: (data || []).slice(0, LIMIT), hasMore: (data || []).length > LIMIT };
  };
  return {
    async counts() {
      const [tasks, unread] = await Promise.all([
        client.from('dashboard_notification_tasks').select('id', { count: 'exact', head: true }).is('closed_at', null),
        client.from('dashboard_notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      ]);
      if (tasks.error || unread.error) throw tasks.error || unread.error;
      return { tasks: tasks.count || 0, unread: unread.count || 0 };
    },
    page: options => page('dashboard_notification_history', options),
    closedTasks: options => page('dashboard_notification_task_history', options),
    async details(rows) {
      // Batches are bounded on the server as well. No source data beyond labels.
      const details = {};
      for (let i = 0; i < rows.length; i += 100) {
        const { data, error } = await client.rpc('dashboard_notification_labels', { p_ids: rows.slice(i, i + 100).map(row => row.id) });
        if (error) throw error;
        Object.assign(details, data || {});
      }
      return details;
    },
    async tasks() {
      const { data, error } = await client.from('dashboard_notification_tasks').select('*').is('closed_at', null).order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async issues() {
      const { data, error } = await client.rpc('dashboard_notification_routing_issues');
      if (error) throw error;
      return data || [];
    },
    async markRead(id) {
      const { data, error } = await client.rpc('mark_dashboard_notification_read', { p_notification_id: id });
      if (error) throw error;
      return data === true;
    }
  };
}
