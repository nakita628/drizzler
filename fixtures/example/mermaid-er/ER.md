```mermaid
erDiagram
    user ||--o{ post : "(id) - (user_id)"
    user {
        varchar id PK "Primary key"
        varchar name "Display name"
    }
    post {
        varchar id PK "Primary key"
        varchar title "Article title"
        varchar content "Body content (no length limit)"
        varchar user_id FK "Foreign key referencing User.id"
    }
```
