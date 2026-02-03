# Tasks: RSS Feed Reader Core

**Input**: Design documents from `/specs/001-rss-feed-reader/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**TDD Approach**: Per Constitution v1.1.0, all implementation follows Red-Green-Refactor. Tests are written FIRST for each task.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `backend/app/`, `backend/tests/`
- **Frontend**: `frontend/src/`, `frontend/playwright/`
- **Dev Container**: `.devcontainer/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create monorepo directory structure per plan.md in repository root
- [x] T002 [P] Initialize backend Python project with uv in backend/pyproject.toml
- [x] T003 [P] Initialize frontend React+Vite project with pnpm in frontend/package.json
- [x] T004 [P] Create Dev Container configuration in .devcontainer/devcontainer.json
- [x] T005 [P] Create docker-compose.yml with PostgreSQL and backend/frontend services in .devcontainer/docker-compose.yml
- [x] T006 [P] Configure backend linting (ruff) and formatting in backend/pyproject.toml
- [x] T007 [P] Configure frontend linting (ESLint) and formatting (Prettier) in frontend/
- [x] T008 [P] Configure Vitest for frontend unit tests in frontend/vite.config.ts
- [x] T009 [P] Configure Playwright for frontend UI tests in frontend/playwright.config.ts
- [x] T010 [P] Configure pytest with pytest-asyncio in backend/pyproject.toml

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T011 Create Quart application factory in backend/app/main.py
- [x] T012 Setup quart-injector DI container with Module pattern in backend/app/config/container.py
- [x] T013 Configure SQLAlchemy async engine with asyncpg in backend/app/infrastructure/persistence/database.py
- [x] T014 Setup Alembic migrations framework in backend/migrations/
- [x] T015 [P] Create User SQLAlchemy model in backend/app/infrastructure/persistence/models/user.py
- [x] T016 [P] Create Category SQLAlchemy model in backend/app/infrastructure/persistence/models/category.py
- [x] T017 [P] Create Feed SQLAlchemy model in backend/app/infrastructure/persistence/models/feed.py
- [x] T018 [P] Create Post SQLAlchemy model in backend/app/infrastructure/persistence/models/post.py
- [x] T019 [P] Create UserPost (read state) SQLAlchemy model in backend/app/infrastructure/persistence/models/user_post.py
- [x] T020 [P] Create Audio SQLAlchemy model in backend/app/infrastructure/persistence/models/audio.py
- [x] T021 [P] Create PushSubscription SQLAlchemy model in backend/app/infrastructure/persistence/models/push_subscription.py
- [x] T022 Generate initial Alembic migration with all models
- [x] T023 [P] Create base repository interface in backend/app/domain/shared/repository.py
- [x] T024 [P] Configure error handling middleware in backend/app/api/middleware/error_handler.py
- [x] T025 [P] Configure logging infrastructure in backend/app/config/logging.py
- [x] T026 [P] Create environment configuration management in backend/app/config/settings.py
- [x] T027 [P] Setup API Blueprint structure in backend/app/api/__init__.py
- [x] T028 [P] Create TypeScript API client base in frontend/src/services/api.ts
- [x] T029 [P] Create React Router configuration in frontend/src/App.tsx
- [x] T030 [P] Configure Material UI theme in frontend/src/theme.ts
- [x] T031 [P] Setup auth context for session state in frontend/src/contexts/AuthContext.tsx

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Sign In and Access My Feeds (Priority: P1) 🎯 MVP

**Goal**: Users can sign in via GitHub/Google/Microsoft OAuth and maintain sessions

**Independent Test**: Complete OAuth flow, verify session established, sign out works

### Tests for User Story 1 (TDD - Write First, Must Fail)

- [x] T032 [P] [US1] Contract test for GET /auth/login/{provider} in backend/tests/contract/test_auth.py
- [x] T033 [P] [US1] Contract test for GET /auth/{provider}/callback in backend/tests/contract/test_auth.py
- [x] T034 [P] [US1] Contract test for GET /auth/me in backend/tests/contract/test_auth.py
- [x] T035 [P] [US1] Contract test for POST /auth/logout in backend/tests/contract/test_auth.py
- [x] T036 [P] [US1] Unit test for OAuth service in backend/tests/unit/test_oauth_service.py
- [x] T037 [P] [US1] Vitest unit test for useAuth hook in frontend/src/hooks/__tests__/useAuth.test.ts
- [x] T038 [P] [US1] Playwright test for sign-in flow in frontend/playwright/auth.spec.ts

### Implementation for User Story 1

