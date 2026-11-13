import { describe, expect, it } from "vite-plus/test";
import { layoutSql } from "./sql-layout.js";

describe("layoutSql", () => {
  it("starts a line with each top-level clause", () => {
    expect(layoutSql('select "id" from "users" where "id" = $1 limit $2')).toBe(
      'select "id"\nfrom "users"\nwhere "id" = $1\nlimit $2',
    );
    expect(layoutSql('update "users" set "name" = $1 where "users"."id" = $2')).toBe(
      'update "users"\nset "name" = $1\nwhere "users"."id" = $2',
    );
    expect(layoutSql('insert into "users" ("id", "name") values (default, $1)')).toBe(
      'insert into "users" ("id", "name")\nvalues (default, $1)',
    );
  });

  it("keeps DELETE FROM together and a subquery on its line", () => {
    expect(layoutSql('delete from "users" where "users"."id" = $1')).toBe(
      'delete from "users"\nwhere "users"."id" = $1',
    );
    expect(
      layoutSql(
        'select "d0"."id" from "users" as "d0" left join lateral(select 1 from "posts" where true) as "p" on true order by "d0"."id"',
      ),
    ).toBe(
      'select "d0"."id"\nfrom "users" as "d0"\nleft join lateral(select 1 from "posts" where true) as "p" on true\norder by "d0"."id"',
    );
  });

  it("returns SQL it cannot read as it is", () => {
    expect(layoutSql("select 'unterminated")).toBe("select 'unterminated");
  });
});
