export const calculateTaxes = (totalAmount: number | null | undefined, taxRateStr: string | null | undefined) => {
  if (totalAmount == null || taxRateStr == null) return {};
  const rate = parseFloat(taxRateStr) / 100;
  if (isNaN(rate)) return {};
  const amount = Number((totalAmount / (1 + rate)).toFixed(2));
  const tax_amount = Number((totalAmount - amount).toFixed(2));
  return { amount, tax_amount };
};
