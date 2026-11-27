// Keep the writer's existing key so previously recorded opens still count.
const usageKey = () => `shasta-land-parcelquest:${new Date().toISOString().slice(0, 7)}`;

export function readParcelQuestUsage(key = usageKey()) {
  try {
    const count = Number(localStorage.getItem(key));
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  } catch { return 0; }
}

export function incrementParcelQuestUsage() {
  const key = usageKey();
  const count = readParcelQuestUsage(key) + 1;
  try { localStorage.setItem(key, String(count)); } catch { /* The lookup still works without storage. */ }
  return count;
}

export const parcelQuestUsageLabel = count => `${count} ParcelQuest lookup${count === 1 ? '' : 's'} opened from this browser this month.`;
