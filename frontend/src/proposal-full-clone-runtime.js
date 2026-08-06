import { api } from './api.js';
import { showToast } from './screens/shared/toast.js';
import {
  buildEditableProposalClonePayload,
  cloneProposalItems
} from './proposal-full-clone-payload.js?v=20260729-independent-clone-v2';

const INSTALL_FLAG = Symbol.for('taasiyeda.proposalFullCloneRuntime.v2');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function cloneFailureMessage(error) {
  const detail = text(error?.message || error);
  if (detail === 'clone_source_not_found') return 'הצעת המקור לא נמצאה ולכן לא ניתן היה לשכפל אותה.';
  if (detail === 'clone_items_api_unavailable') return 'לא ניתן היה לקרוא או לשמור את שורות ההצעה לצורך השכפול.';
  return 'לא ניתן היה לשכפל את ההצעה במלואה. לא נוצרה טיוטה חלקית.';
}

function notifyCloneFailure(error) {
  const message = cloneFailureMessage(error);
  try {
    showToast(message, 'error');
  } catch {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(message);
  }
  console.error('[proposal full clone failed]', error);
}

async function loadCloneSource(apiClient, sourceId) {
  if (typeof apiClient.proposalsAgreements !== 'function') throw new Error('clone_source_api_unavailable');
  const snapshot = await apiClient.proposalsAgreements();
  const source = (Array.isArray(snapshot?.rows) ? snapshot.rows : [])
    .find((row) => text(row?.id) === sourceId);
  if (!source) throw new Error('clone_source_not_found');
  return source;
}

async function loadCloneItems(apiClient, sourceId) {
  if (typeof apiClient.readProposalAgreementItems !== 'function') {
    throw new Error('clone_items_api_unavailable');
  }
  const items = await apiClient.readProposalAgreementItems(sourceId);
  return cloneProposalItems(items);
}

/**
 * Wraps proposal creation only for duplication requests. Normal proposal
 * creation remains unchanged.
 *
 * A duplicate is created from fresh server data, receives all editable
 * proposal fields and all item rows, starts a new independent proposal series,
 * is reset to draft, and is rolled back if item-copy fails. The existing
 * proposals screen then opens the returned draft in edit mode as usual.
 */
export function installProposalFullCloneRuntime(apiClient = api) {
  if (!apiClient || apiClient[INSTALL_FLAG]) return apiClient;
  if (typeof apiClient.addProposalAgreement !== 'function') return apiClient;

  const originalAddProposalAgreement = apiClient.addProposalAgreement.bind(apiClient);

  Object.defineProperty(apiClient, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  apiClient.addProposalAgreement = async (requestedPayload = {}) => {
    // The legacy screen currently sends supersedes_proposal_id as its clone
    // source marker. The payload builder deliberately removes that field before
    // insertion so duplication does not create or replace a version lineage.
    const sourceId = text(requestedPayload?.supersedes_proposal_id);
    if (!sourceId) return originalAddProposalAgreement(requestedPayload);

    let createdProposalId = '';
    try {
      const [source, items] = await Promise.all([
        loadCloneSource(apiClient, sourceId),
        loadCloneItems(apiClient, sourceId)
      ]);

      const fullClonePayload = buildEditableProposalClonePayload(source, requestedPayload);
      const result = await originalAddProposalAgreement(fullClonePayload);
      createdProposalId = text(result?.row?.id);
      if (!result?.ok || !createdProposalId) throw new Error('clone_create_failed');

      if (typeof apiClient.saveProposalAgreementItems !== 'function') {
        throw new Error('clone_items_api_unavailable');
      }
      await apiClient.saveProposalAgreementItems(createdProposalId, items);

      return result;
    } catch (error) {
      if (createdProposalId && typeof apiClient.deleteProposalAgreement === 'function') {
        try {
          await apiClient.deleteProposalAgreement(createdProposalId);
        } catch (rollbackError) {
          console.error('[proposal full clone rollback failed]', rollbackError);
        }
      }
      notifyCloneFailure(error);
      throw error;
    }
  };

  return apiClient;
}

installProposalFullCloneRuntime();