- [x] T039 [US1] Create User domain entity in backend/app/domain/feed_management/entities/user.py
- [x] T040 [US1] Create UserRepository interface in backend/app/domain/feed_management/repositories/user_repository.py
- [x] T041 [US1] Implement SQLAlchemyUserRepository in backend/app/infrastructure/persistence/repositories/user_repository.py
- [x] T042 [US1] Create OAuth service with Authlib integration in backend/app/infrastructure/oauth/oauth_service.py
- [x] T043 [US1] Configure OAuth providers (GitHub, Google, Microsoft) in backend/app/infrastructure/oauth/providers.py
- [x] T044 [US1] Create session management with HttpOnly cookies in backend/app/infrastructure/oauth/session.py
- [x] T045 [US1] Implement auth routes (login, callback, me, logout) in backend/app/api/routes/auth.py
- [x] T046 [US1] Register OAuth DI module in backend/app/config/modules/oauth_module.py
- [x] T047 [P] [US1] Create SignInPage component in frontend/src/pages/auth/SignInPage.tsx
- [x] T048 [P] [US1] Create useAuth hook in frontend/src/hooks/useAuth.ts
- [x] T049 [P] [US1] Create AuthCallback page in frontend/src/pages/auth/AuthCallback.tsx
- [x] T050 [US1] Add protected route wrapper in frontend/src/components/ProtectedRoute.tsx
- [x] T051 [US1] Add user avatar and sign-out button to header in frontend/src/components/Header.tsx

**Checkpoint**: User Story 1 complete - OAuth sign-in/sign-out works independently

---

## Phase 4: User Story 2 - Organize Feeds by Category (Priority: P2)

**Goal**: Users can create categories and add/manage RSS feeds within them

**Independent Test**: Create category, add feed URL, verify feed appears under category

### Tests for User Story 2 (TDD - Write First, Must Fail)

- [ ] T052 [P] [US2] Contract test for GET/POST /categories in backend/tests/contract/test_categories.py
- [ ] T053 [P] [US2] Contract test for GET/PATCH/DELETE /categories/{id} in backend/tests/contract/test_categories.py
- [ ] T054 [P] [US2] Contract test for GET/POST /categories/{id}/feeds in backend/tests/contract/test_feeds.py
- [ ] T055 [P] [US2] Contract test for GET/PATCH/DELETE /feeds/{id} in backend/tests/contract/test_feeds.py
- [ ] T056 [P] [US2] Unit test for CategoryService in backend/tests/unit/test_category_service.py
- [ ] T057 [P] [US2] Unit test for FeedService in backend/tests/unit/test_feed_service.py
- [ ] T058 [P] [US2] Unit test for feed URL validation in backend/tests/unit/test_feed_validator.py
- [ ] T059 [P] [US2] Vitest unit test for CategoryList component in frontend/src/components/__tests__/CategoryList.test.tsx
- [ ] T060 [P] [US2] Playwright test for category/feed management in frontend/playwright/feeds.spec.ts

### Implementation for User Story 2

- [ ] T061 [US2] Create Category domain entity in backend/app/domain/feed_management/entities/category.py
- [ ] T062 [US2] Create Feed domain entity in backend/app/domain/feed_management/entities/feed.py
- [ ] T063 [US2] Create CategoryRepository interface in backend/app/domain/feed_management/repositories/category_repository.py
- [ ] T064 [US2] Create FeedRepository interface in backend/app/domain/feed_management/repositories/feed_repository.py
- [ ] T065 [US2] Implement SQLAlchemyCategoryRepository in backend/app/infrastructure/persistence/repositories/category_repository.py
- [ ] T066 [US2] Implement SQLAlchemyFeedRepository in backend/app/infrastructure/persistence/repositories/feed_repository.py
- [ ] T067 [US2] Create FeedFetcher service using feedparser in backend/app/infrastructure/feed_fetcher/feed_fetcher.py
- [ ] T068 [US2] Create FeedValidator for URL validation in backend/app/domain/feed_management/services/feed_validator.py
- [ ] T069 [US2] Create CategoryService application service in backend/app/application/services/category_service.py
- [ ] T070 [US2] Create FeedService application service in backend/app/application/services/feed_service.py
- [ ] T071 [US2] Implement category routes in backend/app/api/routes/categories.py
- [ ] T072 [US2] Implement feed routes in backend/app/api/routes/feeds.py
- [ ] T073 [US2] Register FeedManagement DI module in backend/app/config/modules/feed_module.py
- [ ] T074 [P] [US2] Create FeedsPage layout in frontend/src/pages/feeds/FeedsPage.tsx
- [ ] T075 [P] [US2] Create CategoryList component in frontend/src/components/CategoryList.tsx
- [ ] T076 [P] [US2] Create CategoryForm dialog in frontend/src/components/CategoryForm.tsx
- [ ] T077 [P] [US2] Create FeedList component in frontend/src/components/FeedList.tsx
- [ ] T078 [P] [US2] Create AddFeedDialog component in frontend/src/components/AddFeedDialog.tsx
- [ ] T079 [US2] Create useFeedsData hook in frontend/src/hooks/useFeedsData.ts

