/**
 * The only scheduler for an active proposal editor.  The screen remains responsible
 * for turning form controls into the persisted payload, while this controller owns
 * the current snapshot and commits at most one preview for the latest revision.
 */
function previewStateKey(state, total) {
  try {
    return JSON.stringify({ state, total });
  } catch {
    return null;
  }
}

export class ProposalEditorController {
  constructor(form, { readState, calculate, renderPreview, frame = globalThis.requestAnimationFrame, cancelFrame = globalThis.cancelAnimationFrame } = {}) {
    this.form = form;
    this.readState = readState;
    this.calculate = calculate;
    this.renderPreview = renderPreview;
    this.frame = typeof frame === 'function' ? frame.bind(globalThis) : (callback) => setTimeout(callback, 0);
    this.cancelFrame = typeof cancelFrame === 'function' ? cancelFrame.bind(globalThis) : clearTimeout;
    this.state = null;
    this.revision = 0;
    this.renderCount = 0;
    this.pendingFrame = 0;
    this.pendingTimer = 0;
    this.lastRenderedStateKey = null;
  }

  change({ delay = 0, recalculate = true, calculateOptions = {} } = {}) {
    if (recalculate) this.lastTotal = this.calculate?.(this.form, calculateOptions);
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
    return this.lastTotal;
  }

  schedule() {
    const revision = this.revision;
    this.pendingFrame = this.frame(() => {
      this.pendingFrame = 0;
      if (revision !== this.revision || !this.form?.isConnected) return;
      const stateKey = previewStateKey(this.state, this.lastTotal);
      // Native controls often emit `input` while editing and a follow-up `change`
      // on blur. If the settled proposal snapshot is identical to the preview that
      // was already committed, the second event is not a new editor transaction and
      // must not rewrite/count the full preview again.
      if (stateKey != null && stateKey === this.lastRenderedStateKey) return;
      this.renderPreview(this.form, this.state);
      this.lastRenderedStateKey = stateKey;
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