import { describe, expect, it } from "vite-plus/test";
import { extractRelationsFromSchema, parseTableInfo } from "./extract-tables.js";

describe("parseTableInfo", () => {
  it.concurrent("parseTableInfo Test", () => {
    const result = parseTableInfo([
      "export const user = mysqlTable('user', {",
      "  /// Primary key",
      "  /// @z.uuid()",
      "  /// @v.pipe(v.string(), v.uuid())",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  /// Display name",
      "  /// @z.string().min(1).max(50)",
      "  /// @v.pipe(v.string(), v.minLength(1), v.maxLength(50))",
      "  name: varchar('name', { length: 50 }).notNull(),",
      "})",
      "",
      "export const post = mysqlTable('post', {",
      "  /// Primary key",
      "  /// @z.uuid()",
      "  /// @v.pipe(v.string(), v.uuid())",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  /// Article title",
      "  /// @z.string().min(1).max(100)",
      "  /// @v.pipe(v.string(), v.minLength(1), v.maxLength(100))",
      "  title: varchar('title', { length: 100 }).notNull(),",
      "  /// Body content (no length limit)",
      "  /// @z.string()",
      "  /// @v.string()",
      "  content: varchar('content', { length: 65535 }).notNull(),",
      "  /// Foreign key referencing User.id",
      "  /// @z.uuid()",
      "  /// @v.pipe(v.string(), v.uuid())",
      "  userId: varchar('user_id', { length: 36 }).notNull(),",
      "})",
      "",
      "export const userRelations = defineRelations({ user, post }, (r) => ({",
      "  user: {",
      "    posts: r.many.post(),",
      "  },",
      "}))",
      "",
      "export const postRelations = defineRelations({ post, user }, (r) => ({",
      "  post: {",
      "    user: r.one.user({ from: r.post.userId, to: r.user.id }),",
      "  },",
      "}))",
      "",
    ]);

    const expected = [
      {
        name: "user",
        description: null,
        fields: [
          {
            name: "id",
            type: "varchar",
            keyType: "PK",
            description: "Primary key",
          },
          {
            name: "name",
            type: "varchar",
            keyType: null,
            description: "Display name",
          },
        ],
      },
      {
        name: "post",
        description: null,
        fields: [
          {
            name: "id",
            type: "varchar",
            keyType: "PK",
            description: "Primary key",
          },
          {
            name: "title",
            type: "varchar",
            keyType: null,
            description: "Article title",
          },
          {
            name: "content",
            type: "varchar",
            keyType: null,
            description: "Body content (no length limit)",
          },
          {
            name: "userId",
            type: "varchar",
            keyType: null,
            description: "Foreign key referencing User.id",
          },
        ],
      },
    ];
    expect(result).toStrictEqual(expected);
  });

  it.concurrent("parses single table with PK and FK", () => {
    const result = parseTableInfo([
      "export const order = pgTable('order', {",
      "  id: serial('id').primaryKey(),",
      "  userId: integer('user_id').references(() => user.id),",
      "})",
    ]);
    expect(result).toStrictEqual([
      {
        name: "order",
        description: null,
        fields: [
          { name: "id", type: "serial", keyType: "PK", description: null },
          { name: "userId", type: "integer", keyType: "FK", description: null },
        ],
      },
    ]);
  });

  it.concurrent("parses SQLite table", () => {
    const result = parseTableInfo([
      "export const config = sqliteTable('config', {",
      "  key: text('key').primaryKey(),",
      "  value: text('value').notNull(),",
      "})",
    ]);
    expect(result).toStrictEqual([
      {
        name: "config",
        description: null,
        fields: [
          { name: "key", type: "text", keyType: "PK", description: null },
          { name: "value", type: "text", keyType: null, description: null },
        ],
      },
    ]);
  });

  it.concurrent("returns empty array for code with no tables", () => {
    const result = parseTableInfo(["const helper = () => {}", "export const something = 42"]);
    expect(result).toStrictEqual([]);
  });

  it.concurrent("skips relation definitions", () => {
    const result = parseTableInfo([
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "",
      "export const userRelations = defineRelations({ user, post }, (r) => ({",
      "  user: {",
      "    posts: r.many.post(),",
      "  },",
      "}))",
    ]);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("user");
  });
});

