export const weekScreen = {
  load: ({ api }) => api.week(),
  render(data) {
    return `<section class="panel"><h2>Week</h2><div class="stack">${(data.days || []).map((day) => `<article class="mini-card"><h4>${day.date}</h4><p>${day.items.length} activities</p></article>`).join('')}</div></section>`;
  }
};
