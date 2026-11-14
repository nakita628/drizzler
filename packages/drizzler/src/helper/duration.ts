/**
 * A measured time as the studio shows it: milliseconds to a hundredth, so a fast statement does
 * not read as 0 and a slow one does not carry noise.
 *
 * @example durationMs(1.234567) // => 1.23
 */
export function durationMs(millis: number) {
  return Math.round(millis * 100) / 100;
}
