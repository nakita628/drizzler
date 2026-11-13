import { defineRelations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** メンバーの権限 */
export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);

/** サインインするユーザー */
export const user = pgTable("users", {
  /** 主キー */
  id: uuid("id").primaryKey().defaultRandom(),
  /** ログインに使うメールアドレス */
  email: varchar("email", { length: 255 }).notNull().unique(),
  /** 表示名 */
  name: varchar("name", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** ユーザーが所属する組織 */
export const organization = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** URL に使う識別子 */
    slug: varchar("slug", { length: 64 }).notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)],
);

/** ユーザーと組織の所属（複合主キー） */
export const member = pgTable(
  "members",
  {
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    role: memberRole("role").notNull().default("member"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.organizationId] }),
    index("members_organization_idx").on(t.organizationId),
    foreignKey({ columns: [t.userId], foreignColumns: [user.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organization.id] }).onDelete(
      "cascade",
    ),
  ],
);

/** 記事 */
export const post = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 書いたユーザー（退会すると null） */
    authorId: uuid("author_id").references(() => user.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade", onUpdate: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    published: boolean("published").notNull().default(false),
    tags: text("tags").array(),
  },
  (t) => [index("posts_author_idx").on(t.authorId)],
);

/** 記事へのコメント（返信は親コメントを指す） */
export const comment = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => post.id, { onDelete: "cascade" }),
  /** 返信先のコメント */
  parentId: uuid("parent_id").references((): AnyPgColumn => comment.id),
  body: text("body").notNull(),
  likes: integer("likes").notNull().default(0),
});

/** 操作の記録。外部キーは張らず、関係は defineRelations で示す */
export const auditLog = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 操作したユーザー（外部キーなし） */
  actorId: uuid("actor_id").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  at: timestamp("at").notNull().defaultNow(),
});

export const relations = defineRelations(
  { user, organization, member, post, comment, auditLog },
  (r) => ({
    user: {
      posts: r.many.post(),
      memberships: r.many.member(),
    },
    member: {
      user: r.one.user({ from: r.member.userId, to: r.user.id }),
    },
    post: {
      author: r.one.user({ from: r.post.authorId, to: r.user.id }),
      comments: r.many.comment(),
    },
    comment: {
      post: r.one.post({ from: r.comment.postId, to: r.post.id }),
    },
    auditLog: {
      actor: r.one.user({ from: r.auditLog.actorId, to: r.user.id }),
    },
  }),
);