describe("extractRelationsFromSchema", () => {
  it.concurrent("extracts relations from foreignKey constraints", () => {
    const code = [
      "export const User = sqliteTable('User', {",
      "  id: text('id').notNull().primaryKey(),",
      "  name: text('name').notNull(),",
      "})",
      "",
      "export const Post = sqliteTable(",
      "  'Post',",
      "  {",
      "    id: text('id').notNull().primaryKey(),",
      "    userId: text('userId').notNull(),",
      "  },",
      "  (Post) => ({",
      "    Post_user_fkey: foreignKey({",
      "      name: 'Post_user_fkey',",
      "      columns: [Post.userId],",
      "      foreignColumns: [User.id],",
      "    }),",
      "  }),",
      ")",
    ];

    const relations = extractRelationsFromSchema(code);
    expect(relations).toStrictEqual([
      {
        fromModel: "User",
        toModel: "Post",
        fromField: "id",
        toField: "userId",
        isRequired: true,
        enforced: true,
        isUnique: false,
      },
    ]);
  });

  it.concurrent("extracts relations from defineRelations exports", () => {
    const code = [
      "export const User = sqliteTable('User', {",
      "  id: text('id').notNull().primaryKey(),",
      "})",
      "",
      "export const Post = sqliteTable('Post', {",
      "  id: text('id').notNull().primaryKey(),",
      "  userId: text('userId').notNull(),",
      "})",
      "",
      "export const PostRelations = defineRelations({ Post, User }, (r) => ({",
      "  Post: {",
      "    user: r.one.User({ from: r.Post.userId, to: r.User.id }),",
      "  },",
      "}))",
    ];

    const relations = extractRelationsFromSchema(code);
    expect(relations).toStrictEqual([
      {
        fromModel: "User",
        toModel: "Post",
        fromField: "id",
        toField: "userId",
        isRequired: true,
        enforced: false,
        isUnique: false,
      },
    ]);
  });

  it.concurrent("reads which side of a v2 relation holds the key, whatever `from` is", () => {
    const code = [
      "export const users = pgTable('users', {",
      "  id: integer('id').primaryKey(),",
      "  invitedBy: integer('invited_by'),",
      "})",
      "export const profileInfo = pgTable('profile_info', {",
      "  id: integer('id').primaryKey(),",
      "  userId: integer('user_id').notNull(),",
      "})",
      "export const groups = pgTable('groups', { id: integer('id').primaryKey() })",
      "export const usersToGroups = pgTable('users_to_groups', {",
      "  userId: integer('user_id').notNull(),",
      "  groupId: integer('group_id').notNull(),",
      "})",
      "export const posts = pgTable('posts', {",
      "  id: integer('id').primaryKey(),",
      "  authorId: integer('author_id'),",
      "  reviewerId: integer('reviewer_id'),",
      "})",
      "export const relations = defineRelations(schema, (r) => ({",
      "  users: {",
      "    profileInfo: r.one.profileInfo({ from: r.users.id, to: r.profileInfo.userId }),",
      "    invitee: r.one.users({ from: r.users.invitedBy, to: r.users.id }),",
      "    groups: r.many.groups({",
      "      from: r.users.id.through(r.usersToGroups.userId),",
      "      to: r.groups.id.through(r.usersToGroups.groupId),",
      "    }),",
      "    posts: r.many.posts({ alias: 'author' }),",
      "  },",
      "}))",
      "export const part = defineRelationsPart(schema, (r) => ({",
      "  posts: {",
      "    author: r.one.users({ from: r.posts.authorId, to: r.users.id, alias: 'author' }),",
      "    reviewer: r.one.users({ from: r.posts.reviewerId, to: r.users.id, optional: false }),",
      "  },",
      "}))",
    ];

    const pairs = extractRelationsFromSchema(code).map(
      (r) => `${r.fromModel}.${r.fromField} -> ${r.toModel}.${r.toField} ${r.isRequired}`,
    );
    expect(pairs).toStrictEqual([
      "users.id -> profileInfo.userId true",
      "users.id -> users.invitedBy false",
      "users.id -> usersToGroups.userId true",
      "groups.id -> usersToGroups.groupId true",
      "users.id -> posts.authorId false",
      "users.id -> posts.reviewerId true",
    ]);
  });

  it.concurrent("extracts relations from .references() calls", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),",
      "})",
    ];

    const relations = extractRelationsFromSchema(code);
    expect(relations).toStrictEqual([
      {
        fromModel: "user",
        toModel: "post",
        fromField: "id",
        toField: "userId",
        isRequired: true,
        enforced: true,
        isUnique: false,
      },
    ]);
  });

  it.concurrent("returns empty array when no relations exist", () => {
    const code = [
      "export const config = sqliteTable('config', {",
      "  key: text('key').primaryKey(),",
      "  value: text('value').notNull(),",
      "})",
    ];
    const relations = extractRelationsFromSchema(code);
    expect(relations).toStrictEqual([]);
  });

  it.concurrent("extracts optional FK without notNull", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).references(() => user.id),",
      "})",
    ];
    const relations = extractRelationsFromSchema(code);
    expect(relations).toStrictEqual([
      {
        fromModel: "user",
        toModel: "post",
        fromField: "id",
        toField: "userId",
        isRequired: false,
        enforced: true,
        isUnique: false,
      },
    ]);
  });

  it.concurrent("deduplicates relations from multiple sources", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),",
      "})",
      "",
      "export const postRelations = defineRelations({ post, user }, (r) => ({",
      "  post: {",
      "    user: r.one.user({ from: r.post.userId, to: r.user.id }),",
      "  },",
      "}))",
    ];
    const relations = extractRelationsFromSchema(code);
    // Should be deduplicated to 1 relation
    expect(relations.length).toBe(1);
    expect(relations[0]).toStrictEqual({
      fromModel: "user",
      toModel: "post",
      fromField: "id",
      toField: "userId",
      isRequired: true,
      enforced: true,
      isUnique: false,
    });
  });

  it.concurrent("extracts a relation when .references() carries an onDelete config", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),",
      "})",
    ];
    expect(extractRelationsFromSchema(code)).toStrictEqual([
      {
        fromModel: "user",
        toModel: "post",
        fromField: "id",
        toField: "userId",
        isRequired: true,
        enforced: true,
        isUnique: false,
      },
    ]);
  });

  it.concurrent("extracts a relation when .references() carries onDelete and onUpdate", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade', onUpdate: 'restrict' }),",
      "})",
    ];
    expect(extractRelationsFromSchema(code)).toStrictEqual([
      {
        fromModel: "user",
        toModel: "post",
        fromField: "id",
        toField: "userId",
        isRequired: true,
        enforced: true,
        isUnique: false,
      },
    ]);
  });

  it.concurrent("extracts a relation when the onDelete config spans multiple lines", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 })",
      "    .notNull()",
      "    .references(() => user.id, {",
      "      onDelete: 'cascade',",
      "    }),",
      "})",
    ];
    expect(extractRelationsFromSchema(code)).toStrictEqual([
      {
        fromModel: "user",
        toModel: "post",
        fromField: "id",
        toField: "userId",
        isRequired: true,
        enforced: true,
        isUnique: false,
      },
    ]);
  });

  it.concurrent("extracts foreignKey() from the array form of the constraints callback", () => {
    const code = [
      "export const user = pgTable('user', {",
      "  id: uuid('id').primaryKey(),",
      "})",
      "export const post = pgTable('post', {",
      "  authorId: uuid('author_id').notNull(),",
      "}, (t) => [",
      "  index('post_author_idx').on(t.authorId),",
      "  foreignKey({ columns: [t.authorId], foreignColumns: [user.id] }),",
      "])",
    ];
    expect(extractRelationsFromSchema(code)).toStrictEqual([
      {
        fromModel: "user",
        toModel: "post",
        fromField: "id",
        toField: "authorId",
        isRequired: true,
        enforced: true,
        isUnique: false,
      },
    ]);
  });
});