**Checkpoint**: User Story 2 complete - Categories and feeds work independently

---

## Phase 5: User Story 3 - Browse Latest Posts (Priority: P3)

**Goal**: Users see unified chronological view of posts from all subscribed feeds

**Independent Test**: Subscribe to feeds, view Latest Posts, verify posts appear sorted by date

### Tests for User Story 3 (TDD - Write First, Must Fail)

- [ ] T080 [P] [US3] Contract test for GET /posts in backend/tests/contract/test_posts.py
- [ ] T081 [P] [US3] Unit test for PostService in backend/tests/unit/test_post_service.py
- [ ] T082 [P] [US3] Unit test for feed fetch scheduler in backend/tests/unit/test_feed_scheduler.py
- [ ] T083 [P] [US3] Vitest unit test for PostList component in frontend/src/components/__tests__/PostList.test.tsx
- [ ] T084 [P] [US3] Playwright test for posts browsing in frontend/playwright/posts.spec.ts

### Implementation for User Story 3

- [ ] T085 [US3] Create Post domain entity in backend/app/domain/feed_management/entities/post.py
- [ ] T086 [US3] Create PostRepository interface in backend/app/domain/feed_management/repositories/post_repository.py
- [ ] T087 [US3] Implement SQLAlchemyPostRepository in backend/app/infrastructure/persistence/repositories/post_repository.py
- [ ] T088 [US3] Create FeedFetchScheduler for periodic fetching in backend/app/infrastructure/feed_fetcher/scheduler.py
- [ ] T089 [US3] Create PostService application service in backend/app/application/services/post_service.py
- [ ] T090 [US3] Implement posts routes (list with filters) in backend/app/api/routes/posts.py
- [ ] T091 [P] [US3] Create PostsPage layout in frontend/src/pages/posts/PostsPage.tsx
- [ ] T092 [P] [US3] Create PostList component in frontend/src/components/PostList.tsx
- [ ] T093 [P] [US3] Create PostCard component in frontend/src/components/PostCard.tsx
- [ ] T094 [P] [US3] Create CategoryFilter component in frontend/src/components/CategoryFilter.tsx
- [ ] T095 [US3] Create usePostsData hook with pagination in frontend/src/hooks/usePostsData.ts

**Checkpoint**: User Story 3 complete - Post browsing works independently

---

## Phase 6: User Story 4 - Read Post Content (Priority: P4)

**Goal**: Users can read full post content with auto-mark-read and manual toggle

**Independent Test**: Click post, verify content displays, verify read state updates

### Tests for User Story 4 (TDD - Write First, Must Fail)

- [ ] T096 [P] [US4] Contract test for GET /posts/{id} in backend/tests/contract/test_posts.py
- [ ] T097 [P] [US4] Contract test for PUT /posts/{id}/read-state in backend/tests/contract/test_posts.py
- [ ] T098 [P] [US4] Unit test for read state service in backend/tests/unit/test_read_state_service.py
- [ ] T099 [P] [US4] Vitest unit test for PostDetail component in frontend/src/components/__tests__/PostDetail.test.tsx
- [ ] T100 [P] [US4] Playwright test for post reading in frontend/playwright/post-detail.spec.ts

### Implementation for User Story 4

- [ ] T101 [US4] Create UserPost domain entity (read state) in backend/app/domain/feed_management/entities/user_post.py
- [ ] T102 [US4] Create ReadStateRepository interface in backend/app/domain/feed_management/repositories/read_state_repository.py
- [ ] T103 [US4] Implement SQLAlchemyReadStateRepository in backend/app/infrastructure/persistence/repositories/read_state_repository.py
- [ ] T104 [US4] Create ReadStateService in backend/app/application/services/read_state_service.py
- [ ] T105 [US4] Implement post detail route (auto-marks read) in backend/app/api/routes/posts.py
- [ ] T106 [US4] Implement read state toggle route in backend/app/api/routes/posts.py
- [ ] T107 [P] [US4] Create PostDetailPage in frontend/src/pages/posts/PostDetailPage.tsx
- [ ] T108 [P] [US4] Create PostContent renderer in frontend/src/components/PostContent.tsx
- [ ] T109 [P] [US4] Create ReadStateToggle component in frontend/src/components/ReadStateToggle.tsx
- [ ] T110 [US4] Add read state filter to PostsPage in frontend/src/pages/posts/PostsPage.tsx

