export function formatCents(value: string, currency: string): string {
  const cents = BigInt(value);
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  const formattedWhole = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(whole);
  const decimalSeparator = new Intl.NumberFormat().formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? ".";
  const formattedFraction = new Intl.NumberFormat(undefined, {
    minimumIntegerDigits: 2,
    useGrouping: false,
  }).format(Number(fraction));
  return `${formattedWhole}${decimalSeparator}${formattedFraction}`;
}
