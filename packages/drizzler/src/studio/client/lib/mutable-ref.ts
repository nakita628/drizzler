/**
 * A box for a value that outlives a render and is set from outside React, as `useRef` gives one
 * inside a component: module state that a callback reads at the time it runs.
 */
export function mutableRef<T>(initial: T): { current: T } {
  return { current: initial };
}
