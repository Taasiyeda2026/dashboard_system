import { api } from './api.js';
import { installProposalPdfStorageKeyHotfix } from './proposal-pdf-storage-key.js';

installProposalPdfStorageKeyHotfix(api, globalThis);

export {
  installProposalPdfStorageKeyHotfix,
  proposalPdfFileWithSafeStorageName,
  proposalPdfSafeStorageFileName
} from './proposal-pdf-storage-key.js';
