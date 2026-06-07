export function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

export function isMarkdownPath(value: string, extensions: Set<string>): boolean {
  const ext = value.includes("/")
    ? value.split("/").pop()?.split(".").pop()
    : value.split(".").pop();
  if (!ext) return false;
  return extensions.has(`.${ext.toLowerCase()}`);
}
