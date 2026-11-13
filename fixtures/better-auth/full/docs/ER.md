```mermaid
erDiagram
    user ||--|{ session : "(id) - (userId)"
    user ||--|{ account : "(id) - (userId)"
    organization ||--|{ organizationRole : "(id) - (organizationId)"
    organization ||--|{ team : "(id) - (organizationId)"
    team ||--|{ teamMember : "(id) - (teamId)"
    user ||--|{ teamMember : "(id) - (userId)"
    organization ||--|{ member : "(id) - (organizationId)"
    user ||--|{ member : "(id) - (userId)"
    organization ||--|{ invitation : "(id) - (organizationId)"
    user ||--|{ invitation : "(id) - (inviterId)"
    user ||--|{ walletAddress : "(id) - (userId)"
    user ||--|{ twoFactor : "(id) - (userId)"
    user {
        text id PK
        text name
        text email
        boolean emailVerified
        text image
        timestamp createdAt
        timestamp updatedAt
        text role
        boolean banned
        text banReason
        timestamp banExpires
        boolean isAnonymous
        text lastLoginMethod
        text phoneNumber
        boolean phoneNumberVerified
        boolean twoFactorEnabled
        text username
        text displayUsername
    }
    session {
        text id PK
        timestamp expiresAt
        text token
        timestamp createdAt
        timestamp updatedAt
        text ipAddress
        text userAgent
        text userId FK
        text impersonatedBy
        text activeOrganizationId
        text activeTeamId
    }
    account {
        text id PK
        text accountId
        text providerId
        text userId FK
        text accessToken
        text refreshToken
        text idToken
        timestamp accessTokenExpiresAt
        timestamp refreshTokenExpiresAt
        text scope
        text password
        timestamp createdAt
        timestamp updatedAt
    }
    verification {
        text id PK
        text identifier
        text value
        timestamp expiresAt
        timestamp createdAt
        timestamp updatedAt
    }
    deviceCode {
        text id PK
        text deviceCode
        text userCode
        text userId
        timestamp expiresAt
        text status
        timestamp lastPolledAt
        integer pollingInterval
        text clientId
        text scope
    }
    jwks {
        text id PK
        text publicKey
        text privateKey
        timestamp createdAt
        timestamp expiresAt
        text alg
        text crv
    }
    organization {
        text id PK
        text name
        text slug
        text logo
        timestamp createdAt
        text metadata
    }
    organizationRole {
        text id PK
        text organizationId FK
        text role
        text permission
        timestamp createdAt
        timestamp updatedAt
    }
    team {
        text id PK
        text name
        integer memberCount
        text organizationId FK
        timestamp createdAt
        timestamp updatedAt
    }
    teamMember {
        text id PK
        text teamId FK
        text userId FK
        text membershipKey
        timestamp createdAt
    }
    member {
        text id PK
        text organizationId FK
        text userId FK
        text role
        timestamp createdAt
    }
    invitation {
        text id PK
        text organizationId FK
        text email
        text role
        text teamId
        text status
        timestamp expiresAt
        timestamp createdAt
        text inviterId FK
    }
    walletAddress {
        text id PK
        text userId FK
        text address
        integer chainId
        boolean isPrimary
        timestamp createdAt
    }
    twoFactor {
        text id PK
        text secret
        text backupCodes
        text userId FK
        boolean verified
        integer failedVerificationCount
        timestamp lockedUntil
    }
```