**Checkpoint**: User Story 4 complete - Post reading with read state works independently

---

## Phase 7: User Story 5 - Listen to Posts via TTS (Priority: P5)

**Goal**: Users can listen to posts via text-to-speech with lazy generation and caching

**Independent Test**: Click Listen on post, verify audio plays, verify cached playback is faster

### Tests for User Story 5 (TDD - Write First, Must Fail)

- [ ] T111 [P] [US5] Contract test for GET /posts/{id}/audio in backend/tests/contract/test_audio.py
- [ ] T112 [P] [US5] Contract test for GET /audio/{cacheKey} streaming in backend/tests/contract/test_audio.py
- [ ] T113 [P] [US5] Unit test for TTSService in backend/tests/unit/test_tts_service.py
- [ ] T114 [P] [US5] Unit test for AudioCacheService in backend/tests/unit/test_audio_cache.py
- [ ] T115 [P] [US5] Vitest unit test for AudioPlayer component in frontend/src/components/__tests__/AudioPlayer.test.tsx
- [ ] T116 [P] [US5] Playwright test for TTS playback in frontend/playwright/audio.spec.ts

### Implementation for User Story 5

- [ ] T117 [US5] Create Audio domain entity in backend/app/domain/audio/entities/audio.py
- [ ] T118 [US5] Create AudioRepository interface in backend/app/domain/audio/repositories/audio_repository.py
- [ ] T119 [US5] Implement SQLAlchemyAudioRepository in backend/app/infrastructure/persistence/repositories/audio_repository.py
- [ ] T120 [US5] Create TTSService interface in backend/app/domain/audio/services/tts_service.py
- [ ] T121 [US5] Implement AzureTTSService in backend/app/infrastructure/tts/azure_tts.py
- [ ] T122 [US5] Create AudioCacheManager in backend/app/infrastructure/tts/cache_manager.py
- [ ] T123 [US5] Create AudioService application service in backend/app/application/services/audio_service.py
- [ ] T124 [US5] Implement audio routes (get/generate, stream) in backend/app/api/routes/audio.py
- [ ] T125 [US5] Register Audio DI module in backend/app/config/modules/audio_module.py
- [ ] T126 [P] [US5] Create AudioPlayer component in frontend/src/components/AudioPlayer.tsx
- [ ] T127 [P] [US5] Create useAudioPlayer hook in frontend/src/hooks/useAudioPlayer.ts
- [ ] T128 [US5] Add Listen button to PostDetailPage in frontend/src/pages/posts/PostDetailPage.tsx

**Checkpoint**: User Story 5 complete - TTS playback works independently

---

## Phase 8: User Story 6 - Daily Notifications (Priority: P6)

**Goal**: Users receive daily push notifications at 8:00 AM local time

**Independent Test**: Enable notifications, verify subscription created, verify notification received at scheduled time

### Tests for User Story 6 (TDD - Write First, Must Fail)

- [ ] T129 [P] [US6] Contract test for GET /notifications/vapid-public-key in backend/tests/contract/test_notifications.py
- [ ] T130 [P] [US6] Contract test for POST /notifications/subscribe in backend/tests/contract/test_notifications.py
- [ ] T131 [P] [US6] Contract test for POST /notifications/unsubscribe in backend/tests/contract/test_notifications.py
- [ ] T132 [P] [US6] Contract test for GET/PATCH /user/settings in backend/tests/contract/test_user.py
- [ ] T133 [P] [US6] Unit test for NotificationService in backend/tests/unit/test_notification_service.py
- [ ] T134 [P] [US6] Unit test for notification scheduler in backend/tests/unit/test_notification_scheduler.py
- [ ] T135 [P] [US6] Vitest unit test for NotificationSettings component in frontend/src/components/__tests__/NotificationSettings.test.tsx
- [ ] T136 [P] [US6] Playwright test for notification settings in frontend/playwright/settings.spec.ts

### Implementation for User Story 6

