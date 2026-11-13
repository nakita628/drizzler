// The rows of sqlite/dev.db, given as they are: `pnpm -F @examples/studio seed` inserts them.
//
// No id is written by hand. Children are nested under their parent (`posts`, `tags`): the seeder
// numbers the parent and fills the child's key with it. A parent elsewhere is named by a key
// (`author: { email }`). `created_at` is left to its SQL default.
import { defineConfig } from "drizzler";

import * as schema from "./sqlite/schema.ts";

export default defineConfig(schema, {
  url: "file:./sqlite/dev.db",
  models: {
    tag: { data: [{ name: "history" }, { name: "os" }, { name: "hardware" }, { name: "ruby" }] },
    user: {
      data: [
        {
          email: "ada@example.com",
          name: "Ada Lovelace",
          isAdmin: true,
          posts: [
            {
              title: "Notes on the Analytical Engine",
              body: "The engine weaves algebraic patterns.",
              published: true,
              tags: [{ tag: { name: "history" } }],
            },
          ],
        },
        {
          email: "linus@example.com",
          name: "Linus Torvalds",
          posts: [
            {
              title: "Hello from Helsinki",
              body: "Just a hobby, won't be big.",
              published: true,
              tags: [{ tag: { name: "os" } }],
            },
          ],
        },
        {
          email: "grace@example.com",
          name: "Grace Hopper",
          posts: [
            {
              title: "Nanoseconds",
              body: "A foot of wire is a nanosecond.",
              tags: [{ tag: { name: "hardware" } }, { tag: { name: "history" } }],
            },
          ],
        },
        {
          email: "yukihiro@example.com",
          name: "まつもと ゆきひろ",
          posts: [
            {
              title: "たのしいプログラミング",
              body: "プログラマの幸せを考える。",
              published: true,
              tags: [{ tag: { name: "ruby" } }],
            },
          ],
        },
      ],
    },
    comment: {
      data: [
        {
          post: { title: "Notes on the Analytical Engine" },
          author: { email: "grace@example.com" },
          body: "Beautiful.",
        },
        {
          post: { title: "Hello from Helsinki" },
          author: { email: "ada@example.com" },
          body: "Famous last words.",
        },
        {
          post: { title: "たのしいプログラミング" },
          author: { email: "linus@example.com" },
          body: "いいね！",
        },
      ],
    },
  },
});
