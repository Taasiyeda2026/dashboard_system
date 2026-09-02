/**
 * The only scheduler for an active proposal editor.  The screen remains responsible
 * for turning form controls into the persisted payload, while this controller owns
 * the current snapshot and commits at most one preview for the latest revision.
 */
export class ProposalEditorController {
  constructor(form, { readState, renderPreview, frame = globalThis.requestAnimationFrame, cancelFrame = globalThis.cancelAnimationFrame } = {}) {
    this.form = form;
    this.readState = readState;
    this.renderPreview = renderPreview;
    this.frame = typeof frame === 'function' ? frame.bind(globalThis) : (callback) => setTimeout(callback, 0);
    this.cancelFrame = typeof cancelFrame === 'function' ? cancelFrame.bind(globalThis) : clearTimeout;
    this.state = null;
    this.revision = 0;
    this.renderCount = 0;
    this.pendingFrame = 0;
    this.pendingTimer = 0;
  }

  change({ delay = 0 } = {}) {
    this.state = this.readState(this.form);
    this.revision += 1;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    if (this.pendingFrame) this.cancelFrame(this.pendingFrame);
    this.pendingTimer = 0;
    this.pendingFrame = 0;
    if (delay > 0) {
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = 0;
        this.schedule();
      }, delay);
      return;
    }
    this.schedule();
  }

  schedule() {
    const revision = this.revision;
    this.pendingFrame = this.frame(() => {
      this.pendingFrame = 0;
      if (revision !== this.revision || !this.form?.isConnected) return;
      this.renderPreview(this.form, this.state);
      this.renderCount += 1;
      this.form.dataset.paPreviewRenderCount = String(this.renderCount);
    });
  }

  destroy() {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    if (this.pendingFrame) this.cancelFrame(this.pendingFrame);
    this.pendingTimer = 0;
    this.pendingFrame = 0;
  }
}
