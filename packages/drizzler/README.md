# Drizzler

ER diagrams, DBML and table docs from a [Drizzle](https://orm.drizzle.team/) schema, with a local studio and seeder.

## Installation

```bash
npm install -D drizzler
```

## Usage

```bash
npx drizzler db/schema.ts -o docs/         # table docs: README.md and ER diagrams
npx drizzler db/schema.ts -o docs/er.svg   # one file: .svg, .png, .md (Mermaid) or .dbml
npx drizzler studio db/schema.ts           # the local studio
npx drizzler seed                          # fill the database from drizzler.config.ts
```

Without an input, drizzler reads the `schema` of `drizzle.config.ts`.

## License

MIT
