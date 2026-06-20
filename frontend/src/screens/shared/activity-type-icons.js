const ACTIVITY_TYPE_ICON_PATHS = {
  course: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  workshop: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.1 6.1a2.1 2.1 0 0 1-3-3l6.1-6.1a6 6 0 0 1 7.9-7.9z"/>',
  escape_room: '<path d="M19.4 13.5a1.8 1.8 0 0 0 0-3l-1.9-1.1 1.9-1.1a1.8 1.8 0 0 0 0-3l-2-1.1a1.8 1.8 0 0 0-2.7 1.5v2.2h-2.4V5.7a1.8 1.8 0 0 0-2.7-1.5l-2 1.1a1.8 1.8 0 0 0 0 3l1.9 1.1-1.9 1.1a1.8 1.8 0 0 0 0 3l2 1.1a1.8 1.8 0 0 0 2.7-1.5v-2.2h2.4v2.2a1.8 1.8 0 0 0 2.7 1.5z"/><path d="M8 20h8"/>',
  tour: '<path d="M8 6v12"/><path d="M16 6v12"/><path d="M3 10h18"/><path d="M6 20h12"/><path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="14" r="1"/>',
  after_school: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
};

export const ACTIVITY_TYPE_ICON_KEYS = {
  course: 'course',
  workshop: 'workshop',
  escape_room: 'escape_room',
  tour: 'tour',
  after_school: 'after_school'
};

export function activityTypeIconSvg(typeKey, size = 15) {
  const path = ACTIVITY_TYPE_ICON_PATHS[typeKey] || '';
  if (!path) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
