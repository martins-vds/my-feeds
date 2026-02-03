# Data Model: RSS Feed Reader Core

**Feature Branch**: `001-rss-feed-reader`  
**Date**: 2026-02-03  
**Purpose**: Define entities, relationships, and validation rules extracted from feature specification

## Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    User     │       │  Category   │       │    Feed     │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │──1:N──│ id (PK)     │──1:N──│ id (PK)     │
│ provider    │       │ user_id(FK) │       │ category_id │
│ provider_id │       │ name        │       │ url         │
│ email       │       │ position    │       │ title       │
│ name        │       │ created_at  │       │ description │
│ timezone    │       │ updated_at  │       │ site_url    │
│ created_at  │       └─────────────┘       │ last_fetched│
│ updated_at  │                             │ created_at  │
└─────────────┘                             └─────────────┘
       │                                           │
       │                                           │
       │         ┌─────────────┐                   │
       │         │    Post     │                   │
       │         ├─────────────┤                   │
       │         │ id (PK)     │───────────────────┘
       │         │ feed_id(FK) │                 1:N
       │         │ guid        │
       │         │ title       │       ┌─────────────┐
       │         │ content     │──1:1──│   Audio     │
       │         │ author      │       ├─────────────┤
       │         │ link        │       │ id (PK)     │
       │         │ published_at│       │ post_id(FK) │
       │         │ fetched_at  │       │ cache_key   │
       │         └─────────────┘       │ file_path   │
       │                │              │ duration_sec│
       │                │              │ file_size   │
       │                │              │ created_at  │
       │                │              └─────────────┘
       │                │
       │                ▼ N:M (via junction)
       │         ┌─────────────┐
       └─────────│  UserPost   │ (Read State)
           N:M   ├─────────────┤
                 │ user_id(FK) │
                 │ post_id(FK) │
                 │ is_read     │
                 │ read_at     │
                 └─────────────┘

       ┌─────────────────────┐
       │  PushSubscription   │
       ├─────────────────────┤
       │ id (PK)             │
       │ user_id (FK)        │──────── User (1:N)
       │ endpoint            │
       │ p256dh              │
       │ auth                │
       │ user_agent          │
       │ created_at          │
       │ last_success_at     │
       │ failure_count       │
       └─────────────────────┘
