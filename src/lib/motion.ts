// CSS tooling may normalize 520ms to .52s, including custom properties.
export function cssDurationMs(value: string, fallback: number): number {
  const match = value.trim().match(/^(\d*\.?\d+)(ms|s)$/);
  return match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : fallback;
}
