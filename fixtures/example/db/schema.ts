import { defineRelations } from "drizzle-orm";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";

export const user = mysqlTable("user", {
  /** Primary key */
  id: varchar("id", { length: 36 }).primaryKey(),
  /** Display name */
  name: varchar("name", { length: 50 }).notNull(),
});

export const post = mysqlTable("post", {
  /** Primary key */
  id: varchar("id", { length: 36 }).primaryKey(),
  /** Article title */
  title: varchar("title", { length: 100 }).notNull(),
  /** Body content (no length limit) */
  content: varchar("content", { length: 65535 }).notNull(),
  /** Foreign key referencing User.id */
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => user.id),
});

export const relations = defineRelations({ user, post }, (r) => ({
  user: {
    posts: r.many.post(),
  },
  post: {
    user: r.one.user({ from: r.post.userId, to: r.user.id }),
  },
}));
