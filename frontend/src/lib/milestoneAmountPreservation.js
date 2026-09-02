function toCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

export function preserveMilestoneAmounts(suggestedRows = [], existingRows = []) {
  const suggested = Array.isArray(suggestedRows) ? suggestedRows : [];
  const existing = Array.isArray(existingRows) ? existingRows : [];
  if (!suggested.length) return [];

  const existingCents = existing.map((row) => toCents(row?.amount));
  const totalCents = existingCents.reduce((sum, amount) => sum + amount, 0);
  if (!totalCents) return suggested.map((row) => ({ ...row }));

  if (suggested.length === existing.length) {
    return suggested.map((row, index) => ({
      ...row,
      amount: existingCents[index] / 100,
    }));
  }

  const baseCents = Math.floor(totalCents / suggested.length);
  let remainder = totalCents - baseCents * suggested.length;
  return suggested.map((row) => {
    const cents = baseCents + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return { ...row, amount: cents / 100 };
  });
}
