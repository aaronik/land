'use strict';

// Mt. Shasta Realty no longer serves CA-SISKIYOU listings. Mountain Gate
// still carries that MLS; preserve the listing ID, address, and URL suffix.
export function listingUrl(record) {
  const value = record.url || '';
  try {
    const url = new URL(value);
    if (['mountshastarealty.com', 'www.mountshastarealty.com'].includes(url.hostname)
      && url.pathname.startsWith('/idx/listing/CA-SISKIYOU/')) {
      url.protocol = 'https:';
      url.hostname = 'www.realtymtshasta.com';
      return url.href;
    }
  } catch { /* Leave non-IDX links unchanged. */ }
  return value;
}
