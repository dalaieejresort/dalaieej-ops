// A fresh generation prevents pre-archive carts, cached balances and old clients
// from silently writing into the restarted POS. Retain the old browser data.
// Paused cutovers use a temporary build generation, distinct from the release.
export const POS_DATA_GENERATION = process.env.NEXT_PUBLIC_POS_DATA_GENERATION || 'season-reset-20260921';
