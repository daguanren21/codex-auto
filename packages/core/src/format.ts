const trimTrailingZeros = (value: string): string => value.replace(/\.0+$|(?<=\.\d*[1-9])0+$/, "");

export function formatTokens(tokens: number): string {
  const value = Math.max(0, Math.trunc(tokens));
  if (value < 1_000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return `${trimTrailingZeros((value / 1_000).toFixed(1))}k`;
  }
  return `${trimTrailingZeros((value / 1_000_000).toFixed(2))}m`;
}

