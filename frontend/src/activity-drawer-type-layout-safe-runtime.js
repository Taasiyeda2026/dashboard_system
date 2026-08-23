// Drawer layout is applied directly when a concrete activity form is bound.
// Keeping this compatibility module side-effect free prevents document-wide
// observers from repeatedly rearranging an open drawer.
export { applyActivityDrawerTypeLayoutFix, applyActivityDrawerTypeLayoutFixes } from './activity-drawer-type-layout-fix.js';