describe("schemas split over files, as layered projects write them", () => {
  // Two files joined as the CLI joins them: a helper with shared columns, and tables that are
  // declared plainly, built by a casing's `.table`, and exported in a list.
  const code = [
    "const timestamps = {",
    "  /** When the row was inserted */",
    "  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),",
    "};",
    "export { timestamps };",
    "",
    "const cartTable = snakeCase.table('cart', {",
    "  customerId: varchar({ length: 26 }).primaryKey(),",
    "  ...timestamps,",
    "});",
    "const cartItemTable = snakeCase.table('cart_item', {",
    "  customerId: varchar({ length: 26 }).notNull().references(() => cartTable.customerId),",
    "  productId: varchar({ length: 26 }).notNull(),",
    "  ...timestamps,",
    "}, (t) => [primaryKey({ columns: [t.customerId, t.productId] })]);",
    "const productTable = pgTable.withRLS('product', (t) => ({",
    "  productId: t.varchar({ length: 26 }).primaryKey(),",
    "}));",
    "export { cartTable, cartItemTable, productTable };",
    "",
    "const relations = defineRelations({ cartItemTable, productTable }, (r) => ({",
    "  cartItemTable: {",
    "    product: r.one.productTable({ from: r.cartItemTable.productId, to: r.productTable.productId }),",
    "  },",
    "}));",
    "export { relations };",
  ];

  it.concurrent("reads plain tables, casing builders, spread and callback columns", () => {
    expect(parseTableInfo(code)).toStrictEqual([
      {
        name: "cartTable",
        description: null,
        fields: [
          { name: "customerId", type: "varchar", keyType: "PK", description: null },
          {
            name: "createdAt",
            type: "timestamp",
            keyType: null,
            description: "When the row was inserted",
            withTimezone: true,
          },
        ],
      },
      {
        name: "cartItemTable",
        description: null,
        fields: [
          { name: "customerId", type: "varchar", keyType: "FK", description: null },
          { name: "productId", type: "varchar", keyType: null, description: null },
          {
            name: "createdAt",
            type: "timestamp",
            keyType: null,
            description: "When the row was inserted",
            withTimezone: true,
          },
        ],
      },
      {
        name: "productTable",
        description: null,
        fields: [{ name: "productId", type: "varchar", keyType: "PK", description: null }],
      },
    ]);
  });

  it.concurrent("reads foreign keys and relations that no foreign key backs", () => {
    expect(extractRelationsFromSchema(code)).toStrictEqual([
      {
        fromModel: "cartTable",
        toModel: "cartItemTable",
        fromField: "customerId",
        toField: "customerId",
        isRequired: true,
        enforced: true,
        isUnique: false,
      },
      {
        fromModel: "productTable",
        toModel: "cartItemTable",
        fromField: "productId",
        toField: "productId",
        isRequired: true,
        enforced: false,
        isUnique: false,
      },
    ]);
  });

  it.concurrent("marks a child column that is a key of its own as one-to-one", () => {
    const relations = extractRelationsFromSchema([
      "const customer = pgTable('customer', { id: varchar().primaryKey() });",
      "const cart = pgTable('cart', { customerId: varchar().primaryKey() });",
      "const relations = defineRelations({ customer, cart }, (r) => ({",
      "  cart: { customer: r.one.customer({ from: r.cart.customerId, to: r.customer.id }) },",
      "}));",
    ]);
    expect(relations.map((r) => [r.fromModel, r.toModel, r.isUnique])).toStrictEqual([
      ["customer", "cart", true],
    ]);
  });
});