```

---

## Entities

### User

**Description**: Authenticated individual with unique identity from OAuth provider.

| Field                   | Type         | Constraints                    | Description                              |
| ----------------------- | ------------ | ------------------------------ | ---------------------------------------- |
| `id`                    | UUID         | PK                             | Internal unique identifier               |
| `provider`              | ENUM         | NOT NULL                       | `github`, `google`, `microsoft`          |
| `provider_id`           | VARCHAR(255) | NOT NULL, UNIQUE with provider | User ID from OAuth provider              |
| `email`                 | VARCHAR(255) | NOT NULL                       | Email from OAuth provider                |
| `name`                  | VARCHAR(255) | NULL                           | Display name from OAuth                  |
| `avatar_url`            | VARCHAR(512) | NULL                           | Profile picture URL                      |
| `timezone`              | VARCHAR(64)  | NOT NULL, DEFAULT 'UTC'        | IANA timezone (e.g., `America/New_York`) |
| `notifications_enabled` | BOOLEAN      | NOT NULL, DEFAULT FALSE        | Daily notification preference            |
| `created_at`            | TIMESTAMP    | NOT NULL, DEFAULT NOW()        | Account creation time                    |
| `updated_at`            | TIMESTAMP    | NOT NULL                       | Last profile update                      |

**Validation Rules**:
- `provider` + `provider_id` must be unique (composite unique constraint)
- `email` must be valid email format
- `timezone` must be valid IANA timezone identifier

**Indexes**:
- `idx_user_provider` on (`provider`, `provider_id`) - OAuth lookup
- `idx_user_email` on (`email`) - Email lookup

---

### Category

**Description**: Named grouping for organizing feeds.

| Field        | Type         | Constraints             | Description                         |
| ------------ | ------------ | ----------------------- | ----------------------------------- |
| `id`         | UUID         | PK                      | Unique identifier                   |
| `user_id`    | UUID         | FK → User, NOT NULL     | Owner                               |
| `name`       | VARCHAR(100) | NOT NULL                | Category display name               |
| `position`   | INTEGER      | NOT NULL, DEFAULT 0     | Sort order within user's categories |
| `created_at` | TIMESTAMP    | NOT NULL, DEFAULT NOW() | Creation time                       |
| `updated_at` | TIMESTAMP    | NOT NULL                | Last modification                   |

**Validation Rules**:
- `name` must be 1-100 characters
- `name` must be unique per user (composite unique on `user_id`, `name`)
- `position` must be >= 0

**Indexes**:
- `idx_category_user` on (`user_id`) - List user's categories
- `idx_category_user_position` on (`user_id`, `position`) - Ordered listing

---

### Feed

**Description**: RSS/Atom subscription with URL, title, and metadata.

| Field               | Type          | Constraints             | Description                     |
| ------------------- | ------------- | ----------------------- | ------------------------------- |
| `id`                | UUID          | PK                      | Unique identifier               |
| `category_id`       | UUID          | FK → Category, NOT NULL | Parent category                 |
| `url`               | VARCHAR(2048) | NOT NULL                | Feed URL                        |
| `title`             | VARCHAR(500)  | NULL                    | Feed title (from feed metadata) |
| `description`       | TEXT          | NULL                    | Feed description                |
| `site_url`          | VARCHAR(2048) | NULL                    | Website URL                     |
| `icon_url`          | VARCHAR(2048) | NULL                    | Feed/site favicon               |
| `last_fetched_at`   | TIMESTAMP     | NULL                    | Last successful fetch           |
| `last_error`        | TEXT          | NULL                    | Last fetch error message        |
| `fetch_error_count` | INTEGER       | NOT NULL, DEFAULT 0     | Consecutive fetch failures      |
| `created_at`        | TIMESTAMP     | NOT NULL, DEFAULT NOW() | Subscription time               |
| `updated_at`        | TIMESTAMP     | NOT NULL                | Last modification               |

**Validation Rules**:
- `url` must be valid HTTP/HTTPS URL
- `url` must be unique per category (composite unique on `category_id`, `url`)
- `fetch_error_count` must be >= 0

**Indexes**:
- `idx_feed_category` on (`category_id`) - List feeds in category
- `idx_feed_url` on (`url`) - URL lookup for validation
- `idx_feed_last_fetched` on (`last_fetched_at`) - Fetch scheduling

---

### Post

**Description**: Individual article/entry from a feed.

| Field          | Type          | Constraints                            | Description                           |
| -------------- | ------------- | -------------------------------------- | ------------------------------------- |
| `id`           | UUID          | PK                                     | Unique identifier                     |
| `feed_id`      | UUID          | FK → Feed, NOT NULL, ON DELETE CASCADE | Parent feed                           |
| `guid`         | VARCHAR(2048) | NOT NULL                               | Unique ID from feed (guid/id element) |
| `title`        | VARCHAR(1000) | NOT NULL                               | Post title                            |
| `content`      | TEXT          | NULL                                   | Full post content (HTML)              |
| `summary`      | TEXT          | NULL                                   | Post summary/excerpt                  |
| `author`       | VARCHAR(255)  | NULL                                   | Author name                           |
| `link`         | VARCHAR(2048) | NOT NULL                               | Original article URL                  |
| `published_at` | TIMESTAMP     | NOT NULL                               | Publication date from feed            |
| `fetched_at`   | TIMESTAMP     | NOT NULL, DEFAULT NOW()                | When we fetched this post             |

**Validation Rules**:
- `guid` must be unique per feed (composite unique on `feed_id`, `guid`)
- `published_at` must not be in the future (allow small tolerance)
- Posts older than 90 days from `published_at` are subject to automatic deletion (FR-032)

**Indexes**:
- `idx_post_feed_published` on (`feed_id`, `published_at` DESC) - Feed timeline
- `idx_post_published` on (`published_at` DESC) - Global timeline
- `idx_post_guid` on (`feed_id`, `guid`) - Duplicate detection

---

### UserPost (Read State Junction)

**Description**: Tracks per-user read state for posts.

| Field     | Type      | Constraints                      | Description         |
| --------- | --------- | -------------------------------- | ------------------- |
| `user_id` | UUID      | PK, FK → User, ON DELETE CASCADE | User                |
| `post_id` | UUID      | PK, FK → Post, ON DELETE CASCADE | Post                |
| `is_read` | BOOLEAN   | NOT NULL, DEFAULT FALSE          | Read status         |
| `read_at` | TIMESTAMP | NULL                             | When marked as read |

**Validation Rules**:
- Composite PK on (`user_id`, `post_id`)
- `read_at` should be set when `is_read` = TRUE

**Indexes**:
- `idx_userpost_user_unread` on (`user_id`, `is_read`) WHERE `is_read` = FALSE - Unread filter

**Note**: UserPost records are created on-demand when a user opens a post (auto-mark read) or toggles read state.

---

### Audio

**Description**: Cached text-to-speech rendering of a post.

| Field              | Type          | Constraints                          | Description                         |
| ------------------ | ------------- | ------------------------------------ | ----------------------------------- |
| `id`               | UUID          | PK                                   | Unique identifier                   |
| `post_id`          | UUID          | FK → Post, UNIQUE, ON DELETE CASCADE | Source post                         |
| `cache_key`        | VARCHAR(64)   | NOT NULL, UNIQUE                     | SHA256 hash of content+voice+format |
| `file_path`        | VARCHAR(512)  | NOT NULL                             | Relative path to audio file         |
| `format`           | VARCHAR(10)   | NOT NULL, DEFAULT 'mp3'              | Audio format                        |
| `voice_id`         | VARCHAR(64)   | NOT NULL                             | TTS voice identifier                |
| `duration_seconds` | DECIMAL(10,2) | NULL                                 | Audio duration                      |
| `file_size_bytes`  | BIGINT        | NULL                                 | File size                           |
| `created_at`       | TIMESTAMP     | NOT NULL, DEFAULT NOW()              | Generation time                     |
| `last_accessed_at` | TIMESTAMP     | NOT NULL                             | Last playback request               |
| `access_count`     | INTEGER       | NOT NULL, DEFAULT 0                  | Playback count                      |

**Validation Rules**:
- One-to-one relationship with Post (`post_id` is UNIQUE)
- `cache_key` must be unique (prevent duplicate generation)
- `format` must be one of: `mp3`, `ogg`, `wav`

**Indexes**:
- `idx_audio_post` on (`post_id`) - Lookup by post
- `idx_audio_cache_key` on (`cache_key`) - Cache lookup
- `idx_audio_last_accessed` on (`last_accessed_at`) - LRU eviction

---

### PushSubscription

**Description**: Web Push subscription for notifications.

| Field             | Type         | Constraints                            | Description               |
| ----------------- | ------------ | -------------------------------------- | ------------------------- |
| `id`              | UUID         | PK                                     | Unique identifier         |
| `user_id`         | UUID         | FK → User, NOT NULL, ON DELETE CASCADE | Subscriber                |
| `endpoint`        | TEXT         | NOT NULL, UNIQUE                       | Push service endpoint URL |
| `p256dh`          | VARCHAR(255) | NOT NULL                               | Encryption key            |
| `auth`            | VARCHAR(255) | NOT NULL                               | Auth secret               |
| `user_agent`      | VARCHAR(512) | NULL                                   | Browser/device info       |
| `created_at`      | TIMESTAMP    | NOT NULL, DEFAULT NOW()                | Subscription time         |
| `last_success_at` | TIMESTAMP    | NULL                                   | Last successful push      |
| `failure_count`   | INTEGER      | NOT NULL, DEFAULT 0                    | Consecutive failures      |

**Validation Rules**:
- `endpoint` must be unique (one subscription per browser/device)
- After 3 consecutive failures (404/410), subscription should be deleted

**Indexes**:
- `idx_pushsub_user` on (`user_id`) - List user's subscriptions
- `idx_pushsub_endpoint` on (`endpoint`) - Lookup by endpoint

---

## State Transitions

### Post Read State

```
                     ┌─────────────────────┐
                     │                     │
                     ▼                     │
