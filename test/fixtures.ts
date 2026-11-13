import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/** A SQLite schema with a foreign key and a relation that only `defineRelations` declares. */
export const SQLITE_SCHEMA = `import { defineRelations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Someone who writes */
export const user = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
});

/** A post */
export const post = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  authorId: integer("author_id")
    .notNull()
    .references(() => user.id),
  title: text("title").notNull(),
});

export const relations = defineRelations({ user, post }, (r) => ({
  user: { posts: r.many.post() },
  post: { author: r.one.user({ from: r.post.authorId, to: r.user.id }) },
}));
`;

/**
 * Creates the tables of SQLITE_SCHEMA in a database file, with the rows given.
 *
 * @param input.dir - the project directory
 * @param input.users - the users to insert, by name
 * @returns the database file's path
 */
export function makeSqliteDatabase(input: {
  readonly dir: string;
  readonly users: readonly string[];
}) {
  const file = path.join(input.dir, "dev.db");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL
    );
  `);
  const insert = db.prepare("INSERT INTO users (email, name) VALUES (?, ?)");
  for (const name of input.users) insert.run(`${name.toLowerCase()}@example.com`, name);
  db.close();
  return file;
}