- [ ] T137 [US6] Create PushSubscription domain entity in backend/app/domain/notifications/entities/push_subscription.py
- [ ] T138 [US6] Create PushSubscriptionRepository interface in backend/app/domain/notifications/repositories/subscription_repository.py
- [ ] T139 [US6] Implement SQLAlchemyPushSubscriptionRepository in backend/app/infrastructure/persistence/repositories/subscription_repository.py
- [ ] T140 [US6] Create NotificationService with pywebpush in backend/app/infrastructure/notifications/notification_service.py
- [ ] T141 [US6] Create NotificationScheduler (timezone-aware) in backend/app/infrastructure/notifications/scheduler.py
- [ ] T142 [US6] Create SettingsService in backend/app/application/services/settings_service.py
- [ ] T143 [US6] Implement notification routes in backend/app/api/routes/notifications.py
- [ ] T144 [US6] Implement user settings routes in backend/app/api/routes/user.py
- [ ] T145 [US6] Register Notifications DI module in backend/app/config/modules/notifications_module.py
- [ ] T146 [P] [US6] Create service worker with push handling in frontend/src/sw.ts
- [ ] T147 [P] [US6] Configure vite-plugin-pwa with injectManifest in frontend/vite.config.ts
- [ ] T148 [P] [US6] Create SettingsPage in frontend/src/pages/settings/SettingsPage.tsx
- [ ] T149 [P] [US6] Create NotificationSettings component in frontend/src/components/NotificationSettings.tsx
- [ ] T150 [US6] Create useNotifications hook in frontend/src/hooks/useNotifications.ts

**Checkpoint**: User Story 6 complete - Push notifications work independently

---

## Phase 9: PWA & Polish

**Purpose**: PWA compliance, offline support, and cross-cutting improvements

- [ ] T151 [P] Configure PWA manifest in frontend/public/manifest.json
- [ ] T152 [P] Create PWA icons (192x192, 512x512) in frontend/public/icons/
- [ ] T153 [P] Implement offline caching strategy in frontend/src/sw.ts
- [ ] T154 [P] Create offline indicator component in frontend/src/components/OfflineIndicator.tsx
- [ ] T155 [P] Implement 90-day post retention cleanup job in backend/app/infrastructure/jobs/cleanup.py
- [ ] T156 [P] Add audio cache LRU eviction job in backend/app/infrastructure/jobs/audio_cleanup.py
- [ ] T157 Run Lighthouse PWA audit and fix issues
- [ ] T158 Security review: CSRF, XSS, CORS configuration
- [ ] T159 [P] Create README.md with project overview
- [ ] T160 Run quickstart.md validation (verify all setup steps work)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories
- **User Stories (Phases 3-8)**: All depend on Foundational completion
  - US1 (Auth) → US2 (Feeds) → US3 (Posts) → US4 (Reading) → US5 (TTS) → US6 (Notifications)
  - Each story CAN be developed in parallel if auth mocking is in place
- **PWA & Polish (Phase 9)**: After all user stories or as final increment

### Within Each User Story (TDD Workflow)

1. Write ALL tests first → Verify they FAIL
2. Implement domain entities
3. Implement repositories
4. Implement services
5. Implement API routes
6. Implement frontend components
7. Verify all tests PASS
8. Refactor while green

### Parallel Opportunities

**Setup Phase**: T002-T010 all parallel (different files)

**Foundational Phase**: T015-T021 (models), T023-T031 (infrastructure) all parallel

**Each User Story**: 
- All tests marked [P] can run in parallel
- Frontend components marked [P] can run in parallel
- Backend entities/repos marked [P] can run in parallel

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| Phase 1: Setup | T001-T010 (10) | Project structure |
| Phase 2: Foundational | T011-T031 (21) | Core infrastructure |
| Phase 3: US1 Auth | T032-T051 (20) | OAuth sign-in 🎯 MVP |
| Phase 4: US2 Feeds | T052-T079 (28) | Category/feed management |
| Phase 5: US3 Posts | T080-T095 (16) | Post browsing |
| Phase 6: US4 Reading | T096-T110 (15) | Post detail + read state |
| Phase 7: US5 TTS | T111-T128 (18) | Text-to-speech |
| Phase 8: US6 Notifications | T129-T150 (22) | Push notifications |
| Phase 9: PWA/Polish | T151-T160 (10) | PWA compliance |
| **Total** | **160 tasks** | |

**MVP Scope**: Phases 1-3 (T001-T051) = 51 tasks → Working authentication

**Suggested Commit Points**:
- After Phase 1: "chore: initialize project structure"
- After Phase 2: "feat: add foundational infrastructure"
- After each User Story: "feat(US#): implement [story title]"
- After Phase 9: "feat: add PWA support and polish"
