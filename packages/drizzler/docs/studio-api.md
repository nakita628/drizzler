<h1 id="drizzler-studio-api">Drizzler Studio API v1.0.0</h1>

> Scroll down for code samples, example requests and responses. Select a language for code samples from the tabs above or the mobile navigation menu.

Local API behind `drizzler studio`: the Drizzle schema file on disk, its ER diagram and docs,
the formatter, the project's TypeScript for the editor, and the connected database. It listens on loopback only and has no
authentication, so nothing here is reachable from another origin.

<h1 id="drizzler-studio-api-schema">schema</h1>

## readSchema

<a id="opIdreadSchema"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/schema \
  -H 'Accept: application/json'
```

`GET /schema`

The schema file as it is on disk.

> Example responses

> 200 Response

```json
{
  "path": "string",
  "file": "string",
  "source": "string",
  "parseError": {
    "message": "Expected `)` but found `EOF`",
    "line": 12,
    "column": 3
  }
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="readschema-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Snapshot](#schemasnapshot)                           |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## writeSchema

<a id="opIdwriteSchema"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/schema \
  -X PUT \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string"
  }'
```

`PUT /schema`

Write the schema file.

> Body parameter

```json
{
  "source": "string"
}
```

<h3 id="writeschema-parameters">Parameters</h3>

| Name     | In   | Type                        | Required | Description    |
| -------- | ---- | --------------------------- | -------- | -------------- |
| body     | body | [SaveBody](#schemasavebody) | true     | none           |
| » source | body | string                      | true     | The whole file |

> Example responses

> 200 Response

```json
{
  "path": "string",
  "file": "string",
  "source": "string",
  "parseError": {
    "message": "Expected `)` but found `EOF`",
    "line": 12,
    "column": 3
  }
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="writeschema-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Snapshot](#schemasnapshot)                           |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)         |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## readSchemaEvents

<a id="opIdreadSchemaEvents"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/schema/events
```

`GET /schema/events`

A `change` event whenever the schema file changes on disk.

<h3 id="readschemaevents-responses">Responses</h3>

| Status | Meaning | Description                | Schema |
| ------ | ------- | -------------------------- | ------ |
| 200    | OK      | The request has succeeded. | Inline |

<aside class="success">
This operation does not require authentication
</aside>

<h1 id="drizzler-studio-api-diagram">diagram</h1>

## drawSchema

<a id="opIddrawSchema"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/diagram/schema \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string",
    "document": {}
  }'
```

`POST /diagram/schema`

The ER diagram of a schema as data: tables, relations, enums and where each table is declared.

> Body parameter

```json
{
  "source": "string",
  "document": {}
}
```

<h3 id="drawschema-parameters">Parameters</h3>

| Name       | In   | Type                            | Required | Description                                          |
| ---------- | ---- | ------------------------------- | -------- | ---------------------------------------------------- |
| body       | body | [SourceBody](#schemasourcebody) | true     | none                                                 |
| » source   | body | string                          | true     | The schema source, saved or not, or the query        |
| » document | body | object                          | false    | Which editor it comes from; the schema when left out |

> Example responses

> 200 Response

```json
{
  "schema": {
    "models": [
      {
        "name": "string",
        "dbName": "string",
        "documentation": "string",
        "primaryKey": ["string"],
        "fields": [
          {
            "name": "string",
            "dbName": "string",
            "kind": "scalar",
            "type": "string",
            "isList": true,
            "isRequired": true,
            "isId": true,
            "isUnique": true,
            "isForeignKey": true,
            "documentation": "string",
            "attributes": ["string"]
          }
        ],
        "indexes": [
          {
            "type": "id",
            "fields": ["string"]
          }
        ],
        "lines": {
          "start": 0,
          "end": 0
        }
      }
    ],
    "relations": [
      {
        "id": "string",
        "origin": "inferred",
        "name": "string",
        "onDelete": "string",
        "onUpdate": "string",
        "from": {
          "model": "string",
          "field": "string",
          "cardinality": "one"
        },
        "to": {
          "model": "string",
          "field": "string",
          "cardinality": "one"
        }
      }
    ],
    "enums": [
      {
        "name": "string",
        "dbName": "string",
        "documentation": "string",
        "values": [
          {
            "name": "string",
            "dbName": "string"
          }
        ]
      }
    ]
  },
  "parseError": {
    "message": "Expected `)` but found `EOF`",
    "line": 12,
    "column": 3
  }
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="drawschema-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [DiagramData](#schemadiagramdata)                     |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)         |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## drawSvg

<a id="opIddrawSvg"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/diagram/svg \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string",
    "theme": {}
  }'
```

`POST /diagram/svg`

The ER diagram of a schema as SVG.

> Body parameter

```json
{
  "source": "string",
  "theme": {}
}
```

<h3 id="drawsvg-parameters">Parameters</h3>

| Name     | In   | Type                              | Required | Description                            |
| -------- | ---- | --------------------------------- | -------- | -------------------------------------- |
| body     | body | [DiagramBody](#schemadiagrambody) | true     | none                                   |
| » source | body | string                            | true     | The schema source                      |
| » theme  | body | object                            | false    | The colour scheme; light when left out |

> Example responses

> 200 Response

```json
{
  "svg": "string",
  "parseError": {
    "message": "Expected `)` but found `EOF`",
    "line": 12,
    "column": 3
  }
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="drawsvg-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Diagram](#schemadiagram)                             |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)         |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## drawPng

<a id="opIddrawPng"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/diagram/png \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string",
    "theme": {}
  }'
```

`POST /diagram/png`

The ER diagram of a schema as PNG.

> Body parameter

```json
{
  "source": "string",
  "theme": {}
}
```

<h3 id="drawpng-parameters">Parameters</h3>

| Name     | In   | Type                              | Required | Description                            |
| -------- | ---- | --------------------------------- | -------- | -------------------------------------- |
| body     | body | [DiagramBody](#schemadiagrambody) | true     | none                                   |
| » source | body | string                            | true     | The schema source                      |
| » theme  | body | object                            | false    | The colour scheme; light when left out |

> Example responses

> 200 Response

```json
{
  "base64": "string"
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="drawpng-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Png](#schemapng)                                     |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)         |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

<h1 id="drizzler-studio-api-format">format</h1>

## formatSource

<a id="opIdformatSource"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/format \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string"
  }'
```

`POST /format`

Format a schema with oxfmt; a source that does not parse is a 422.

> Body parameter

```json
{
  "source": "string"
}
```

<h3 id="formatsource-parameters">Parameters</h3>

| Name     | In   | Type                            | Required | Description       |
| -------- | ---- | ------------------------------- | -------- | ----------------- |
| body     | body | [FormatBody](#schemaformatbody) | true     | none              |
| » source | body | string                          | true     | The schema source |

> Example responses

> 200 Response

```json
{
  "source": "string"
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="formatsource-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Formatted](#schemaformatted)                         |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)         |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

<h1 id="drizzler-studio-api-docs">docs</h1>

## readDocs

<a id="opIdreadDocs"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/docs \
  -H 'Accept: application/json'
```

`GET /docs`

The generated documentation of the saved schema.

> Example responses

> 200 Response

```json
{
  "tables": [
    {
      "name": "string",
      "dbName": "string",
      "description": "string",
      "columns": [
        {
          "name": "string",
          "dbName": "string",
          "type": "string",
          "nullable": true,
          "primaryKey": true,
          "unique": true,
          "isList": true,
          "enumName": "string",
          "defaults": ["string"],
          "description": "string",
          "references": {
            "table": "string",
            "column": "string"
          }
        }
      ],
      "indexes": [
        {
          "type": "id",
          "columns": ["string"]
        }
      ],
      "references": [
        {
          "table": "string",
          "column": "string",
          "otherColumn": "string",
          "kind": "string",
          "origin": "string",
          "onDelete": "string",
          "onUpdate": "string"
        }
      ],
      "referencedBy": [
        {
          "table": "string",
          "column": "string",
          "otherColumn": "string",
          "kind": "string",
          "origin": "string",
          "onDelete": "string",
          "onUpdate": "string"
        }
      ],
      "queries": [
        {
          "name": "string",
          "description": "string",
          "code": "string"
        }
      ]
    }
  ],
  "enums": [
    {
      "name": "string",
      "dbName": "string",
      "description": "string",
      "values": ["string"]
    }
  ],
  "parseError": {
    "message": "Expected `)` but found `EOF`",
    "line": 12,
    "column": 3
  }
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="readdocs-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Docs](#schemadocs)                                   |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

<h1 id="drizzler-studio-api-db">db</h1>

## readDbStatus

<a id="opIdreadDbStatus"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/db \
  -H 'Accept: application/json'
```

`GET /db`

The database connection and the tables of the schema.

> Example responses

> 200 Response

```json
{
  "connected": true,
  "dialect": "sqlite",
  "url": "string",
  "error": "string",
  "tables": [
    {
      "name": "string",
      "table": "string",
      "columns": [
        {
          "name": "string",
          "column": "string",
          "type": "string",
          "nullable": true
        }
      ],
      "key": ["string"]
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="readdbstatus-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [DbStatus](#schemadbstatus)                           |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## readCounts

<a id="opIdreadCounts"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/db/counts \
  -H 'Accept: application/json'
```

`GET /db/counts`

The row count of every table.

> Example responses

> 200 Response

```json
{
  "counts": {
    "property1": 0,
    "property2": 0
  }
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="readcounts-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Counts](#schemacounts)                                       |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## readRows

<a id="opIdreadRows"></a>

> Code samples

```bash
curl 'http://127.0.0.1:4983/api/db/rows/string?skip=0&take=1' \
  -H 'Accept: application/json'
```

`GET /db/rows/{tableName}`

One page of a table's rows, ordered by its key.

<h3 id="readrows-parameters">Parameters</h3>

| Name      | In    | Type                          | Required | Description                                                                         |
| --------- | ----- | ----------------------------- | -------- | ----------------------------------------------------------------------------------- |
| tableName | path  | [tableName](#schematablename) | true     | none                                                                                |
| skip      | query | [skip](#schemaskip)           | true     | Rows to skip before the page                                                        |
| take      | query | [take](#schematake)           | true     | Rows per page                                                                       |
| search    | query | string                        | false    | Text to look for in any column, case-insensitively; empty or absent reads every row |

> Example responses

> 200 Response

```json
{
  "rows": [
    {
      "property1": "string",
      "property2": "string"
    }
  ],
  "total": 0,
  "skip": 0,
  "take": 0,
  "search": "string"
}
```

> 404 Response

```json
{
  "type": "/problems/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Unknown table \"nope\".",
  "instance": "/api/db/rows/nope"
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="readrows-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Rows](#schemarows)                                           |
| 404    | Not Found             | 404 Not Found (`application/problem+json`)             | [NotFoundProblem](#schemanotfoundproblem)                     |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## createRow

<a id="opIdcreateRow"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/db/rows/string \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "values": {
      "property1": "string",
      "property2": "string"
    }
  }'
```

`POST /db/rows/{tableName}`

Insert one row.

> Body parameter

```json
{
  "values": {
    "property1": "string",
    "property2": "string"
  }
}
```

<h3 id="createrow-parameters">Parameters</h3>

| Name                         | In   | Type                                        | Required | Description                                  |
| ---------------------------- | ---- | ------------------------------------------- | -------- | -------------------------------------------- |
| tableName                    | path | [tableName](#schematablename)               | true     | none                                         |
| body                         | body | [InsertBody](#schemainsertbody)             | true     | none                                         |
| » values                     | body | object                                      | true     | The values to insert, keyed by property name |
| » » **additionalProperties** | body | string \| number(double) \| boolean \| null | false    | none                                         |
| » » » _anyOf_                | body | string                                      | false    | none                                         |
| » » » _anyOf_                | body | number(double)                              | false    | none                                         |
| » » » _anyOf_                | body | boolean                                     | false    | none                                         |

> Example responses

> 200 Response

```json
{
  "count": 0
}
```

> 404 Response

```json
{
  "type": "/problems/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Unknown table \"nope\".",
  "instance": "/api/db/rows/nope"
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="createrow-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Affected](#schemaaffected)                                   |
| 404    | Not Found             | 404 Not Found (`application/problem+json`)             | [NotFoundProblem](#schemanotfoundproblem)                     |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## deleteRow

<a id="opIddeleteRow"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/db/rows/string \
  -X DELETE \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "where": {
      "property1": "string",
      "property2": "string"
    }
  }'
```

`DELETE /db/rows/{tableName}`

Delete the row identified by `where`.

> Body parameter

```json
{
  "where": {
    "property1": "string",
    "property2": "string"
  }
}
```

<h3 id="deleterow-parameters">Parameters</h3>

| Name                         | In   | Type                                        | Required | Description                          |
| ---------------------------- | ---- | ------------------------------------------- | -------- | ------------------------------------ |
| tableName                    | path | [tableName](#schematablename)               | true     | none                                 |
| body                         | body | [DeleteBody](#schemadeletebody)             | true     | none                                 |
| » where                      | body | object                                      | true     | The key columns of the row to delete |
| » » **additionalProperties** | body | string \| number(double) \| boolean \| null | false    | none                                 |
| » » » _anyOf_                | body | string                                      | false    | none                                 |
| » » » _anyOf_                | body | number(double)                              | false    | none                                 |
| » » » _anyOf_                | body | boolean                                     | false    | none                                 |

> Example responses

> 200 Response

```json
{
  "count": 0
}
```

> 404 Response

```json
{
  "type": "/problems/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Unknown table \"nope\".",
  "instance": "/api/db/rows/nope"
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="deleterow-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Affected](#schemaaffected)                                   |
| 404    | Not Found             | 404 Not Found (`application/problem+json`)             | [NotFoundProblem](#schemanotfoundproblem)                     |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## updateRow

<a id="opIdupdateRow"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/db/rows/string \
  -X PATCH \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "where": {
      "property1": "string",
      "property2": "string"
    },
    "values": {
      "property1": "string",
      "property2": "string"
    }
  }'
```

`PATCH /db/rows/{tableName}`

Update the row identified by `where`.

> Body parameter

```json
{
  "where": {
    "property1": "string",
    "property2": "string"
  },
  "values": {
    "property1": "string",
    "property2": "string"
  }
}
```

<h3 id="updaterow-parameters">Parameters</h3>

| Name                         | In   | Type                                        | Required | Description                          |
| ---------------------------- | ---- | ------------------------------------------- | -------- | ------------------------------------ |
| tableName                    | path | [tableName](#schematablename)               | true     | none                                 |
| body                         | body | [UpdateBody](#schemaupdatebody)             | true     | none                                 |
| » where                      | body | object                                      | true     | The key columns of the row to change |
| » » **additionalProperties** | body | string \| number(double) \| boolean \| null | false    | none                                 |
| » » » _anyOf_                | body | string                                      | false    | none                                 |
| » » » _anyOf_                | body | number(double)                              | false    | none                                 |
| » » » _anyOf_                | body | boolean                                     | false    | none                                 |
| » values                     | body | object                                      | true     | The columns to set                   |
| » » **additionalProperties** | body | string \| number(double) \| boolean \| null | false    | none                                 |
| » » » _anyOf_                | body | string                                      | false    | none                                 |
| » » » _anyOf_                | body | number(double)                              | false    | none                                 |
| » » » _anyOf_                | body | boolean                                     | false    | none                                 |

> Example responses

> 200 Response

```json
{
  "count": 0
}
```

> 404 Response

```json
{
  "type": "/problems/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Unknown table \"nope\".",
  "instance": "/api/db/rows/nope"
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="updaterow-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Affected](#schemaaffected)                                   |
| 404    | Not Found             | 404 Not Found (`application/problem+json`)             | [NotFoundProblem](#schemanotfoundproblem)                     |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## runSql

<a id="opIdrunSql"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/db/sql \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "sql": "string",
    "params": [
      "string"
    ]
  }'
```

`POST /db/sql`

Run the statements one by one; the result is the last one's, the time the whole's.

> Body parameter

```json
{
  "sql": "string",
  "params": ["string"]
}
```

<h3 id="runsql-parameters">Parameters</h3>

| Name        | In   | Type                                          | Required | Description                                                                   |
| ----------- | ---- | --------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| body        | body | [SqlBody](#schemasqlbody)                     | true     | none                                                                          |
| » sql       | body | string                                        | true     | The statements; several are run one by one and the result belongs to the last |
| » params    | body | [string \| number(double) \| boolean \| null] | false    | The values bound to the placeholders, in order; omitted means none            |
| » » _anyOf_ | body | string                                        | false    | none                                                                          |
| » » _anyOf_ | body | number(double)                                | false    | none                                                                          |
| » » _anyOf_ | body | boolean                                       | false    | none                                                                          |

> Example responses

> 200 Response

```json
{
  "columns": ["string"],
  "rows": [
    {
      "property1": "string",
      "property2": "string"
    }
  ],
  "rowCount": 0,
  "durationMs": 0
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="runsql-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [SqlResult](#schemasqlresult)                                 |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## explainSql

<a id="opIdexplainSql"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/db/explain \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "sql": "string",
    "params": [
      "string"
    ]
  }'
```

`POST /db/explain`

The execution plan the database chooses for the first statement of the text.

> Body parameter

```json
{
  "sql": "string",
  "params": ["string"]
}
```

<h3 id="explainsql-parameters">Parameters</h3>

| Name        | In   | Type                                          | Required | Description                                                                   |
| ----------- | ---- | --------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| body        | body | [SqlBody](#schemasqlbody)                     | true     | none                                                                          |
| » sql       | body | string                                        | true     | The statements; several are run one by one and the result belongs to the last |
| » params    | body | [string \| number(double) \| boolean \| null] | false    | The values bound to the placeholders, in order; omitted means none            |
| » » _anyOf_ | body | string                                        | false    | none                                                                          |
| » » _anyOf_ | body | number(double)                                | false    | none                                                                          |
| » » _anyOf_ | body | boolean                                       | false    | none                                                                          |

> Example responses

> 200 Response

```json
{
  "dialect": "sqlite",
  "nodes": [],
  "raw": ""
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="explainsql-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Plan](#schemaplan)                                           |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## analyzeSql

<a id="opIdanalyzeSql"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/db/analyze \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "sql": "SELECT id, email FROM users WHERE id = ?"
  }'
```

`POST /db/analyze`

Analyze the statements against the saved schema's tables: data flow, lineage, row type, parameters and problems.

> Body parameter

```json
{
  "sql": "SELECT id, email FROM users WHERE id = ?"
}
```

<h3 id="analyzesql-parameters">Parameters</h3>

| Name  | In   | Type                              | Required | Description    |
| ----- | ---- | --------------------------------- | -------- | -------------- |
| body  | body | [AnalyzeBody](#schemaanalyzebody) | true     | none           |
| » sql | body | string                            | true     | The statements |

> Example responses

> 200 Response

```json
{
  "statements": [
    {
      "kind": {},
      "text": "string",
      "range": {
        "start": 0,
        "end": 0
      },
      "nodes": [
        {
          "id": "n3",
          "kind": "filter",
          "label": "WHERE",
          "details": ["u.id = ?"],
          "range": {
            "start": 40,
            "end": 48
          },
          "scope": "main",
          "columns": []
        }
      ],
      "edges": [
        {
          "id": "n1->n3:0",
          "source": "n1",
          "target": "n3",
          "label": null,
          "kind": "flow"
        }
      ],
      "tables": [
        {
          "nodeId": "n1",
          "name": "users",
          "alias": "u",
          "scope": "main",
          "known": true,
          "columnsUsed": ["id", "email"],
          "range": {
            "start": 20,
            "end": 25
          }
        }
      ],
      "columns": [
        {
          "name": "email",
          "expression": "u.email",
          "dataType": "TEXT",
          "tsType": "string",
          "nullable": true,
          "sources": [
            {
              "table": "users",
              "column": "email"
            }
          ]
        }
      ],
      "parameters": [
        {
          "index": 1,
          "placeholder": "?",
          "dataType": "INTEGER",
          "tsType": "number",
          "nullable": false,
          "context": "u.id = ?"
        }
      ],
      "diagnostics": [
        {
          "severity": "warning",
          "message": "Unknown column \"nmae\"",
          "range": {
            "start": 7,
            "end": 11
          }
        }
      ],
      "rowType": "string",
      "paramsType": "string"
    }
  ]
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="analyzesql-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Analysis](#schemaanalysis)                           |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)         |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

<h1 id="drizzler-studio-api-language">language</h1>

## readLanguageStatus

<a id="opIdreadLanguageStatus"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/language \
  -H 'Accept: application/json'
```

`GET /language`

Whether the project's TypeScript is loaded, and why not when it is not.

> Example responses

> 200 Response

```json
{
  "typescript": "string",
  "reason": "string"
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="readlanguagestatus-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [LanguageStatus](#schemalanguagestatus)               |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## complete

<a id="opIdcomplete"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/language/complete \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string",
    "document": {},
    "offset": 0
  }'
```

`POST /language/complete`

The completions at the cursor.

> Body parameter

```json
{
  "source": "string",
  "document": {},
  "offset": 0
}
```

<h3 id="complete-parameters">Parameters</h3>

| Name       | In   | Type                                | Required | Description                                          |
| ---------- | ---- | ----------------------------------- | -------- | ---------------------------------------------------- |
| body       | body | [PositionBody](#schemapositionbody) | true     | none                                                 |
| » source   | body | string                              | true     | The schema source, saved or not, or the query        |
| » document | body | object                              | false    | Which editor it comes from; the schema when left out |
| » offset   | body | integer(int32)                      | true     | The UTF-16 offset of the cursor                      |

> Example responses

> 200 Response

```json
{
  "items": [
    {
      "label": "string",
      "kind": "string",
      "sortText": "string",
      "insertText": "string",
      "replacement": {
        "start": 0,
        "end": 0
      }
    }
  ]
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="complete-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Completions](#schemacompletions)                             |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## completeDetail

<a id="opIdcompleteDetail"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/language/complete/detail \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string",
    "document": {},
    "offset": 0,
    "name": "string"
  }'
```

`POST /language/complete/detail`

The type and documentation of one completion.

> Body parameter

```json
{
  "source": "string",
  "document": {},
  "offset": 0,
  "name": "string"
}
```

<h3 id="completedetail-parameters">Parameters</h3>

| Name       | In   | Type                                                | Required | Description                                          |
| ---------- | ---- | --------------------------------------------------- | -------- | ---------------------------------------------------- |
| body       | body | [CompletionDetailBody](#schemacompletiondetailbody) | true     | none                                                 |
| » source   | body | string                                              | true     | The schema source, saved or not, or the query        |
| » document | body | object                                              | false    | Which editor it comes from; the schema when left out |
| » offset   | body | integer(int32)                                      | true     | The UTF-16 offset of the cursor                      |
| » name     | body | string                                              | true     | The name of the completion                           |

> Example responses

> 200 Response

```json
{
  "detail": "string",
  "documentation": "string"
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="completedetail-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [CompletionDetail](#schemacompletiondetail)                   |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## hover

<a id="opIdhover"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/language/hover \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string",
    "document": {},
    "offset": 0
  }'
```

`POST /language/hover`

What TypeScript says about the symbol at the cursor.

> Body parameter

```json
{
  "source": "string",
  "document": {},
  "offset": 0
}
```

<h3 id="hover-parameters">Parameters</h3>

| Name       | In   | Type                                | Required | Description                                          |
| ---------- | ---- | ----------------------------------- | -------- | ---------------------------------------------------- |
| body       | body | [PositionBody](#schemapositionbody) | true     | none                                                 |
| » source   | body | string                              | true     | The schema source, saved or not, or the query        |
| » document | body | object                              | false    | Which editor it comes from; the schema when left out |
| » offset   | body | integer(int32)                      | true     | The UTF-16 offset of the cursor                      |

> Example responses

> 200 Response

```json
{
  "contents": "string",
  "range": {
    "start": 0,
    "end": 0
  }
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="hover-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Hover](#schemahover)                                         |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## signature

<a id="opIdsignature"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/language/signature \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string",
    "document": {},
    "offset": 0
  }'
```

`POST /language/signature`

The signatures of the call the cursor is in.

> Body parameter

```json
{
  "source": "string",
  "document": {},
  "offset": 0
}
```

<h3 id="signature-parameters">Parameters</h3>

| Name       | In   | Type                                | Required | Description                                          |
| ---------- | ---- | ----------------------------------- | -------- | ---------------------------------------------------- |
| body       | body | [PositionBody](#schemapositionbody) | true     | none                                                 |
| » source   | body | string                              | true     | The schema source, saved or not, or the query        |
| » document | body | object                              | false    | Which editor it comes from; the schema when left out |
| » offset   | body | integer(int32)                      | true     | The UTF-16 offset of the cursor                      |

> Example responses

> 200 Response

```json
{
  "signatures": [
    {
      "label": "string",
      "documentation": "string",
      "parameters": [
        {
          "label": "string",
          "documentation": "string"
        }
      ]
    }
  ],
  "activeSignature": 0,
  "activeParameter": 0
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="signature-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [SignatureHelp](#schemasignaturehelp)                         |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## diagnostics

<a id="opIddiagnostics"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/language/diagnostics \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "source": "string",
    "document": {}
  }'
```

`POST /language/diagnostics`

The type errors of the source.

> Body parameter

```json
{
  "source": "string",
  "document": {}
}
```

<h3 id="diagnostics-parameters">Parameters</h3>

| Name       | In   | Type                            | Required | Description                                          |
| ---------- | ---- | ------------------------------- | -------- | ---------------------------------------------------- |
| body       | body | [SourceBody](#schemasourcebody) | true     | none                                                 |
| » source   | body | string                          | true     | The schema source, saved or not, or the query        |
| » document | body | object                          | false    | Which editor it comes from; the schema when left out |

> Example responses

> 200 Response

```json
{
  "diagnostics": [
    {
      "message": "string",
      "severity": "error",
      "range": {
        "start": 0,
        "end": 0
      }
    }
  ]
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="diagnostics-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [Diagnostics](#schemadiagnostics)                             |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

<h1 id="drizzler-studio-api-drizzle">drizzle</h1>

## runQuery

<a id="opIdrunQuery"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/drizzle \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "code": "string"
  }'
```

`POST /drizzle`

Run Drizzle code against the connected database. Code that does not parse, or a schema that
does not, is a 422; an error the code throws is reported in the result with the statements
that ran before it.

> Body parameter

```json
{
  "code": "string"
}
```

<h3 id="runquery-parameters">Parameters</h3>

| Name   | In   | Type                          | Required | Description                                                                                                                               |
| ------ | ---- | ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| body   | body | [QueryBody](#schemaquerybody) | true     | none                                                                                                                                      |
| » code | body | string                        | true     | The body of an async function with `db`, the schema's exports and drizzle-orm's operators<br>in scope; its last expression is the result. |

> Example responses

> 200 Response

```json
{
  "result": null,
  "error": "string",
  "statements": [
    {
      "sql": "string",
      "params": [null],
      "rowCount": 0,
      "durationMs": 0
    }
  ],
  "durationMs": 0
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

> 503 Response

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

<h3 id="runquery-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                        |
| ------ | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [QueryResult](#schemaqueryresult)                             |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)                 |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem)         |
| 503    | Service Unavailable   | 503 Service Unavailable (`application/problem+json`)   | [ServiceUnavailableProblem](#schemaserviceunavailableproblem) |

<aside class="success">
This operation does not require authentication
</aside>

## touchedByQuery

<a id="opIdtouchedByQuery"></a>

> Code samples

```bash
curl http://127.0.0.1:4983/api/drizzle/touched \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "code": "string"
  }'
```

`POST /drizzle/touched`

The tables and columns Drizzle code touches, against the saved schema. Code or a schema that
does not parse touches nothing.

> Body parameter

```json
{
  "code": "string"
}
```

<h3 id="touchedbyquery-parameters">Parameters</h3>

| Name   | In   | Type                              | Required | Description                     |
| ------ | ---- | --------------------------------- | -------- | ------------------------------- |
| body   | body | [TouchedBody](#schematouchedbody) | true     | none                            |
| » code | body | string                            | true     | The code as the editor holds it |

> Example responses

> 200 Response

```json
{
  "tables": [
    {
      "table": "string",
      "columns": ["string"],
      "write": true
    }
  ]
}
```

> 422 Response

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

> 500 Response

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

<h3 id="touchedbyquery-responses">Responses</h3>

| Status | Meaning               | Description                                            | Schema                                                |
| ------ | --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 200    | OK                    | The request has succeeded.                             | [QueryTouched](#schemaquerytouched)                   |
| 422    | Unprocessable Entity  | 422 Unprocessable Content (`application/problem+json`) | [ValidationProblem](#schemavalidationproblem)         |
| 500    | Internal Server Error | 500 Internal Server Error (`application/problem+json`) | [InternalServerProblem](#schemainternalserverproblem) |

<aside class="success">
This operation does not require authentication
</aside>

# Schemas

<h2 id="tocS_ParseError">ParseError</h2>
<!-- backwards compatibility -->
<a id="schemaparseerror"></a>
<a id="schema_ParseError"></a>
<a id="tocSparseerror"></a>
<a id="tocsparseerror"></a>

```json
{
  "message": "Expected `)` but found `EOF`",
  "line": 12,
  "column": 3
}
```

Where a syntax error stopped the parser, 1-based.

### Properties

| Name    | Type           | Required | Restrictions | Description              |
| ------- | -------------- | -------- | ------------ | ------------------------ |
| message | string         | true     | none         | What the parser expected |
| line    | integer(int32) | true     | none         | The line of the error    |
| column  | integer(int32) | true     | none         | The column of the error  |

<h2 id="tocS_Snapshot">Snapshot</h2>
<!-- backwards compatibility -->
<a id="schemasnapshot"></a>
<a id="schema_Snapshot"></a>
<a id="tocSsnapshot"></a>
<a id="tocssnapshot"></a>

```json
{
  "path": "string",
  "file": "string",
  "source": "string",
  "parseError": {
    "message": "Expected `)` but found `EOF`",
    "line": 12,
    "column": 3
  }
}
```

The schema file as it is on disk.

### Properties

| Name       | Type           | Required | Restrictions | Description                                                |
| ---------- | -------------- | -------- | ------------ | ---------------------------------------------------------- |
| path       | string         | true     | none         | The path the studio was started with                       |
| file       | string         | true     | none         | The file name, for the title                               |
| source     | string         | true     | none         | The file's text                                            |
| parseError | object \| null | true     | none         | The first syntax error in the file, or null when it parses |

<h2 id="tocS_InternalServerProblem">InternalServerProblem</h2>
<!-- backwards compatibility -->
<a id="schemainternalserverproblem"></a>
<a id="schema_InternalServerProblem"></a>
<a id="tocSinternalserverproblem"></a>
<a id="tocsinternalserverproblem"></a>

```json
{
  "type": "/problems/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "string",
  "instance": "string"
}
```

RFC 9457 Problem Details for any unexpected failure.

### Properties

| Name     | Type   | Required | Restrictions | Description                                                  |
| -------- | ------ | -------- | ------------ | ------------------------------------------------------------ |
| type     | string | true     | none         | Problem type identifier (relative URI reference)             |
| title    | string | true     | none         | Short, human-readable summary of the problem type            |
| status   | number | true     | none         | HTTP status code, restated in the body per RFC 9457          |
| detail   | string | true     | none         | Human-readable explanation specific to this occurrence       |
| instance | string | true     | none         | URI reference identifying this occurrence (the request path) |

#### Enumerated Values

| Property | Value                           |
| -------- | ------------------------------- |
| type     | /problems/internal-server-error |
| title    | Internal Server Error           |
| status   | 500                             |

<h2 id="tocS_FieldError">FieldError</h2>
<!-- backwards compatibility -->
<a id="schemafielderror"></a>
<a id="schema_FieldError"></a>
<a id="tocSfielderror"></a>
<a id="tocsfielderror"></a>

```json
{
  "field": "string",
  "message": "string"
}
```

One field that failed validation.

### Properties

| Name    | Type   | Required | Restrictions | Description                  |
| ------- | ------ | -------- | ------------ | ---------------------------- |
| field   | string | true     | none         | The dotted path of the field |
| message | string | true     | none         | Why it failed                |

<h2 id="tocS_ValidationProblem">ValidationProblem</h2>
<!-- backwards compatibility -->
<a id="schemavalidationproblem"></a>
<a id="schema_ValidationProblem"></a>
<a id="tocSvalidationproblem"></a>
<a id="tocsvalidationproblem"></a>

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "string",
  "instance": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

RFC 9457 Problem Details for a request that failed validation.

### Properties

| Name     | Type                              | Required | Restrictions | Description                                                  |
| -------- | --------------------------------- | -------- | ------------ | ------------------------------------------------------------ |
| type     | string                            | true     | none         | Problem type identifier (relative URI reference)             |
| title    | string                            | true     | none         | Short, human-readable summary of the problem type            |
| status   | number                            | true     | none         | HTTP status code, restated in the body per RFC 9457          |
| detail   | string                            | true     | none         | Human-readable explanation specific to this occurrence       |
| instance | string                            | true     | none         | URI reference identifying this occurrence (the request path) |
| errors   | [[FieldError](#schemafielderror)] | true     | none         | Extension member: one entry per field that failed validation |

#### Enumerated Values

| Property | Value                       |
| -------- | --------------------------- |
| type     | /problems/validation-failed |
| title    | Validation Failed           |
| status   | 422                         |

<h2 id="tocS_SaveBody">SaveBody</h2>
<!-- backwards compatibility -->
<a id="schemasavebody"></a>
<a id="schema_SaveBody"></a>
<a id="tocSsavebody"></a>
<a id="tocssavebody"></a>

```json
{
  "source": "string"
}
```

Text to write to the schema file.

### Properties

| Name   | Type   | Required | Restrictions | Description    |
| ------ | ------ | -------- | ------------ | -------------- |
| source | string | true     | none         | The whole file |

<h2 id="tocS_CanvasField">CanvasField</h2>
<!-- backwards compatibility -->
<a id="schemacanvasfield"></a>
<a id="schema_CanvasField"></a>
<a id="tocScanvasfield"></a>
<a id="tocscanvasfield"></a>

```json
{
  "name": "string",
  "dbName": "string",
  "kind": "scalar",
  "type": "string",
  "isList": true,
  "isRequired": true,
  "isId": true,
  "isUnique": true,
  "isForeignKey": true,
  "documentation": "string",
  "attributes": ["string"]
}
```

A column as a row of a card.

### Properties

| Name          | Type           | Required | Restrictions | Description                                   |
| ------------- | -------------- | -------- | ------------ | --------------------------------------------- |
| name          | string         | true     | none         | The property name                             |
| dbName        | string \| null | true     | none         | The database column name when it differs      |
| kind          | string         | true     | none         | Whether it holds an enum                      |
| type          | string         | true     | none         | The column builder, or the enum's name        |
| isList        | boolean        | true     | none         | Whether it is an array column                 |
| isRequired    | boolean        | true     | none         | Whether it is NOT NULL                        |
| isId          | boolean        | true     | none         | Whether it is the primary key                 |
| isUnique      | boolean        | true     | none         | Whether a unique constraint covers it alone   |
| isForeignKey  | boolean        | true     | none         | Whether it references another table           |
| documentation | string \| null | true     | none         | The `///` description                         |
| attributes    | [string]       | true     | none         | Its defaults and generated values, as written |

#### Enumerated Values

| Property | Value  |
| -------- | ------ |
| kind     | scalar |
| kind     | enum   |

<h2 id="tocS_CanvasIndex">CanvasIndex</h2>
<!-- backwards compatibility -->
<a id="schemacanvasindex"></a>
<a id="schema_CanvasIndex"></a>
<a id="tocScanvasindex"></a>
<a id="tocscanvasindex"></a>

```json
{
  "type": "id",
  "fields": ["string"]
}
```

An index or constraint as the card lists it under its rows.

### Properties

| Name   | Type     | Required | Restrictions | Description           |
| ------ | -------- | -------- | ------------ | --------------------- |
| type   | string   | true     | none         | What kind it is       |
| fields | [string] | true     | none         | The columns it covers |

#### Enumerated Values

| Property | Value    |
| -------- | -------- |
| type     | id       |
| type     | unique   |
| type     | normal   |
| type     | fulltext |

<h2 id="tocS_LineRange">LineRange</h2>
<!-- backwards compatibility -->
<a id="schemalinerange"></a>
<a id="schema_LineRange"></a>
<a id="tocSlinerange"></a>
<a id="tocslinerange"></a>

```json
{
  "start": 0,
  "end": 0
}
```

Lines of the source, 1-based and inclusive.

### Properties

| Name  | Type           | Required | Restrictions | Description    |
| ----- | -------------- | -------- | ------------ | -------------- |
| start | integer(int32) | true     | none         | The first line |
| end   | integer(int32) | true     | none         | The last line  |

<h2 id="tocS_CanvasModel">CanvasModel</h2>
<!-- backwards compatibility -->
<a id="schemacanvasmodel"></a>
<a id="schema_CanvasModel"></a>
<a id="tocScanvasmodel"></a>
<a id="tocscanvasmodel"></a>

```json
{
  "name": "string",
  "dbName": "string",
  "documentation": "string",
  "primaryKey": ["string"],
  "fields": [
    {
      "name": "string",
      "dbName": "string",
      "kind": "scalar",
      "type": "string",
      "isList": true,
      "isRequired": true,
      "isId": true,
      "isUnique": true,
      "isForeignKey": true,
      "documentation": "string",
      "attributes": ["string"]
    }
  ],
  "indexes": [
    {
      "type": "id",
      "fields": ["string"]
    }
  ],
  "lines": {
    "start": 0,
    "end": 0
  }
}
```

A table as a card.

### Properties

| Name          | Type                                | Required | Restrictions | Description                                             |
| ------------- | ----------------------------------- | -------- | ------------ | ------------------------------------------------------- |
| name          | string                              | true     | none         | The exported name                                       |
| dbName        | string \| null                      | true     | none         | The database table name when it differs                 |
| documentation | string \| null                      | true     | none         | The `///` description                                   |
| primaryKey    | [string]                            | true     | none         | The columns of a composite primary key                  |
| fields        | [[CanvasField](#schemacanvasfield)] | true     | none         | A row per column                                        |
| indexes       | [[CanvasIndex](#schemacanvasindex)] | true     | none         | Its indexes and constraints                             |
| lines         | object                              | true     | none         | Where the table is declared, for the editor to point at |

<h2 id="tocS_RelationEnd">RelationEnd</h2>
<!-- backwards compatibility -->
<a id="schemarelationend"></a>
<a id="schema_RelationEnd"></a>
<a id="tocSrelationend"></a>
<a id="tocsrelationend"></a>

```json
{
  "model": "string",
  "field": "string",
  "cardinality": "one"
}
```

One end of a relation.

### Properties

| Name        | Type   | Required | Restrictions | Description                |
| ----------- | ------ | -------- | ------------ | -------------------------- |
| model       | string | true     | none         | The table                  |
| field       | string | true     | none         | The column                 |
| cardinality | string | true     | none         | How many rows this end has |

#### Enumerated Values

| Property    | Value     |
| ----------- | --------- |
| cardinality | one       |
| cardinality | zero-one  |
| cardinality | many      |
| cardinality | zero-many |

<h2 id="tocS_CanvasRelation">CanvasRelation</h2>
<!-- backwards compatibility -->
<a id="schemacanvasrelation"></a>
<a id="schema_CanvasRelation"></a>
<a id="tocScanvasrelation"></a>
<a id="tocscanvasrelation"></a>

```json
{
  "id": "string",
  "origin": "inferred",
  "name": "string",
  "onDelete": "string",
  "onUpdate": "string",
  "from": {
    "model": "string",
    "field": "string",
    "cardinality": "one"
  },
  "to": {
    "model": "string",
    "field": "string",
    "cardinality": "one"
  }
}
```

A relation as an edge.

### Properties

| Name     | Type           | Required | Restrictions | Description                                                                            |
| -------- | -------------- | -------- | ------------ | -------------------------------------------------------------------------------------- |
| id       | string         | true     | none         | A key for the edge: `from.field->to.field`                                             |
| origin   | string         | true     | none         | Where it was found: a foreign key (`inferred`) or only `defineRelations` (`relations`) |
| name     | string \| null | true     | none         | Its name, when it has one                                                              |
| onDelete | string \| null | true     | none         | The action on delete of the parent row                                                 |
| onUpdate | string \| null | true     | none         | The action on update of the parent key                                                 |
| from     | object         | true     | none         | The referenced end                                                                     |
| to       | object         | true     | none         | The end that holds the foreign key                                                     |

#### Enumerated Values

| Property | Value                 |
| -------- | --------------------- |
| origin   | inferred              |
| origin   | relations             |
| origin   | implicit-many-to-many |

<h2 id="tocS_CanvasEnumValue">CanvasEnumValue</h2>
<!-- backwards compatibility -->
<a id="schemacanvasenumvalue"></a>
<a id="schema_CanvasEnumValue"></a>
<a id="tocScanvasenumvalue"></a>
<a id="tocscanvasenumvalue"></a>

```json
{
  "name": "string",
  "dbName": "string"
}
```

One value of an enum.

### Properties

| Name   | Type           | Required | Restrictions | Description                      |
| ------ | -------------- | -------- | ------------ | -------------------------------- |
| name   | string         | true     | none         | The value                        |
| dbName | string \| null | true     | none         | The stored value when it differs |

<h2 id="tocS_CanvasEnum">CanvasEnum</h2>
<!-- backwards compatibility -->
<a id="schemacanvasenum"></a>
<a id="schema_CanvasEnum"></a>
<a id="tocScanvasenum"></a>
<a id="tocscanvasenum"></a>

```json
{
  "name": "string",
  "dbName": "string",
  "documentation": "string",
  "values": [
    {
      "name": "string",
      "dbName": "string"
    }
  ]
}
```

An enum as a card.

### Properties

| Name          | Type                                        | Required | Restrictions | Description                            |
| ------------- | ------------------------------------------- | -------- | ------------ | -------------------------------------- |
| name          | string                                      | true     | none         | The exported name                      |
| dbName        | string \| null                              | true     | none         | The database type name when it differs |
| documentation | string \| null                              | true     | none         | The `///` description                  |
| values        | [[CanvasEnumValue](#schemacanvasenumvalue)] | true     | none         | Its values, in order                   |

<h2 id="tocS_CanvasSchema">CanvasSchema</h2>
<!-- backwards compatibility -->
<a id="schemacanvasschema"></a>
<a id="schema_CanvasSchema"></a>
<a id="tocScanvasschema"></a>
<a id="tocscanvasschema"></a>

```json
{
  "models": [
    {
      "name": "string",
      "dbName": "string",
      "documentation": "string",
      "primaryKey": ["string"],
      "fields": [
        {
          "name": "string",
          "dbName": "string",
          "kind": "scalar",
          "type": "string",
          "isList": true,
          "isRequired": true,
          "isId": true,
          "isUnique": true,
          "isForeignKey": true,
          "documentation": "string",
          "attributes": ["string"]
        }
      ],
      "indexes": [
        {
          "type": "id",
          "fields": ["string"]
        }
      ],
      "lines": {
        "start": 0,
        "end": 0
      }
    }
  ],
  "relations": [
    {
      "id": "string",
      "origin": "inferred",
      "name": "string",
      "onDelete": "string",
      "onUpdate": "string",
      "from": {
        "model": "string",
        "field": "string",
        "cardinality": "one"
      },
      "to": {
        "model": "string",
        "field": "string",
        "cardinality": "one"
      }
    }
  ],
  "enums": [
    {
      "name": "string",
      "dbName": "string",
      "documentation": "string",
      "values": [
        {
          "name": "string",
          "dbName": "string"
        }
      ]
    }
  ]
}
```

A schema as the diagram canvas draws it.

### Properties

| Name      | Type                                      | Required | Restrictions | Description          |
| --------- | ----------------------------------------- | -------- | ------------ | -------------------- |
| models    | [[CanvasModel](#schemacanvasmodel)]       | true     | none         | A card per table     |
| relations | [[CanvasRelation](#schemacanvasrelation)] | true     | none         | An edge per relation |
| enums     | [[CanvasEnum](#schemacanvasenum)]         | true     | none         | A card per enum      |

<h2 id="tocS_DiagramData">DiagramData</h2>
<!-- backwards compatibility -->
<a id="schemadiagramdata"></a>
<a id="schema_DiagramData"></a>
<a id="tocSdiagramdata"></a>
<a id="tocsdiagramdata"></a>

```json
{
  "schema": {
    "models": [
      {
        "name": "string",
        "dbName": "string",
        "documentation": "string",
        "primaryKey": ["string"],
        "fields": [
          {
            "name": "string",
            "dbName": "string",
            "kind": "scalar",
            "type": "string",
            "isList": true,
            "isRequired": true,
            "isId": true,
            "isUnique": true,
            "isForeignKey": true,
            "documentation": "string",
            "attributes": ["string"]
          }
        ],
        "indexes": [
          {
            "type": "id",
            "fields": ["string"]
          }
        ],
        "lines": {
          "start": 0,
          "end": 0
        }
      }
    ],
    "relations": [
      {
        "id": "string",
        "origin": "inferred",
        "name": "string",
        "onDelete": "string",
        "onUpdate": "string",
        "from": {
          "model": "string",
          "field": "string",
          "cardinality": "one"
        },
        "to": {
          "model": "string",
          "field": "string",
          "cardinality": "one"
        }
      }
    ],
    "enums": [
      {
        "name": "string",
        "dbName": "string",
        "documentation": "string",
        "values": [
          {
            "name": "string",
            "dbName": "string"
          }
        ]
      }
    ]
  },
  "parseError": {
    "message": "Expected `)` but found `EOF`",
    "line": 12,
    "column": 3
  }
}
```

The ER diagram as data, for the page to draw and lay out itself.

### Properties

| Name       | Type           | Required | Restrictions | Description                                                          |
| ---------- | -------------- | -------- | ------------ | -------------------------------------------------------------------- |
| schema     | object \| null | true     | none         | The tables, relations and enums; null when the source does not parse |
| parseError | object \| null | true     | none         | The syntax error that stopped it                                     |

<h2 id="tocS_DocumentKind">DocumentKind</h2>
<!-- backwards compatibility -->
<a id="schemadocumentkind"></a>
<a id="schema_DocumentKind"></a>
<a id="tocSdocumentkind"></a>
<a id="tocsdocumentkind"></a>

```json
"schema"
```

Which editor a language request is about.

<h2 id="tocS_SourceBody">SourceBody</h2>
<!-- backwards compatibility -->
<a id="schemasourcebody"></a>
<a id="schema_SourceBody"></a>
<a id="tocSsourcebody"></a>
<a id="tocssourcebody"></a>

```json
{
  "source": "string",
  "document": {}
}
```

A source to check.

### Properties

| Name     | Type   | Required | Restrictions | Description                                          |
| -------- | ------ | -------- | ------------ | ---------------------------------------------------- |
| source   | string | true     | none         | The schema source, saved or not, or the query        |
| document | object | false    | none         | Which editor it comes from; the schema when left out |

<h2 id="tocS_Diagram">Diagram</h2>
<!-- backwards compatibility -->
<a id="schemadiagram"></a>
<a id="schema_Diagram"></a>
<a id="tocSdiagram"></a>
<a id="tocsdiagram"></a>

```json
{
  "svg": "string",
  "parseError": {
    "message": "Expected `)` but found `EOF`",
    "line": 12,
    "column": 3
  }
}
```

The ER diagram of a schema, or why it could not be drawn.

### Properties

| Name       | Type           | Required | Restrictions | Description                                           |
| ---------- | -------------- | -------- | ------------ | ----------------------------------------------------- |
| svg        | string \| null | true     | none         | The SVG document, null when the source does not parse |
| parseError | object \| null | true     | none         | The syntax error that stopped the drawing             |

<h2 id="tocS_Theme">Theme</h2>
<!-- backwards compatibility -->
<a id="schematheme"></a>
<a id="schema_Theme"></a>
<a id="tocStheme"></a>
<a id="tocstheme"></a>

```json
"light"
```

The colour scheme a diagram is drawn in.

<h2 id="tocS_DiagramBody">DiagramBody</h2>
<!-- backwards compatibility -->
<a id="schemadiagrambody"></a>
<a id="schema_DiagramBody"></a>
<a id="tocSdiagrambody"></a>
<a id="tocsdiagrambody"></a>

```json
{
  "source": "string",
  "theme": {}
}
```

A schema to draw: the editor buffer, saved or not.

### Properties

| Name   | Type   | Required | Restrictions | Description                            |
| ------ | ------ | -------- | ------------ | -------------------------------------- |
| source | string | true     | none         | The schema source                      |
| theme  | object | false    | none         | The colour scheme; light when left out |

<h2 id="tocS_Png">Png</h2>
<!-- backwards compatibility -->
<a id="schemapng"></a>
<a id="schema_Png"></a>
<a id="tocSpng"></a>
<a id="tocspng"></a>

```json
{
  "base64": "string"
}
```

The ER diagram rasterised to PNG at 2x.

### Properties

| Name   | Type   | Required | Restrictions | Description                  |
| ------ | ------ | -------- | ------------ | ---------------------------- |
| base64 | string | true     | none         | The PNG file, base64-encoded |

<h2 id="tocS_Formatted">Formatted</h2>
<!-- backwards compatibility -->
<a id="schemaformatted"></a>
<a id="schema_Formatted"></a>
<a id="tocSformatted"></a>
<a id="tocsformatted"></a>

```json
{
  "source": "string"
}
```

The formatted text.

### Properties

| Name   | Type   | Required | Restrictions | Description                           |
| ------ | ------ | -------- | ------------ | ------------------------------------- |
| source | string | true     | none         | The source as the formatter prints it |

<h2 id="tocS_FormatBody">FormatBody</h2>
<!-- backwards compatibility -->
<a id="schemaformatbody"></a>
<a id="schema_FormatBody"></a>
<a id="tocSformatbody"></a>
<a id="tocsformatbody"></a>

```json
{
  "source": "string"
}
```

Text to format, with the project's `.oxfmtrc.json` when it has one and oxfmt's defaults when not.

### Properties

| Name   | Type   | Required | Restrictions | Description       |
| ------ | ------ | -------- | ------------ | ----------------- |
| source | string | true     | none         | The schema source |

<h2 id="tocS_ColumnReference">ColumnReference</h2>
<!-- backwards compatibility -->
<a id="schemacolumnreference"></a>
<a id="schema_ColumnReference"></a>
<a id="tocScolumnreference"></a>
<a id="tocscolumnreference"></a>

```json
{
  "table": "string",
  "column": "string"
}
```

What a column points at through a foreign key or a relation.

### Properties

| Name   | Type   | Required | Restrictions | Description              |
| ------ | ------ | -------- | ------------ | ------------------------ |
| table  | string | true     | none         | The table it references  |
| column | string | true     | none         | The column it references |

<h2 id="tocS_DocColumn">DocColumn</h2>
<!-- backwards compatibility -->
<a id="schemadoccolumn"></a>
<a id="schema_DocColumn"></a>
<a id="tocSdoccolumn"></a>
<a id="tocsdoccolumn"></a>

```json
{
  "name": "string",
  "dbName": "string",
  "type": "string",
  "nullable": true,
  "primaryKey": true,
  "unique": true,
  "isList": true,
  "enumName": "string",
  "defaults": ["string"],
  "description": "string",
  "references": {
    "table": "string",
    "column": "string"
  }
}
```

A column as the docs describe it.

### Properties

| Name        | Type           | Required | Restrictions | Description                                                 |
| ----------- | -------------- | -------- | ------------ | ----------------------------------------------------------- |
| name        | string         | true     | none         | The property name in the schema                             |
| dbName      | string         | true     | none         | The database column name                                    |
| type        | string         | true     | none         | The column builder (`varchar`, `uuid`, an enum's name, ...) |
| nullable    | boolean        | true     | none         | Whether the column may hold null                            |
| primaryKey  | boolean        | true     | none         | Whether it is the primary key or part of it                 |
| unique      | boolean        | true     | none         | Whether a unique constraint covers it alone                 |
| isList      | boolean        | true     | none         | Whether it is an array column                               |
| enumName    | string \| null | true     | none         | The enum it holds, null for a scalar                        |
| defaults    | [string]       | true     | none         | Its default and generated values, as written                |
| description | string \| null | true     | none         | The `///` description                                       |
| references  | object \| null | true     | none         | The column it references, null when it is not a foreign key |

<h2 id="tocS_DocIndex">DocIndex</h2>
<!-- backwards compatibility -->
<a id="schemadocindex"></a>
<a id="schema_DocIndex"></a>
<a id="tocSdocindex"></a>
<a id="tocsdocindex"></a>

```json
{
  "type": "id",
  "columns": ["string"]
}
```

An index or constraint over one or more columns.

### Properties

| Name    | Type     | Required | Restrictions | Description           |
| ------- | -------- | -------- | ------------ | --------------------- |
| type    | string   | true     | none         | What kind it is       |
| columns | [string] | true     | none         | The columns it covers |

#### Enumerated Values

| Property | Value    |
| -------- | -------- |
| type     | id       |
| type     | unique   |
| type     | normal   |
| type     | fulltext |

<h2 id="tocS_DocRelation">DocRelation</h2>
<!-- backwards compatibility -->
<a id="schemadocrelation"></a>
<a id="schema_DocRelation"></a>
<a id="tocSdocrelation"></a>
<a id="tocsdocrelation"></a>

```json
{
  "table": "string",
  "column": "string",
  "otherColumn": "string",
  "kind": "string",
  "origin": "string",
  "onDelete": "string",
  "onUpdate": "string"
}
```

A relation as seen from one table.

### Properties

| Name        | Type           | Required | Restrictions | Description                                                                            |
| ----------- | -------------- | -------- | ------------ | -------------------------------------------------------------------------------------- |
| table       | string         | true     | none         | The other table                                                                        |
| column      | string         | true     | none         | The column on this side                                                                |
| otherColumn | string         | true     | none         | The column on the other side                                                           |
| kind        | string         | true     | none         | How it reads from this side: `one to many`, `many to one`, ...                         |
| origin      | string         | true     | none         | Where it was found: a foreign key (`inferred`) or only `defineRelations` (`relations`) |
| onDelete    | string \| null | true     | none         | The action on delete of the parent row                                                 |
| onUpdate    | string \| null | true     | none         | The action on update of the parent key                                                 |

<h2 id="tocS_DocQuery">DocQuery</h2>
<!-- backwards compatibility -->
<a id="schemadocquery"></a>
<a id="schema_DocQuery"></a>
<a id="tocSdocquery"></a>
<a id="tocsdocquery"></a>

```json
{
  "name": "string",
  "description": "string",
  "code": "string"
}
```

A Drizzle query to try against a table, for the docs.

### Properties

| Name        | Type   | Required | Restrictions | Description                                                                |
| ----------- | ------ | -------- | ------------ | -------------------------------------------------------------------------- |
| name        | string | true     | none         | What it does, as a title: `Select`, `Count`, `Find many`, `With relations` |
| description | string | true     | none         | A sentence about it                                                        |
| code        | string | true     | none         | The code, as the Query page runs it                                        |

<h2 id="tocS_DocTable">DocTable</h2>
<!-- backwards compatibility -->
<a id="schemadoctable"></a>
<a id="schema_DocTable"></a>
<a id="tocSdoctable"></a>
<a id="tocsdoctable"></a>

```json
{
  "name": "string",
  "dbName": "string",
  "description": "string",
  "columns": [
    {
      "name": "string",
      "dbName": "string",
      "type": "string",
      "nullable": true,
      "primaryKey": true,
      "unique": true,
      "isList": true,
      "enumName": "string",
      "defaults": ["string"],
      "description": "string",
      "references": {
        "table": "string",
        "column": "string"
      }
    }
  ],
  "indexes": [
    {
      "type": "id",
      "columns": ["string"]
    }
  ],
  "references": [
    {
      "table": "string",
      "column": "string",
      "otherColumn": "string",
      "kind": "string",
      "origin": "string",
      "onDelete": "string",
      "onUpdate": "string"
    }
  ],
  "referencedBy": [
    {
      "table": "string",
      "column": "string",
      "otherColumn": "string",
      "kind": "string",
      "origin": "string",
      "onDelete": "string",
      "onUpdate": "string"
    }
  ],
  "queries": [
    {
      "name": "string",
      "description": "string",
      "code": "string"
    }
  ]
}
```

One table of the docs.

### Properties

| Name         | Type                                | Required | Restrictions | Description                                          |
| ------------ | ----------------------------------- | -------- | ------------ | ---------------------------------------------------- |
| name         | string                              | true     | none         | The exported name                                    |
| dbName       | string                              | true     | none         | The database table name                              |
| description  | string \| null                      | true     | none         | The `///` description above it                       |
| columns      | [[DocColumn](#schemadoccolumn)]     | true     | none         | Its columns, in declaration order                    |
| indexes      | [[DocIndex](#schemadocindex)]       | true     | none         | Its indexes and constraints                          |
| references   | [[DocRelation](#schemadocrelation)] | true     | none         | The relations where this table holds the foreign key |
| referencedBy | [[DocRelation](#schemadocrelation)] | true     | none         | The relations where another table points here        |
| queries      | [[DocQuery](#schemadocquery)]       | true     | none         | Drizzle queries to start from                        |

<h2 id="tocS_DocEnum">DocEnum</h2>
<!-- backwards compatibility -->
<a id="schemadocenum"></a>
<a id="schema_DocEnum"></a>
<a id="tocSdocenum"></a>
<a id="tocsdocenum"></a>

```json
{
  "name": "string",
  "dbName": "string",
  "description": "string",
  "values": ["string"]
}
```

One enum of the docs.

### Properties

| Name        | Type           | Required | Restrictions | Description                    |
| ----------- | -------------- | -------- | ------------ | ------------------------------ |
| name        | string         | true     | none         | The exported name              |
| dbName      | string         | true     | none         | The database type name         |
| description | string \| null | true     | none         | The `///` description above it |
| values      | [string]       | true     | none         | Its values, in order           |

<h2 id="tocS_Docs">Docs</h2>
<!-- backwards compatibility -->
<a id="schemadocs"></a>
<a id="schema_Docs"></a>
<a id="tocSdocs"></a>
<a id="tocsdocs"></a>

```json
{
  "tables": [
    {
      "name": "string",
      "dbName": "string",
      "description": "string",
      "columns": [
        {
          "name": "string",
          "dbName": "string",
          "type": "string",
          "nullable": true,
          "primaryKey": true,
          "unique": true,
          "isList": true,
          "enumName": "string",
          "defaults": ["string"],
          "description": "string",
          "references": {
            "table": "string",
            "column": "string"
          }
        }
      ],
      "indexes": [
        {
          "type": "id",
          "columns": ["string"]
        }
      ],
      "references": [
        {
          "table": "string",
          "column": "string",
          "otherColumn": "string",
          "kind": "string",
          "origin": "string",
          "onDelete": "string",
          "onUpdate": "string"
        }
      ],
      "referencedBy": [
        {
          "table": "string",
          "column": "string",
          "otherColumn": "string",
          "kind": "string",
          "origin": "string",
          "onDelete": "string",
          "onUpdate": "string"
        }
      ],
      "queries": [
        {
          "name": "string",
          "description": "string",
          "code": "string"
        }
      ]
    }
  ],
  "enums": [
    {
      "name": "string",
      "dbName": "string",
      "description": "string",
      "values": ["string"]
    }
  ],
  "parseError": {
    "message": "Expected `)` but found `EOF`",
    "line": 12,
    "column": 3
  }
}
```

The generated documentation of the saved schema.

### Properties

| Name       | Type                          | Required | Restrictions | Description                                         |
| ---------- | ----------------------------- | -------- | ------------ | --------------------------------------------------- |
| tables     | [[DocTable](#schemadoctable)] | true     | none         | Every table, in file order                          |
| enums      | [[DocEnum](#schemadocenum)]   | true     | none         | Every enum, in file order                           |
| parseError | object \| null                | true     | none         | The syntax error that kept the docs from being read |

<h2 id="tocS_DbColumn">DbColumn</h2>
<!-- backwards compatibility -->
<a id="schemadbcolumn"></a>
<a id="schema_DbColumn"></a>
<a id="tocSdbcolumn"></a>
<a id="tocsdbcolumn"></a>

```json
{
  "name": "string",
  "column": "string",
  "type": "string",
  "nullable": true
}
```

A column the data views read and write.

### Properties

| Name     | Type    | Required | Restrictions | Description                     |
| -------- | ------- | -------- | ------------ | ------------------------------- |
| name     | string  | true     | none         | The property name in the schema |
| column   | string  | true     | none         | The database column name        |
| type     | string  | true     | none         | The column builder              |
| nullable | boolean | true     | none         | Whether it may hold null        |

<h2 id="tocS_DbTable">DbTable</h2>
<!-- backwards compatibility -->
<a id="schemadbtable"></a>
<a id="schema_DbTable"></a>
<a id="tocSdbtable"></a>
<a id="tocsdbtable"></a>

```json
{
  "name": "string",
  "table": "string",
  "columns": [
    {
      "name": "string",
      "column": "string",
      "type": "string",
      "nullable": true
    }
  ],
  "key": ["string"]
}
```

A table of the schema as the data views see it.

### Properties

| Name    | Type                          | Required | Restrictions | Description                                                                         |
| ------- | ----------------------------- | -------- | ------------ | ----------------------------------------------------------------------------------- |
| name    | string                        | true     | none         | The exported name                                                                   |
| table   | string                        | true     | none         | The database table name                                                             |
| columns | [[DbColumn](#schemadbcolumn)] | true     | none         | Its columns, in declaration order                                                   |
| key     | [string]                      | true     | none         | The columns that identify a row: the primary key, else the unique columns, else all |

<h2 id="tocS_DbStatus">DbStatus</h2>
<!-- backwards compatibility -->
<a id="schemadbstatus"></a>
<a id="schema_DbStatus"></a>
<a id="tocSdbstatus"></a>
<a id="tocsdbstatus"></a>

```json
{
  "connected": true,
  "dialect": "sqlite",
  "url": "string",
  "error": "string",
  "tables": [
    {
      "name": "string",
      "table": "string",
      "columns": [
        {
          "name": "string",
          "column": "string",
          "type": "string",
          "nullable": true
        }
      ],
      "key": ["string"]
    }
  ]
}
```

The database connection, and the tables the schema declares.

### Properties

| Name      | Type                        | Required | Restrictions | Description                                     |
| --------- | --------------------------- | -------- | ------------ | ----------------------------------------------- |
| connected | boolean                     | true     | none         | Whether a database is connected                 |
| dialect   | string \| null              | true     | none         | The SQL dialect of the connection               |
| url       | string \| null              | true     | none         | The connection URL with its password hidden     |
| error     | string \| null              | true     | none         | Why the connection failed, null when it did not |
| tables    | [[DbTable](#schemadbtable)] | true     | none         | The tables of the saved schema                  |

#### Enumerated Values

| Property | Value      |
| -------- | ---------- |
| dialect  | sqlite     |
| dialect  | postgresql |
| dialect  | mysql      |

<h2 id="tocS_Counts">Counts</h2>
<!-- backwards compatibility -->
<a id="schemacounts"></a>
<a id="schema_Counts"></a>
<a id="tocScounts"></a>
<a id="tocscounts"></a>

```json
{
  "counts": {
    "property1": 0,
    "property2": 0
  }
}
```

Row counts by table name; a table whose count fails is left out.

### Properties

| Name   | Type   | Required | Restrictions | Description    |
| ------ | ------ | -------- | ------------ | -------------- |
| counts | object | true     | none         | Rows per table |

<h2 id="tocS_ServiceUnavailableProblem">ServiceUnavailableProblem</h2>
<!-- backwards compatibility -->
<a id="schemaserviceunavailableproblem"></a>
<a id="schema_ServiceUnavailableProblem"></a>
<a id="tocSserviceunavailableproblem"></a>
<a id="tocsserviceunavailableproblem"></a>

```json
{
  "type": "/problems/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
  "instance": "/api/db/counts"
}
```

RFC 9457 Problem Details for a request that needs the database while none is connected,
or whose statement the database rejected.

### Properties

| Name     | Type   | Required | Restrictions | Description                                                  |
| -------- | ------ | -------- | ------------ | ------------------------------------------------------------ |
| type     | string | true     | none         | Problem type identifier (relative URI reference)             |
| title    | string | true     | none         | Short, human-readable summary of the problem type            |
| status   | number | true     | none         | HTTP status code, restated in the body per RFC 9457          |
| detail   | string | true     | none         | Human-readable explanation specific to this occurrence       |
| instance | string | true     | none         | URI reference identifying this occurrence (the request path) |

#### Enumerated Values

| Property | Value                         |
| -------- | ----------------------------- |
| type     | /problems/service-unavailable |
| title    | Service Unavailable           |
| status   | 503                           |

<h2 id="tocS_tableName">tableName</h2>
<!-- backwards compatibility -->
<a id="schematablename"></a>
<a id="schema_tableName"></a>
<a id="tocStablename"></a>
<a id="tocstablename"></a>

```json
"string"
```

A table as the schema exports it (`export const user = pgTable(...)` → `user`).

<h2 id="tocS_skip">skip</h2>
<!-- backwards compatibility -->
<a id="schemaskip"></a>
<a id="schema_skip"></a>
<a id="tocSskip"></a>
<a id="tocsskip"></a>

```json
0
```

Rows to skip before the page (0-based). Defaults to 0.

<h2 id="tocS_take">take</h2>
<!-- backwards compatibility -->
<a id="schematake"></a>
<a id="schema_take"></a>
<a id="tocStake"></a>
<a id="tocstake"></a>

```json
1
```

Rows per page (1-1000). Defaults to 100.

<h2 id="tocS_Row">Row</h2>
<!-- backwards compatibility -->
<a id="schemarow"></a>
<a id="schema_Row"></a>
<a id="tocSrow"></a>
<a id="tocsrow"></a>

```json
{
  "property1": "string",
  "property2": "string"
}
```

A row keyed by column property name.

### Properties

| Name                     | Type                                        | Required | Restrictions | Description |
| ------------------------ | ------------------------------------------- | -------- | ------------ | ----------- |
| **additionalProperties** | string \| number(double) \| boolean \| null | false    | none         | none        |

<h2 id="tocS_Rows">Rows</h2>
<!-- backwards compatibility -->
<a id="schemarows"></a>
<a id="schema_Rows"></a>
<a id="tocSrows"></a>
<a id="tocsrows"></a>

```json
{
  "rows": [
    {
      "property1": "string",
      "property2": "string"
    }
  ],
  "total": 0,
  "skip": 0,
  "take": 0,
  "search": "string"
}
```

One page of a table's rows.

### Properties

| Name   | Type                | Required | Restrictions | Description                                                           |
| ------ | ------------------- | -------- | ------------ | --------------------------------------------------------------------- |
| rows   | [[Row](#schemarow)] | true     | none         | The rows of the page                                                  |
| total  | integer(int32)      | true     | none         | How many rows the table has                                           |
| skip   | integer(int32)      | true     | none         | The skip the page was read with                                       |
| take   | integer(int32)      | true     | none         | The take the page was read with                                       |
| search | string              | true     | none         | The search the page was read with; `total` counts the rows it matched |

<h2 id="tocS_NotFoundProblem">NotFoundProblem</h2>
<!-- backwards compatibility -->
<a id="schemanotfoundproblem"></a>
<a id="schema_NotFoundProblem"></a>
<a id="tocSnotfoundproblem"></a>
<a id="tocsnotfoundproblem"></a>

```json
{
  "type": "/problems/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Unknown table \"nope\".",
  "instance": "/api/db/rows/nope"
}
```

RFC 9457 Problem Details for a table the schema does not declare.

### Properties

| Name     | Type   | Required | Restrictions | Description                                                  |
| -------- | ------ | -------- | ------------ | ------------------------------------------------------------ |
| type     | string | true     | none         | Problem type identifier (relative URI reference)             |
| title    | string | true     | none         | Short, human-readable summary of the problem type            |
| status   | number | true     | none         | HTTP status code, restated in the body per RFC 9457          |
| detail   | string | true     | none         | Human-readable explanation specific to this occurrence       |
| instance | string | true     | none         | URI reference identifying this occurrence (the request path) |

#### Enumerated Values

| Property | Value               |
| -------- | ------------------- |
| type     | /problems/not-found |
| title    | Not Found           |
| status   | 404                 |

<h2 id="tocS_Affected">Affected</h2>
<!-- backwards compatibility -->
<a id="schemaaffected"></a>
<a id="schema_Affected"></a>
<a id="tocSaffected"></a>
<a id="tocsaffected"></a>

```json
{
  "count": 0
}
```

How many rows a write changed.

### Properties

| Name  | Type           | Required | Restrictions | Description  |
| ----- | -------------- | -------- | ------------ | ------------ |
| count | integer(int32) | true     | none         | Rows changed |

<h2 id="tocS_InsertBody">InsertBody</h2>
<!-- backwards compatibility -->
<a id="schemainsertbody"></a>
<a id="schema_InsertBody"></a>
<a id="tocSinsertbody"></a>
<a id="tocsinsertbody"></a>

```json
{
  "values": {
    "property1": "string",
    "property2": "string"
  }
}
```

A row to insert.

### Properties

| Name   | Type   | Required | Restrictions | Description                                  |
| ------ | ------ | -------- | ------------ | -------------------------------------------- |
| values | object | true     | none         | The values to insert, keyed by property name |

<h2 id="tocS_UpdateBody">UpdateBody</h2>
<!-- backwards compatibility -->
<a id="schemaupdatebody"></a>
<a id="schema_UpdateBody"></a>
<a id="tocSupdatebody"></a>
<a id="tocsupdatebody"></a>

```json
{
  "where": {
    "property1": "string",
    "property2": "string"
  },
  "values": {
    "property1": "string",
    "property2": "string"
  }
}
```

A row to change.

### Properties

| Name   | Type   | Required | Restrictions | Description                          |
| ------ | ------ | -------- | ------------ | ------------------------------------ |
| where  | object | true     | none         | The key columns of the row to change |
| values | object | true     | none         | The columns to set                   |

<h2 id="tocS_DeleteBody">DeleteBody</h2>
<!-- backwards compatibility -->
<a id="schemadeletebody"></a>
<a id="schema_DeleteBody"></a>
<a id="tocSdeletebody"></a>
<a id="tocsdeletebody"></a>

```json
{
  "where": {
    "property1": "string",
    "property2": "string"
  }
}
```

A row to delete.

### Properties

| Name  | Type   | Required | Restrictions | Description                          |
| ----- | ------ | -------- | ------------ | ------------------------------------ |
| where | object | true     | none         | The key columns of the row to delete |

<h2 id="tocS_SqlResult">SqlResult</h2>
<!-- backwards compatibility -->
<a id="schemasqlresult"></a>
<a id="schema_SqlResult"></a>
<a id="tocSsqlresult"></a>
<a id="tocssqlresult"></a>

```json
{
  "columns": ["string"],
  "rows": [
    {
      "property1": "string",
      "property2": "string"
    }
  ],
  "rowCount": 0,
  "durationMs": 0
}
```

What a statement returned.

### Properties

| Name       | Type                | Required | Restrictions | Description                          |
| ---------- | ------------------- | -------- | ------------ | ------------------------------------ |
| columns    | [string]            | true     | none         | The result columns, in order         |
| rows       | [[Row](#schemarow)] | true     | none         | The rows, keyed by column            |
| rowCount   | integer(int32)      | true     | none         | Rows returned, or changed by a write |
| durationMs | number(double)      | true     | none         | How long the statement took          |

<h2 id="tocS_SqlBody">SqlBody</h2>
<!-- backwards compatibility -->
<a id="schemasqlbody"></a>
<a id="schema_SqlBody"></a>
<a id="tocSsqlbody"></a>
<a id="tocssqlbody"></a>

```json
{
  "sql": "string",
  "params": ["string"]
}
```

Statements for the SQL console.

### Properties

| Name   | Type                                          | Required | Restrictions | Description                                                                   |
| ------ | --------------------------------------------- | -------- | ------------ | ----------------------------------------------------------------------------- |
| sql    | string                                        | true     | none         | The statements; several are run one by one and the result belongs to the last |
| params | [string \| number(double) \| boolean \| null] | false    | none         | The values bound to the placeholders, in order; omitted means none            |

<h2 id="tocS_SqlDialect">SqlDialect</h2>
<!-- backwards compatibility -->
<a id="schemasqldialect"></a>
<a id="schema_SqlDialect"></a>
<a id="tocSsqldialect"></a>
<a id="tocssqldialect"></a>

```json
"sqlite"
```

The dialect a database speaks.

<h2 id="tocS_PlanNode">PlanNode</h2>
<!-- backwards compatibility -->
<a id="schemaplannode"></a>
<a id="schema_PlanNode"></a>
<a id="tocSplannode"></a>
<a id="tocsplannode"></a>

```json
{
  "id": "3",
  "parent": null,
  "label": "SCAN users",
  "detail": null,
  "cost": null,
  "rows": null
}
```

One step of the execution plan, flattened; `parent` rebuilds the tree.

### Properties

| Name   | Type                   | Required | Restrictions | Description                                                         |
| ------ | ---------------------- | -------- | ------------ | ------------------------------------------------------------------- |
| id     | string                 | true     | none         | The step id, unique within the plan                                 |
| parent | string \| null         | true     | none         | The id of the step this one feeds, or null for a root               |
| label  | string                 | true     | none         | What the step does (`SCAN users`, `Seq Scan on users`, `Hash Join`) |
| detail | string \| null         | true     | none         | The rest of what the database said about the step                   |
| cost   | number(double) \| null | true     | none         | The estimated cost, when the database reports one                   |
| rows   | number(double) \| null | true     | none         | The estimated (or, with ANALYZE, actual) row count, when reported   |

<h2 id="tocS_Plan">Plan</h2>
<!-- backwards compatibility -->
<a id="schemaplan"></a>
<a id="schema_Plan"></a>
<a id="tocSplan"></a>
<a id="tocsplan"></a>

```json
{
  "dialect": "sqlite",
  "nodes": [],
  "raw": ""
}
```

The execution plan of a statement.

### Properties

| Name    | Type                          | Required | Restrictions | Description                         |
| ------- | ----------------------------- | -------- | ------------ | ----------------------------------- |
| dialect | object                        | true     | none         | The dialect that produced the plan  |
| nodes   | [[PlanNode](#schemaplannode)] | true     | none         | The steps, parents before children  |
| raw     | string                        | true     | none         | The plan as the database printed it |

<h2 id="tocS_StatementKind">StatementKind</h2>
<!-- backwards compatibility -->
<a id="schemastatementkind"></a>
<a id="schema_StatementKind"></a>
<a id="tocSstatementkind"></a>
<a id="tocsstatementkind"></a>

```json
"select"
```

What kind of statement was analyzed.

<h2 id="tocS_TextRange">TextRange</h2>
<!-- backwards compatibility -->
<a id="schematextrange"></a>
<a id="schema_TextRange"></a>
<a id="tocStextrange"></a>
<a id="tocstextrange"></a>

```json
{
  "start": 0,
  "end": 0
}
```

A stretch of the source, as UTF-16 offsets.

### Properties

| Name  | Type           | Required | Restrictions | Description     |
| ----- | -------------- | -------- | ------------ | --------------- |
| start | integer(int32) | true     | none         | Where it starts |
| end   | integer(int32) | true     | none         | Where it ends   |

<h2 id="tocS_NodeKind">NodeKind</h2>
<!-- backwards compatibility -->
<a id="schemanodekind"></a>
<a id="schema_NodeKind"></a>
<a id="tocSnodekind"></a>
<a id="tocsnodekind"></a>

```json
"table"
```

What a node of the data-flow graph stands for.

<h2 id="tocS_NodeColumn">NodeColumn</h2>
<!-- backwards compatibility -->
<a id="schemanodecolumn"></a>
<a id="schema_NodeColumn"></a>
<a id="tocSnodecolumn"></a>
<a id="tocsnodecolumn"></a>

```json
{
  "name": "email",
  "dataType": "TEXT",
  "used": true
}
```

A column a node produces.

### Properties

| Name     | Type           | Required | Restrictions | Description                                                                       |
| -------- | -------------- | -------- | ------------ | --------------------------------------------------------------------------------- |
| name     | string         | true     | none         | The column name                                                                   |
| dataType | string \| null | true     | none         | The declared type, when known                                                     |
| used     | boolean        | true     | none         | Whether the statement reads the column (for a table), or always true for a result |

<h2 id="tocS_GraphNode">GraphNode</h2>
<!-- backwards compatibility -->
<a id="schemagraphnode"></a>
<a id="schema_GraphNode"></a>
<a id="tocSgraphnode"></a>
<a id="tocsgraphnode"></a>

```json
{
  "id": "n3",
  "kind": "filter",
  "label": "WHERE",
  "details": ["u.id = ?"],
  "range": {
    "start": 40,
    "end": 48
  },
  "scope": "main",
  "columns": []
}
```

A node of the data-flow graph.

### Properties

| Name    | Type                              | Required | Restrictions | Description                                                                |
| ------- | --------------------------------- | -------- | ------------ | -------------------------------------------------------------------------- |
| id      | string                            | true     | none         | The node id, unique within the statement                                   |
| kind    | object                            | true     | none         | What the node stands for                                                   |
| label   | string                            | true     | none         | The caption (`users AS u`, `LEFT JOIN`, `WHERE`)                           |
| details | [string]                          | true     | none         | Lines under the caption: the condition, the grouped keys, the column names |
| range   | object \| null                    | true     | none         | Where the node's clause sits in the text, when it has one                  |
| scope   | string                            | true     | none         | `main`, or the CTE / subquery alias the node belongs to                    |
| columns | [[NodeColumn](#schemanodecolumn)] | true     | none         | The columns the node produces (tables, CTEs, subqueries and projections)   |

<h2 id="tocS_EdgeKind">EdgeKind</h2>
<!-- backwards compatibility -->
<a id="schemaedgekind"></a>
<a id="schema_EdgeKind"></a>
<a id="tocSedgekind"></a>
<a id="tocsedgekind"></a>

```json
"flow"
```

How rows travel along an edge.

<h2 id="tocS_GraphEdge">GraphEdge</h2>
<!-- backwards compatibility -->
<a id="schemagraphedge"></a>
<a id="schema_GraphEdge"></a>
<a id="tocSgraphedge"></a>
<a id="tocsgraphedge"></a>

```json
{
  "id": "n1->n3:0",
  "source": "n1",
  "target": "n3",
  "label": null,
  "kind": "flow"
}
```

An edge of the data-flow graph.

### Properties

| Name   | Type           | Required | Restrictions | Description                                                                         |
| ------ | -------------- | -------- | ------------ | ----------------------------------------------------------------------------------- |
| id     | string         | true     | none         | The edge id, unique within the statement                                            |
| source | string         | true     | none         | The node rows come from                                                             |
| target | string         | true     | none         | The node rows go to                                                                 |
| label  | string \| null | true     | none         | A caption (`optional` for the outer side of a join, `scalar` for a scalar subquery) |
| kind   | object         | true     | none         | How rows travel                                                                     |

<h2 id="tocS_TableRef">TableRef</h2>
<!-- backwards compatibility -->
<a id="schematableref"></a>
<a id="schema_TableRef"></a>
<a id="tocStableref"></a>
<a id="tocstableref"></a>

```json
{
  "nodeId": "n1",
  "name": "users",
  "alias": "u",
  "scope": "main",
  "known": true,
  "columnsUsed": ["id", "email"],
  "range": {
    "start": 20,
    "end": 25
  }
}
```

A table the statement reads or writes.

### Properties

| Name        | Type           | Required | Restrictions | Description                                               |
| ----------- | -------------- | -------- | ------------ | --------------------------------------------------------- |
| nodeId      | string         | true     | none         | The graph node of this reference                          |
| name        | string         | true     | none         | The table name as written                                 |
| alias       | string \| null | true     | none         | The alias, when one was given                             |
| scope       | string         | true     | none         | `main`, or the CTE / subquery alias the reference sits in |
| known       | boolean        | true     | none         | Whether the schema has the table                          |
| columnsUsed | [string]       | true     | none         | The columns the statement reads from this reference       |
| range       | object         | true     | none         | Where the name sits in the text                           |

<h2 id="tocS_ColumnSource">ColumnSource</h2>
<!-- backwards compatibility -->
<a id="schemacolumnsource"></a>
<a id="schema_ColumnSource"></a>
<a id="tocScolumnsource"></a>
<a id="tocscolumnsource"></a>

```json
{
  "table": "users",
  "column": "email"
}
```

A base-table column an output column derives from.

### Properties

| Name   | Type   | Required | Restrictions | Description              |
| ------ | ------ | -------- | ------------ | ------------------------ |
| table  | string | true     | none         | The base table           |
| column | string | true     | none         | The column of that table |

<h2 id="tocS_OutputColumn">OutputColumn</h2>
<!-- backwards compatibility -->
<a id="schemaoutputcolumn"></a>
<a id="schema_OutputColumn"></a>
<a id="tocSoutputcolumn"></a>
<a id="tocsoutputcolumn"></a>

```json
{
  "name": "email",
  "expression": "u.email",
  "dataType": "TEXT",
  "tsType": "string",
  "nullable": true,
  "sources": [
    {
      "table": "users",
      "column": "email"
    }
  ]
}
```

A column of the result, with its lineage and type.

### Properties

| Name       | Type                                  | Required | Restrictions | Description                                                    |
| ---------- | ------------------------------------- | -------- | ------------ | -------------------------------------------------------------- |
| name       | string                                | true     | none         | The name a driver keys the row with                            |
| expression | string                                | true     | none         | The expression as written                                      |
| dataType   | string \| null                        | true     | none         | The declared type, when known                                  |
| tsType     | string                                | true     | none         | The TypeScript type of the value                               |
| nullable   | boolean \| null                       | true     | none         | Whether NULL can come back; null when the analysis cannot tell |
| sources    | [[ColumnSource](#schemacolumnsource)] | true     | none         | The base-table columns the value derives from                  |

<h2 id="tocS_SqlParameter">SqlParameter</h2>
<!-- backwards compatibility -->
<a id="schemasqlparameter"></a>
<a id="schema_SqlParameter"></a>
<a id="tocSsqlparameter"></a>
<a id="tocssqlparameter"></a>

```json
{
  "index": 1,
  "placeholder": "?",
  "dataType": "INTEGER",
  "tsType": "number",
  "nullable": false,
  "context": "u.id = ?"
}
```

A placeholder and the type of what it stands beside.

### Properties

| Name        | Type            | Required | Restrictions | Description                                                       |
| ----------- | --------------- | -------- | ------------ | ----------------------------------------------------------------- |
| index       | integer(int32)  | true     | none         | The bind position (1-based), or the `$n` number                   |
| placeholder | string          | true     | none         | The placeholder as written (`?`, `$1`, `:name`)                   |
| dataType    | string \| null  | true     | none         | The declared type of the column it is compared with, when known   |
| tsType      | string          | true     | none         | The TypeScript type a value should have                           |
| nullable    | boolean \| null | true     | none         | Whether NULL is a valid value; null when the analysis cannot tell |
| context     | string          | true     | none         | The expression the placeholder sits in                            |

<h2 id="tocS_SqlSeverity">SqlSeverity</h2>
<!-- backwards compatibility -->
<a id="schemasqlseverity"></a>
<a id="schema_SqlSeverity"></a>
<a id="tocSsqlseverity"></a>
<a id="tocssqlseverity"></a>

```json
"error"
```

How serious a problem the analysis found is.

<h2 id="tocS_SqlDiagnostic">SqlDiagnostic</h2>
<!-- backwards compatibility -->
<a id="schemasqldiagnostic"></a>
<a id="schema_SqlDiagnostic"></a>
<a id="tocSsqldiagnostic"></a>
<a id="tocssqldiagnostic"></a>

```json
{
  "severity": "warning",
  "message": "Unknown column \"nmae\"",
  "range": {
    "start": 7,
    "end": 11
  }
}
```

A problem found in the statement.

### Properties

| Name     | Type           | Required | Restrictions | Description                              |
| -------- | -------------- | -------- | ------------ | ---------------------------------------- |
| severity | object         | true     | none         | How serious it is                        |
| message  | string         | true     | none         | What is wrong                            |
| range    | object \| null | true     | none         | Where, when the analysis can point at it |

<h2 id="tocS_StatementAnalysis">StatementAnalysis</h2>
<!-- backwards compatibility -->
<a id="schemastatementanalysis"></a>
<a id="schema_StatementAnalysis"></a>
<a id="tocSstatementanalysis"></a>
<a id="tocsstatementanalysis"></a>

```json
{
  "kind": {},
  "text": "string",
  "range": {
    "start": 0,
    "end": 0
  },
  "nodes": [
    {
      "id": "n3",
      "kind": "filter",
      "label": "WHERE",
      "details": ["u.id = ?"],
      "range": {
        "start": 40,
        "end": 48
      },
      "scope": "main",
      "columns": []
    }
  ],
  "edges": [
    {
      "id": "n1->n3:0",
      "source": "n1",
      "target": "n3",
      "label": null,
      "kind": "flow"
    }
  ],
  "tables": [
    {
      "nodeId": "n1",
      "name": "users",
      "alias": "u",
      "scope": "main",
      "known": true,
      "columnsUsed": ["id", "email"],
      "range": {
        "start": 20,
        "end": 25
      }
    }
  ],
  "columns": [
    {
      "name": "email",
      "expression": "u.email",
      "dataType": "TEXT",
      "tsType": "string",
      "nullable": true,
      "sources": [
        {
          "table": "users",
          "column": "email"
        }
      ]
    }
  ],
  "parameters": [
    {
      "index": 1,
      "placeholder": "?",
      "dataType": "INTEGER",
      "tsType": "number",
      "nullable": false,
      "context": "u.id = ?"
    }
  ],
  "diagnostics": [
    {
      "severity": "warning",
      "message": "Unknown column \"nmae\"",
      "range": {
        "start": 7,
        "end": 11
      }
    }
  ],
  "rowType": "string",
  "paramsType": "string"
}
```

The analysis of one statement.

### Properties

| Name        | Type                                    | Required | Restrictions | Description                                                           |
| ----------- | --------------------------------------- | -------- | ------------ | --------------------------------------------------------------------- |
| kind        | object                                  | true     | none         | What kind of statement it is                                          |
| text        | string                                  | true     | none         | The statement text                                                    |
| range       | object                                  | true     | none         | Where the statement sits in the submitted text                        |
| nodes       | [[GraphNode](#schemagraphnode)]         | true     | none         | The nodes of the data-flow graph                                      |
| edges       | [[GraphEdge](#schemagraphedge)]         | true     | none         | The edges of the data-flow graph                                      |
| tables      | [[TableRef](#schematableref)]           | true     | none         | Every table the statement touches                                     |
| columns     | [[OutputColumn](#schemaoutputcolumn)]   | true     | none         | The columns of the result (empty for a write without RETURNING)       |
| parameters  | [[SqlParameter](#schemasqlparameter)]   | true     | none         | The placeholders, in bind order                                       |
| diagnostics | [[SqlDiagnostic](#schemasqldiagnostic)] | true     | none         | What was found wrong                                                  |
| rowType     | string                                  | true     | none         | The row type as TypeScript (`{ id: number; email: string \| null }`)  |
| paramsType  | string                                  | true     | none         | The parameter tuple (or object, for named placeholders) as TypeScript |

<h2 id="tocS_Analysis">Analysis</h2>
<!-- backwards compatibility -->
<a id="schemaanalysis"></a>
<a id="schema_Analysis"></a>
<a id="tocSanalysis"></a>
<a id="tocsanalysis"></a>

```json
{
  "statements": [
    {
      "kind": {},
      "text": "string",
      "range": {
        "start": 0,
        "end": 0
      },
      "nodes": [
        {
          "id": "n3",
          "kind": "filter",
          "label": "WHERE",
          "details": ["u.id = ?"],
          "range": {
            "start": 40,
            "end": 48
          },
          "scope": "main",
          "columns": []
        }
      ],
      "edges": [
        {
          "id": "n1->n3:0",
          "source": "n1",
          "target": "n3",
          "label": null,
          "kind": "flow"
        }
      ],
      "tables": [
        {
          "nodeId": "n1",
          "name": "users",
          "alias": "u",
          "scope": "main",
          "known": true,
          "columnsUsed": ["id", "email"],
          "range": {
            "start": 20,
            "end": 25
          }
        }
      ],
      "columns": [
        {
          "name": "email",
          "expression": "u.email",
          "dataType": "TEXT",
          "tsType": "string",
          "nullable": true,
          "sources": [
            {
              "table": "users",
              "column": "email"
            }
          ]
        }
      ],
      "parameters": [
        {
          "index": 1,
          "placeholder": "?",
          "dataType": "INTEGER",
          "tsType": "number",
          "nullable": false,
          "context": "u.id = ?"
        }
      ],
      "diagnostics": [
        {
          "severity": "warning",
          "message": "Unknown column \"nmae\"",
          "range": {
            "start": 7,
            "end": 11
          }
        }
      ],
      "rowType": "string",
      "paramsType": "string"
    }
  ]
}
```

The analysis of every statement in the text.

### Properties

| Name       | Type                                            | Required | Restrictions | Description                       |
| ---------- | ----------------------------------------------- | -------- | ------------ | --------------------------------- |
| statements | [[StatementAnalysis](#schemastatementanalysis)] | true     | none         | One entry per statement, in order |

<h2 id="tocS_AnalyzeBody">AnalyzeBody</h2>
<!-- backwards compatibility -->
<a id="schemaanalyzebody"></a>
<a id="schema_AnalyzeBody"></a>
<a id="tocSanalyzebody"></a>
<a id="tocsanalyzebody"></a>

```json
{
  "sql": "SELECT id, email FROM users WHERE id = ?"
}
```

Text to analyze.

### Properties

| Name | Type   | Required | Restrictions | Description    |
| ---- | ------ | -------- | ------------ | -------------- |
| sql  | string | true     | none         | The statements |

<h2 id="tocS_LanguageStatus">LanguageStatus</h2>
<!-- backwards compatibility -->
<a id="schemalanguagestatus"></a>
<a id="schema_LanguageStatus"></a>
<a id="tocSlanguagestatus"></a>
<a id="tocslanguagestatus"></a>

```json
{
  "typescript": "string",
  "reason": "string"
}
```

Whether the editor has TypeScript behind it.

### Properties

| Name       | Type           | Required | Restrictions | Description                                                               |
| ---------- | -------------- | -------- | ------------ | ------------------------------------------------------------------------- |
| typescript | string \| null | true     | none         | The version of the project's TypeScript, null when it could not be loaded |
| reason     | string \| null | true     | none         | Why there is no language service, null when there is one                  |

<h2 id="tocS_CompletionItem">CompletionItem</h2>
<!-- backwards compatibility -->
<a id="schemacompletionitem"></a>
<a id="schema_CompletionItem"></a>
<a id="tocScompletionitem"></a>
<a id="tocscompletionitem"></a>

```json
{
  "label": "string",
  "kind": "string",
  "sortText": "string",
  "insertText": "string",
  "replacement": {
    "start": 0,
    "end": 0
  }
}
```

One thing TypeScript offers at the cursor.

### Properties

| Name        | Type           | Required | Restrictions | Description                                                             |
| ----------- | -------------- | -------- | ------------ | ----------------------------------------------------------------------- |
| label       | string         | true     | none         | What is shown and inserted                                              |
| kind        | string         | true     | none         | TypeScript's kind of the entry: `method`, `property`, `function`, ...   |
| sortText    | string         | true     | none         | How TypeScript orders it                                                |
| insertText  | string \| null | true     | none         | Text to insert in place of the label, when it differs                   |
| replacement | object \| null | true     | none         | The text the completion replaces, when it is not the word at the cursor |

<h2 id="tocS_Completions">Completions</h2>
<!-- backwards compatibility -->
<a id="schemacompletions"></a>
<a id="schema_Completions"></a>
<a id="tocScompletions"></a>
<a id="tocscompletions"></a>

```json
{
  "items": [
    {
      "label": "string",
      "kind": "string",
      "sortText": "string",
      "insertText": "string",
      "replacement": {
        "start": 0,
        "end": 0
      }
    }
  ]
}
```

The completions at the cursor.

### Properties

| Name  | Type                                      | Required | Restrictions | Description                      |
| ----- | ----------------------------------------- | -------- | ------------ | -------------------------------- |
| items | [[CompletionItem](#schemacompletionitem)] | true     | none         | The items, in TypeScript's order |

<h2 id="tocS_PositionBody">PositionBody</h2>
<!-- backwards compatibility -->
<a id="schemapositionbody"></a>
<a id="schema_PositionBody"></a>
<a id="tocSpositionbody"></a>
<a id="tocspositionbody"></a>

```json
{
  "source": "string",
  "document": {},
  "offset": 0
}
```

The editor buffer and a place in it.

### Properties

| Name     | Type           | Required | Restrictions | Description                                          |
| -------- | -------------- | -------- | ------------ | ---------------------------------------------------- |
| source   | string         | true     | none         | The schema source, saved or not, or the query        |
| document | object         | false    | none         | Which editor it comes from; the schema when left out |
| offset   | integer(int32) | true     | none         | The UTF-16 offset of the cursor                      |

<h2 id="tocS_CompletionDetail">CompletionDetail</h2>
<!-- backwards compatibility -->
<a id="schemacompletiondetail"></a>
<a id="schema_CompletionDetail"></a>
<a id="tocScompletiondetail"></a>
<a id="tocscompletiondetail"></a>

```json
{
  "detail": "string",
  "documentation": "string"
}
```

The type and documentation of one completion.

### Properties

| Name          | Type           | Required | Restrictions | Description                  |
| ------------- | -------------- | -------- | ------------ | ---------------------------- |
| detail        | string \| null | true     | none         | Its signature or type        |
| documentation | string \| null | true     | none         | Its doc comment, as Markdown |

<h2 id="tocS_CompletionDetailBody">CompletionDetailBody</h2>
<!-- backwards compatibility -->
<a id="schemacompletiondetailbody"></a>
<a id="schema_CompletionDetailBody"></a>
<a id="tocScompletiondetailbody"></a>
<a id="tocscompletiondetailbody"></a>

```json
{
  "source": "string",
  "document": {},
  "offset": 0,
  "name": "string"
}
```

A completion to describe in full.

### Properties

| Name     | Type           | Required | Restrictions | Description                                          |
| -------- | -------------- | -------- | ------------ | ---------------------------------------------------- |
| source   | string         | true     | none         | The schema source, saved or not, or the query        |
| document | object         | false    | none         | Which editor it comes from; the schema when left out |
| offset   | integer(int32) | true     | none         | The UTF-16 offset of the cursor                      |
| name     | string         | true     | none         | The name of the completion                           |

<h2 id="tocS_Hover">Hover</h2>
<!-- backwards compatibility -->
<a id="schemahover"></a>
<a id="schema_Hover"></a>
<a id="tocShover"></a>
<a id="tocshover"></a>

```json
{
  "contents": "string",
  "range": {
    "start": 0,
    "end": 0
  }
}
```

What TypeScript says about the symbol at the cursor.

### Properties

| Name     | Type           | Required | Restrictions | Description                                                |
| -------- | -------------- | -------- | ------------ | ---------------------------------------------------------- |
| contents | string \| null | true     | none         | The type and documentation, as Markdown; null over nothing |
| range    | object \| null | true     | none         | The symbol's range                                         |

<h2 id="tocS_SignatureParameter">SignatureParameter</h2>
<!-- backwards compatibility -->
<a id="schemasignatureparameter"></a>
<a id="schema_SignatureParameter"></a>
<a id="tocSsignatureparameter"></a>
<a id="tocssignatureparameter"></a>

```json
{
  "label": "string",
  "documentation": "string"
}
```

One parameter of a signature.

### Properties

| Name          | Type           | Required | Restrictions | Description                   |
| ------------- | -------------- | -------- | ------------ | ----------------------------- |
| label         | string         | true     | none         | How it reads in the signature |
| documentation | string \| null | true     | none         | Its doc comment               |

<h2 id="tocS_Signature">Signature</h2>
<!-- backwards compatibility -->
<a id="schemasignature"></a>
<a id="schema_Signature"></a>
<a id="tocSsignature"></a>
<a id="tocssignature"></a>

```json
{
  "label": "string",
  "documentation": "string",
  "parameters": [
    {
      "label": "string",
      "documentation": "string"
    }
  ]
}
```

One overload of the call.

### Properties

| Name          | Type                                              | Required | Restrictions | Description         |
| ------------- | ------------------------------------------------- | -------- | ------------ | ------------------- |
| label         | string                                            | true     | none         | The whole signature |
| documentation | string \| null                                    | true     | none         | Its doc comment     |
| parameters    | [[SignatureParameter](#schemasignatureparameter)] | true     | none         | Its parameters      |

<h2 id="tocS_SignatureHelp">SignatureHelp</h2>
<!-- backwards compatibility -->
<a id="schemasignaturehelp"></a>
<a id="schema_SignatureHelp"></a>
<a id="tocSsignaturehelp"></a>
<a id="tocssignaturehelp"></a>

```json
{
  "signatures": [
    {
      "label": "string",
      "documentation": "string",
      "parameters": [
        {
          "label": "string",
          "documentation": "string"
        }
      ]
    }
  ],
  "activeSignature": 0,
  "activeParameter": 0
}
```

The signatures of the call the cursor is in.

### Properties

| Name            | Type                            | Required | Restrictions | Description                    |
| --------------- | ------------------------------- | -------- | ------------ | ------------------------------ |
| signatures      | [[Signature](#schemasignature)] | true     | none         | The overloads                  |
| activeSignature | integer(int32)                  | true     | none         | The overload TypeScript picked |
| activeParameter | integer(int32)                  | true     | none         | The parameter the cursor is on |

<h2 id="tocS_Diagnostic">Diagnostic</h2>
<!-- backwards compatibility -->
<a id="schemadiagnostic"></a>
<a id="schema_Diagnostic"></a>
<a id="tocSdiagnostic"></a>
<a id="tocsdiagnostic"></a>

```json
{
  "message": "string",
  "severity": "error",
  "range": {
    "start": 0,
    "end": 0
  }
}
```

One problem TypeScript found.

### Properties

| Name     | Type   | Required | Restrictions | Description   |
| -------- | ------ | -------- | ------------ | ------------- |
| message  | string | true     | none         | What is wrong |
| severity | string | true     | none         | How bad it is |
| range    | object | true     | none         | Where it is   |

#### Enumerated Values

| Property | Value   |
| -------- | ------- |
| severity | error   |
| severity | warning |
| severity | info    |

<h2 id="tocS_Diagnostics">Diagnostics</h2>
<!-- backwards compatibility -->
<a id="schemadiagnostics"></a>
<a id="schema_Diagnostics"></a>
<a id="tocSdiagnostics"></a>
<a id="tocsdiagnostics"></a>

```json
{
  "diagnostics": [
    {
      "message": "string",
      "severity": "error",
      "range": {
        "start": 0,
        "end": 0
      }
    }
  ]
}
```

The type errors of a source; its syntax errors come from the parser, with the diagram.

### Properties

| Name        | Type                              | Required | Restrictions | Description                        |
| ----------- | --------------------------------- | -------- | ------------ | ---------------------------------- |
| diagnostics | [[Diagnostic](#schemadiagnostic)] | true     | none         | The problems, in order of position |

<h2 id="tocS_ExecutedStatement">ExecutedStatement</h2>
<!-- backwards compatibility -->
<a id="schemaexecutedstatement"></a>
<a id="schema_ExecutedStatement"></a>
<a id="tocSexecutedstatement"></a>
<a id="tocsexecutedstatement"></a>

```json
{
  "sql": "string",
  "params": [null],
  "rowCount": 0,
  "durationMs": 0
}
```

One statement Drizzle sent to the database.

### Properties

| Name       | Type           | Required | Restrictions | Description                          |
| ---------- | -------------- | -------- | ------------ | ------------------------------------ |
| sql        | string         | true     | none         | The SQL                              |
| params     | [object]       | true     | none         | Its parameters                       |
| rowCount   | integer(int32) | true     | none         | Rows returned, or changed by a write |
| durationMs | number(double) | true     | none         | How long it took                     |

<h2 id="tocS_QueryResult">QueryResult</h2>
<!-- backwards compatibility -->
<a id="schemaqueryresult"></a>
<a id="schema_QueryResult"></a>
<a id="tocSqueryresult"></a>
<a id="tocsqueryresult"></a>

```json
{
  "result": null,
  "error": "string",
  "statements": [
    {
      "sql": "string",
      "params": [null],
      "rowCount": 0,
      "durationMs": 0
    }
  ],
  "durationMs": 0
}
```

What a query gave, and what the database was asked on the way.

### Properties

| Name       | Type                                            | Required | Restrictions | Description                                         |
| ---------- | ----------------------------------------------- | -------- | ------------ | --------------------------------------------------- |
| result     | object                                          | true     | none         | The value of the query, as JSON; null when it threw |
| error      | string \| null                                  | true     | none         | The message it threw, null when it did not          |
| statements | [[ExecutedStatement](#schemaexecutedstatement)] | true     | none         | The statements, in the order they ran               |
| durationMs | number(double)                                  | true     | none         | How long the query took in all                      |

<h2 id="tocS_QueryBody">QueryBody</h2>
<!-- backwards compatibility -->
<a id="schemaquerybody"></a>
<a id="schema_QueryBody"></a>
<a id="tocSquerybody"></a>
<a id="tocsquerybody"></a>

```json
{
  "code": "string"
}
```

Drizzle code to run.

### Properties

| Name | Type   | Required | Restrictions | Description                                                                                                                               |
| ---- | ------ | -------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| code | string | true     | none         | The body of an async function with `db`, the schema's exports and drizzle-orm's operators<br>in scope; its last expression is the result. |

<h2 id="tocS_TouchedTable">TouchedTable</h2>
<!-- backwards compatibility -->
<a id="schematouchedtable"></a>
<a id="schema_TouchedTable"></a>
<a id="tocStouchedtable"></a>
<a id="tocstouchedtable"></a>

```json
{
  "table": "string",
  "columns": ["string"],
  "write": true
}
```

A table Drizzle code touches.

### Properties

| Name    | Type     | Required | Restrictions | Description                                                                                 |
| ------- | -------- | -------- | ------------ | ------------------------------------------------------------------------------------------- |
| table   | string   | true     | none         | The table's exported name                                                                   |
| columns | [string] | true     | none         | The columns the code names on it, as `table.column`                                         |
| write   | boolean  | true     | none         | Whether the code writes to it: `db.insert(table)`, `db.update(table)` or `db.delete(table)` |

<h2 id="tocS_QueryTouched">QueryTouched</h2>
<!-- backwards compatibility -->
<a id="schemaquerytouched"></a>
<a id="schema_QueryTouched"></a>
<a id="tocSquerytouched"></a>
<a id="tocsquerytouched"></a>

```json
{
  "tables": [
    {
      "table": "string",
      "columns": ["string"],
      "write": true
    }
  ]
}
```

The tables Drizzle code touches, for the diagram beside the editor to light up.

### Properties

| Name   | Type                                  | Required | Restrictions | Description                                                                                             |
| ------ | ------------------------------------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| tables | [[TouchedTable](#schematouchedtable)] | true     | none         | The tables read by name, through `db.query`, or reached by a `with`; empty when the code does not parse |

<h2 id="tocS_TouchedBody">TouchedBody</h2>
<!-- backwards compatibility -->
<a id="schematouchedbody"></a>
<a id="schema_TouchedBody"></a>
<a id="tocStouchedbody"></a>
<a id="tocstouchedbody"></a>

```json
{
  "code": "string"
}
```

Drizzle code, written or being written, to read the tables of.

### Properties

| Name | Type   | Required | Restrictions | Description                     |
| ---- | ------ | -------- | ------------ | ------------------------------- |
| code | string | true     | none         | The code as the editor holds it |
