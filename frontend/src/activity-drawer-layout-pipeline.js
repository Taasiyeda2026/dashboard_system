import { enhanceActivityDrawerForm } from './activity-drawer-inline-layout.js';
import { enhanceGefenOrderUi } from './activity-drawer-gefen-order-ui.js';
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

    // The legacy exists_in_gefen checkbox lives inside an edit-group section.
    // The inline-layout pass removes those legacy sections after moving their
    // visible controls, so retain the checkbox node and restore it to the form
    // before the Gefen enhancer relocates it into the funding cell.
    const gefenExistsCheckbox = form.querySelector('[data-gefen-exists-checkbox]');

    changed = enhanceActivityDrawerForm(form) || changed;
    if (gefenExistsCheckbox && !form.contains(gefenExistsCheckbox)) {
      form.append(gefenExistsCheckbox);
      changed = true;
    }
    changed = enhanceGefenOrderUi(form) || changed;
    changed = applyActivityDrawerTypeLayoutFix(form) || changed;
    if (settings) polishActivityDrawerEditOptions(form, settings);
    changed = dockActivityDrawerActions(form) || changed;
  });
  return changed;
}
