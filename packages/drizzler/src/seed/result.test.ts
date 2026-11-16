import { describe, expect, it } from "vite-plus/test";
import { fail, forEach, ok } from "./result.js";

// A step that records each item it is given and fails on 2.
function failingAtTwo(tried: number[]) {
  return (n: number) => {
    tried.push(n);
    return n === 2 ? fail(`bad ${n}`) : ok(n);
  };
}

describe("forEach", () => {
  it("gives every value in order", () => {
    expect(forEach([1, 2, 3], (n, i) => ok(n * 10 + i))).toStrictEqual(ok([10, 21, 32]));
  });

  it("stops at the first failure, without trying the items after it", () => {
    const tried: number[] = [];
    const result = forEach([1, 2, 3, 4], failingAtTwo(tried));
    expect(result).toStrictEqual(fail("bad 2"));
    expect(tried).toStrictEqual([1, 2]);
  });

  it("gives an empty list for no items", () => {
    expect(forEach([], () => fail("never"))).toStrictEqual(ok([]));
  });
});
