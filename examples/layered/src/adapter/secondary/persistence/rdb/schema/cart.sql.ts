import { integer, snakeCase, varchar } from "drizzle-orm/pg-core";

import { timestamps } from "#/adapter/secondary/persistence/rdb/schema/columns.helpers.js";

/** A customer's cart, one per customer */
const cartTable = snakeCase.table("cart", {
  // The cart's id is its customer's: no foreign key, joined in the application
  customerId: varchar({ length: 26 }).primaryKey(),
  sequenceNumber: integer().notNull(),
  ...timestamps,
});

export { cartTable };
