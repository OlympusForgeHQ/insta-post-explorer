// Keep the existing compact payload limit without splitting a surrogate pair.
// A dangling surrogate serializes differently in HTML and React's JSON payload.
export function compactCaption(text: string): string {
  return text.slice(0, 500).replace(/[\uD800-\uDBFF]$/, "").toWellFormed();
}
