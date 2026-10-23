import Decimal from "decimal.js";
Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export { Decimal };
export const d = (v: Decimal.Value) => new Decimal(v);
export const money = (v: Decimal.Value, units = 2) =>
  d(v).toDecimalPlaces(units).toFixed(units);
export const convert = (amount: string, rate: string) =>
  money(d(amount).times(rate));
export function carrying(amount: string, native: string, book: string) {
  if (d(amount).lte(0) || d(native).lte(0) || d(amount).gt(native))
    throw new Error("Amount exceeds available balance");
  return d(amount).eq(native)
    ? money(book)
    : money(d(book).times(amount).div(native));
}
export const effectiveRate = (amount: string, book: string) =>
  d(book).div(amount).toDecimalPlaces(18).toFixed(18);
export function displayMoney(value: string, code: string) {
  // Format the exact decimal text; converting to Number would lose large balances.
  const [whole, fraction] = money(value).split(".");
  return `${code} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
