export function exceptionsScreen(data) {
  const safeRows = Array.isArray(data?.rows) ? data.rows : [];
  const counts = data?.counts || { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
  const rows = safeRows.map((row) => `
    <tr><td>${row.RowID}</td><td>${row.exception_type}</td><td>${row.activity_name || '—'}</td><td>${row.end_date || '—'}</td></tr>
  `).join('');

  return `
    <section class="stack">
      <h2>Exceptions (Long activities only)</h2>
      <article class="card">
        <table>
          <thead><tr><th>RowID</th><th>Exception</th><th>Activity</th><th>End Date</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No exceptions found.</td></tr>'}</tbody>
        </table>
      </article>
      <article class="card">
        <h3>Counts</h3>
        <p>Missing instructor: ${counts.missing_instructor}</p>
        <p>Missing start date: ${counts.missing_start_date}</p>
        <p>Late end date: ${counts.late_end_date}</p>
      </article>
    </section>
  `;
}
