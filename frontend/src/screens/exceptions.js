export function exceptionsScreen(data) {
  const rows = data.rows.map((row) => `
    <tr><td>${row.row_id}</td><td>${row.exception_type}</td><td>${row.title || '—'}</td><td>${row.end_date || '—'}</td></tr>
  `).join('');

  return `
    <section class="stack">
      <h2>Exceptions (Long activities only)</h2>
      <article class="card">
        <table>
          <thead><tr><th>ID</th><th>Exception</th><th>Activity</th><th>End Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </article>
      <article class="card">
        <h3>Counts</h3>
        <p>Missing instructor: ${data.counts.missing_instructor}</p>
        <p>Missing start date: ${data.counts.missing_start_date}</p>
        <p>Late end date: ${data.counts.late_end_date}</p>
      </article>
    </section>
  `;
}
