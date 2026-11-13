import { snakeCase, varchar } from "drizzle-orm/pg-core";

import { timestamps } from "#/adapter/secondary/persistence/rdb/schema/columns.helpers.js";

/** Someone who shops */
const customerTable = snakeCase.table("customer", {
  customerId: varchar({ length: 26 }).primaryKey(),
  name: varchar({ length: 100 }).notNull(),
  email: varchar({ length: 255 }).notNull().unique(),
  ...timestamps,
});

export { customerTable };
