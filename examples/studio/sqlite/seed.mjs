// Creates sqlite/dev.db with the tables of sqlite/schema.ts, then fills them with the rows of
// drizzler.config.ts through `drizzler seed`, so the studio has data to show. `--if-missing` leaves an
// existing database alone; without it the file is rebuilt.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const file = path.join(import.meta.dirname, "dev.db");
if (process.argv.includes("--if-missing") && fs.existsSync(file)) process.exit(0);
fs.rmSync(file, { force: true });

const db = new DatabaseSync(file);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX posts_author_idx ON posts(author_id);
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL
  );
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE post_tags (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
  );
`);
db.close();

// The rows come from drizzler.config.ts, inserted by the drizzler this example depends on.
const require = createRequire(import.meta.url);
const drizzler = path.join(path.dirname(require.resolve("drizzler/package.json")), "dist/cli.js");
execFileSync(process.execPath, [drizzler, "seed"], {
  cwd: path.join(import.meta.dirname, ".."),
  stdio: "inherit",
});
