import { api } from './api.js';

const originalProposalsAgreements = api.proposalsAgreements?.bind(api);

function text(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

if (originalProposalsAgreements && !api.__clientFileDataAdapter) {
  api.__clientFileDataAdapter = true;
  api.proposalsAgreements = async (...args) => {
    const data = await originalProposalsAgreements(...args);
    const contactOptions = Array.isArray(data?.contactOptions) ? data.contactOptions : [];
    const catalogAuthorities = contactOptions.filter((row) => text(row?._catalog_source) === 'authorities');
    const catalogSchools = contactOptions.filter((row) => text(row?._catalog_source) === 'schools');
    const contactsSchools = contactOptions.filter((row) => {
      const source = text(row?._catalog_source);
      return source !== 'authorities' && source !== 'schools';
    });
    return {
      ...data,
      catalogAuthorities: Array.isArray(data?.catalogAuthorities) ? data.catalogAuthorities : catalogAuthorities,
      catalogSchools: Array.isArray(data?.catalogSchools) ? data.catalogSchools : catalogSchools,
      contactsSchools: Array.isArray(data?.contactsSchools) ? data.contactsSchools : contactsSchools
    };
  };
}
