import { describe, expect, it } from "vite-plus/test";
import { PAGE_SIZE, pageWindow, rowIdentity } from "./paging.js";

describe("pageWindow", () => {
  it("places a page among the rows, counted from 1", () => {
    expect(pageWindow({ skip: 0, rowCount: PAGE_SIZE, total: 250 })).toStrictEqual({
      from: 1,
      to: 100,
      page: 1,
      pages: 3,
    });
    expect(pageWindow({ skip: 200, rowCount: 50, total: 250 })).toStrictEqual({
      from: 201,
      to: 250,
      page: 3,
      pages: 3,
    });
  });

  it("shows an empty table as nothing, on one page", () => {
    expect(pageWindow({ skip: 0, rowCount: 0, total: 0 })).toStrictEqual({
      from: 0,
      to: 0,
      page: 1,
      pages: 1,
    });
  });
});

describe("rowIdentity", () => {
  it("tells rows apart by their key, else by every column", () => {
    expect(rowIdentity(["id"], ["id", "name"])).toStrictEqual(["id"]);
    expect(rowIdentity([], ["id", "name"])).toStrictEqual(["id", "name"]);
  });
});