┌─────────┐    User opens    ┌─────────┐   │   Manual toggle
│ Unread  │ ───────────────► │  Read   │ ──┘
│         │                  │         │
│(default)│ ◄─────────────── │         │
└─────────┘   Manual toggle  └─────────┘
```

### Feed Fetch State

```
┌──────────┐     Fetch success      ┌──────────┐
│  Active  │ ◄────────────────────► │  Active  │
│          │                        │          │
└──────────┘                        └──────────┘
     │                                   ▲
     │ Fetch failure                     │
     ▼                                   │
┌──────────┐     Retry success      ┌──────────┐
│ Error(1) │ ──────────────────────►│  Active  │
│          │                        │          │
└──────────┘                        └──────────┘
     │
     │ Consecutive failures (up to 10)
     ▼
┌──────────┐
│ Disabled │  (Requires manual re-enable)
│          │
└──────────┘
```

---

## Cascade Delete Rules

| Parent   | Child            | On Delete |
| -------- | ---------------- | --------- |
| User     | Category         | CASCADE   |
| User     | UserPost         | CASCADE   |
| User     | PushSubscription | CASCADE   |
| Category | Feed             | CASCADE   |
| Feed     | Post             | CASCADE   |
| Post     | UserPost         | CASCADE   |
| Post     | Audio            | CASCADE   |

---

## Data Retention (FR-032)

**90-Day Post Retention Policy**:

```sql
-- Scheduled job (daily)
DELETE FROM posts
WHERE published_at < NOW() - INTERVAL '90 days';
```

**Audio Cleanup** (cascades from Post deletion, plus LRU eviction):

```sql
-- LRU eviction when storage exceeds threshold
DELETE FROM audio
WHERE last_accessed_at < NOW() - INTERVAL '30 days'
ORDER BY access_count ASC, last_accessed_at ASC
LIMIT [batch_size];
```
