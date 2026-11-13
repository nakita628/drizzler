import { timestamp } from "drizzle-orm/pg-core";

/** Columns every table keeps */
const timestamps = {
  /** When the row was inserted */
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** When the row was last changed */
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
} as const;

export { timestamps };
