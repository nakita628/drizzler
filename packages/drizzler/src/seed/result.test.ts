import { describe, expect, it } from "vite-plus/test";
import { fail, forEach, ok } from "./result.js";

describe("forEach", () => {
  it("gives every value in order", () => {
    expect(forEach([1, 2, 3], (n, i) => ok(n * 10 + i))).toStrictEqual(ok([10, 21, 32]));
  });

  it("stops at the first failure, without trying the items after it", () => {
    const tried: number[] = [];
    const result = forEach([1, 2, 3, 4], (n) => {
      tried.push(n);
      return n === 2 ? fail(`bad ${n}`) : ok(n);
    });
    expect(result).toStrictEqual(fail("bad 2"));
    expect(tried).toStrictEqual([1, 2]);
  });

  it("gives an empty list for no items", () => {
    expect(forEach([], () => fail("never"))).toStrictEqual(ok([]));
  });
});
