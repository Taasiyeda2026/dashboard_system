import { enhanceActivityDrawerForm } from './activity-drawer-inline-layout.js';
import { applyActivityDrawerTypeLayoutFix } from './activity-drawer-type-layout-fix.js';
import { polishActivityDrawerEditOptions } from './activity-drawer-edit-dedup.js';
import { dockActivityDrawerActions } from './activity-drawer-floating-actions.js';

/**
 * Applies the stable visual structure of an already-mounted activity drawer.
 * This intentionally has no edit or save behavior, so it is safe for viewers.
 */
export function applyActivityDrawerLayoutPipeline(contentRoot, settings = null) {
  if (!contentRoot) return false;
  let changed = false;
  contentRoot.querySelectorAll('[data-drawer-form]').forEach((form) => {
    if (!form.closest('.ds-drawer')) return;
    changed = enhanceActivityDrawerForm(form) || changed;
    changed = applyActivityDrawerTypeLayoutFix(form) || changed;
    if (settings) polishActivityDrawerEditOptions(form, settings);
    changed = dockActivityDrawerActions(form) || changed;
  });
  return changed;
}