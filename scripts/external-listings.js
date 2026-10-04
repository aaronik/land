'use strict';

const SOLD_BADGE = /<img\b(?=[^>]*\bsrc\s*=\s*["'][^"']*\/icon_sold\.(?:png|gif|webp)["'])[^>]*>/i;

function dealerStatus(html) {
  // The site's navigation always contains a "Sold" link; only the listing's
  // image badge is evidence that this particular property is sold.
  return SOLD_BADGE.test(html) ? 'Sold' : null;
}

async function refreshExternalListings(items, fetchPage, logger = console) {
  return Promise.all(items.map(async item => {
    if (item.referenceListing || item.listingSource !== 'California Outdoor Properties' || !item.url) return item;
    try {
      const html = await fetchPage(item.url);
      const status = dealerStatus(html);
      if (!status) {
        logger.warn(`No conclusive dealer status at ${item.url}; retaining ${item.status || 'Unknown'}`);
        return item;
      }
      return { ...item, status };
    } catch (error) {
      // WAFs can block automated requests. Never turn a failed check into
      // evidence that a sold listing is for sale again.
      logger.warn(`Could not check dealer listing ${item.url}: ${error.message}; retaining ${item.status || 'Unknown'}`);
      return item;
    }
  }));
}

module.exports = { dealerStatus, refreshExternalListings };
