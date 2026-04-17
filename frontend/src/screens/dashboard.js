export function dashboardScreen(data, userRole = '') {
  const cards = [
    ['Total Short Activities', data.totals.short],
    ['Total Long Activities', data.totals.long],
    ['Total Instructors', data.totals.instructors],
    ['Course Endings This Month', data.totals.courseEndings]
  ];

  const grouped = data.byManager.map((row) => `
    <tr>
      <td>${row.activity_manager || '—'}</td>
      <td>${row.short_count}</td>
      <td>${row.long_count}</td>
      <td>${row.total}</td>
    </tr>
  `).join('');

  return `
    <section class="stack">
      <h2>Dashboard</h2>
      <div class="kpis">
        ${cards.map(([label, value]) => `<article class="card kpi"><h3>${label}</h3><strong>${value}</strong></article>`).join('')}
      </div>
      <article class="card">
        <h3>Totals by Activity Manager</h3>
        <table>
          <thead><tr><th>Manager</th><th>Short</th><th>Long</th><th>Total</th></tr></thead>
          <tbody>${grouped}</tbody>
        </table>
      </article>
      <small class="muted">Role: ${userRole}</small>
    </section>
  `;
}
