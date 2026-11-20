export const maximumBulkUnits = 500;

export function generateUnitNames(
  startingName: string,
  count: number,
): { names: string[]; error: string | null } {
  const trimmedName = startingName.trim();
  if (!trimmedName) return { names: [], error: "Enter a starting room name." };
  if (!Number.isInteger(count) || count < 1 || count > maximumBulkUnits) {
    return {
      names: [],
      error: `Enter a whole number between 1 and ${maximumBulkUnits}.`,
    };
  }
  const match = /^(.*?)(\d+)([^\d].*)?$/.exec(trimmedName);
  if (!match) {
    return {
      names: [],
      error: "The starting name must include a number, such as 001-R.",
    };
  }
  const start = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(start + count - 1)) {
    return { names: [], error: "The room number range is too large." };
  }
  const prefix = match[1];
  const suffix = match[3] ?? "";
  const width = match[2].length;
  const names = Array.from({ length: count }, (_value, index) =>
    `${prefix}${String(start + index).padStart(width, "0")}${suffix}`,
  );
  if (names.some((name) => name.length > 100)) {
    return { names: [], error: "Generated room names must be 100 characters or fewer." };
  }
  return { names, error: null };
}
