# Tasks: RSS Feed Reader Core

**Input**: Design documents from `/specs/001-rss-feed-reader/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**TDD Approach**: Per Constitution v1.2.0, all implementation follows Red-Green-Refactor. Tests are written FIRST for each task.

**DI Approach**: Per Constitution v1.2.0, dependency injection uses ABC + Inheritance (no external library). Services depend on abstract base classes.

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
- [x] T012 Setup ABC-based DI composition root in backend/app/config/container.py
- [x] T013 Configure SQLAlchemy async engine with asyncpg in backend/app/infrastructure/persistence/database.py
- [x] T014 Setup Alembic migrations framework in backend/migrations/
- [x] T015 [P] Create User SQLAlchemy model in backend/app/infrastructure/persistence/models/user.py
- [x] T016 [P] Create Category SQLAlchemy model in backend/app/infrastructure/persistence/models/category.py
- [x] T017 [P] Create Feed SQLAlchemy model in backend/app/infrastructure/persistence/models/feed.py
- [x] T018 [P] Create Post SQLAlchemy model in backend/app/infrastructure/persistence/models/post.py
- [x] T019 [P] Create UserPost (read state) SQLAlchemy model in backend/app/infrastructure/persistence/models/user_post.py
- [x] T020 [P] Create Audio SQLAlchemy model in backend/app/infrastructure/persistence/models/audio.py
- [x] T021 Generate initial Alembic migration with all models
- [x] T022 [P] Create base repository ABC in backend/app/domain/shared/repository.py
- [x] T023 [P] Configure error handling middleware in backend/app/api/middleware/error_handler.py
- [x] T024 [P] Configure logging infrastructure in backend/app/config/logging.py
- [x] T025 [P] Create environment configuration management in backend/app/config/settings.py
- [x] T026 [P] Setup API Blueprint structure in backend/app/api/__init__.py
- [x] T027 [P] Create TypeScript API client base in frontend/src/services/api.ts
- [x] T028 [P] Create React Router configuration in frontend/src/App.tsx
- [x] T029 [P] Configure Material UI theme in frontend/src/theme.ts
- [x] T030 [P] Setup auth context for session state in frontend/src/contexts/AuthContext.tsx

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
- [x] T040 [US1] Create UserRepository ABC in backend/app/domain/feed_management/repositories/user_repository.py
- [x] T041 [US1] Implement SQLAlchemyUserRepository in backend/app/infrastructure/persistence/repositories/user_repository.py
- [x] T042 [US1] Create OAuth service with Authlib integration in backend/app/infrastructure/oauth/oauth_service.py
- [x] T043 [US1] Configure OAuth providers (GitHub, Google, Microsoft) in backend/app/infrastructure/oauth/providers.py
- [x] T044 [US1] Create session management with HttpOnly cookies in backend/app/infrastructure/oauth/session.py
- [x] T045 [US1] Implement auth routes (login, callback, me, logout) in backend/app/api/routes/auth.py
- [x] T046 [US1] Wire OAuth dependencies in DI composition root backend/app/config/container.py
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

- [X] T052 [P] [US2] Contract test for GET/POST /categories in backend/tests/contract/test_categories.py
- [X] T053 [P] [US2] Contract test for GET/PATCH/DELETE /categories/{id} in backend/tests/contract/test_categories.py
- [X] T054 [P] [US2] Contract test for GET/POST /categories/{id}/feeds in backend/tests/contract/test_feeds.py
- [X] T055 [P] [US2] Contract test for GET/PATCH/DELETE /feeds/{id} in backend/tests/contract/test_feeds.py
- [X] T056 [P] [US2] Unit test for CategoryService in backend/tests/unit/test_category_service.py
- [X] T057 [P] [US2] Unit test for FeedService in backend/tests/unit/test_feed_service.py
- [X] T058 [P] [US2] Unit test for feed URL validation in backend/tests/unit/test_feed_validator.py
- [X] T059 [P] [US2] Vitest unit test for CategoryList component in frontend/src/components/__tests__/CategoryList.test.tsx
- [X] T060 [P] [US2] Playwright test for category/feed management in frontend/playwright/feeds.spec.ts

### Implementation for User Story 2

- [X] T061 [US2] Create Category domain entity in backend/app/domain/feed_management/entities/category.py
- [X] T062 [US2] Create Feed domain entity in backend/app/domain/feed_management/entities/feed.py
- [X] T063 [US2] Create CategoryRepository ABC in backend/app/domain/feed_management/repositories/category_repository.py
- [X] T064 [US2] Create FeedRepository ABC in backend/app/domain/feed_management/repositories/feed_repository.py
- [X] T065 [US2] Implement SQLAlchemyCategoryRepository in backend/app/infrastructure/persistence/repositories/category_repository.py
- [X] T066 [US2] Implement SQLAlchemyFeedRepository in backend/app/infrastructure/persistence/repositories/feed_repository.py
- [X] T067 [US2] Create FeedFetcher service using feedparser in backend/app/infrastructure/feed_fetcher/feed_fetcher.py
- [X] T068 [US2] Create FeedValidator for URL validation in backend/app/domain/feed_management/services/feed_validator.py
- [X] T069 [US2] Create CategoryService application service (enforce 25 category limit per FR-039) in backend/app/application/services/category_service.py
- [X] T070 [US2] Create FeedService application service (enforce 100 feed limit per FR-038) in backend/app/application/services/feed_service.py
- [X] T071 [US2] Implement category routes in backend/app/api/routes/categories.py
- [X] T072 [US2] Implement feed routes in backend/app/api/routes/feeds.py
- [X] T073 [US2] Wire FeedManagement dependencies in DI composition root backend/app/config/container.py
- [X] T074 [P] [US2] Create FeedsPage layout in frontend/src/pages/feeds/FeedsPage.tsx
- [X] T075 [P] [US2] Create CategoryList component in frontend/src/components/CategoryList.tsx
- [X] T076 [P] [US2] Create CategoryForm dialog in frontend/src/components/CategoryForm.tsx
- [X] T077 [P] [US2] Create FeedList component in frontend/src/components/FeedList.tsx
- [X] T078 [P] [US2] Create AddFeedDialog component in frontend/src/components/AddFeedDialog.tsx
- [X] T079 [US2] Create useFeedsData hook in frontend/src/hooks/useFeedsData.ts

**Checkpoint**: User Story 2 complete - Categories and feeds work independently

---

## Phase 5: User Story 3 - Browse Latest Posts (Priority: P3)

**Goal**: Users see unified chronological view of posts from all subscribed feeds

**Independent Test**: Subscribe to feeds, view Latest Posts, verify posts appear sorted by date

### Tests for User Story 3 (TDD - Write First, Must Fail)

- [X] T080 [P] [US3] Contract test for GET /posts in backend/tests/contract/test_posts.py
- [X] T081 [P] [US3] Unit test for PostService in backend/tests/unit/test_post_service.py
- [X] T082 [P] [US3] Vitest unit test for PostList component in frontend/src/components/__tests__/PostList.test.tsx
- [X] T083 [P] [US3] Playwright test for posts browsing in frontend/playwright/posts.spec.ts

### Implementation for User Story 3

- [X] T084 [US3] Create Post domain entity in backend/app/domain/feed_management/entities/post.py
- [X] T085 [US3] Create PostRepository ABC in backend/app/domain/feed_management/repositories/post_repository.py
- [X] T086 [US3] Implement SQLAlchemyPostRepository in backend/app/infrastructure/persistence/repositories/post_repository.py
- [X] T087 [US3] Create PostService application service in backend/app/application/services/post_service.py
- [X] T088 [US3] Implement posts routes (list with filters) in backend/app/api/routes/posts.py
- [X] T089 [P] [US3] Create PostsPage layout in frontend/src/pages/posts/PostsPage.tsx
- [X] T090 [P] [US3] Create PostList component in frontend/src/components/PostList.tsx
- [X] T091 [P] [US3] Create PostCard component in frontend/src/components/PostCard.tsx
- [X] T092 [P] [US3] Create CategoryFilter component in frontend/src/components/CategoryFilter.tsx
- [X] T093 [US3] Create usePostsData hook with pagination in frontend/src/hooks/usePostsData.ts

**Checkpoint**: User Story 3 complete - Post browsing works independently

---

## Phase 6: User Story 4 - Read Post Content (Priority: P4)

**Goal**: Users can read full post content with auto-mark-read and manual toggle

**Independent Test**: Click post, verify content displays, verify read state updates

### Tests for User Story 4 (TDD - Write First, Must Fail)

- [X] T094 [P] [US4] Contract test for GET /posts/{id} in backend/tests/contract/test_posts.py
- [X] T095 [P] [US4] Contract test for PUT /posts/{id}/read-state in backend/tests/contract/test_posts.py
- [X] T096 [P] [US4] Unit test for read state service in backend/tests/unit/test_post_service.py (integrated into PostService)
- [X] T097 [P] [US4] Vitest unit test for PostDetail component in frontend/src/components/__tests__/PostDetail.test.tsx
- [X] T098 [P] [US4] Playwright test for post reading in frontend/playwright/post-detail.spec.ts

### Implementation for User Story 4

- [X] T099 [US4] Create UserPost domain entity (read state) in backend/app/domain/feed_management/entities/user_post.py (pre-existing UserPostModel)
- [X] T100 [US4] Create ReadStateRepository ABC in backend/app/domain/feed_management/repositories/read_state_repository.py (integrated in PostRepository)
- [X] T101 [US4] Implement SQLAlchemyReadStateRepository in backend/app/infrastructure/persistence/repositories/post_repository.py (integrated)
- [X] T102 [US4] Create ReadStateService in backend/app/application/services/post_service.py (integrated into PostService)
- [X] T103 [US4] Implement post detail route (auto-marks read) in backend/app/api/routes/posts.py
- [X] T104 [US4] Implement read state toggle route in backend/app/api/routes/posts.py
- [X] T105 [P] [US4] Create PostDetailPage in frontend/src/pages/posts/PostDetailPage.tsx
- [X] T106 [P] [US4] Create PostContent renderer in frontend/src/components/PostContent.tsx
- [X] T107 [P] [US4] Create ReadStateToggle component in frontend/src/components/ReadStateToggle.tsx
- [X] T108 [US4] Add read state filter to PostsPage in frontend/src/pages/posts/PostsPage.tsx (pre-existing)

**Checkpoint**: User Story 4 complete - Post reading with read state works independently

---

## Phase 7: User Story 5 - Listen to Posts via TTS (Priority: P5)

**Goal**: Users can listen to posts via text-to-speech with lazy generation and caching

**Independent Test**: Click Listen on post, verify audio plays, verify cached playback is faster

### Tests for User Story 5 (TDD - Write First, Must Fail)

- [X] T109 [P] [US5] Contract test for GET /posts/{id}/audio in backend/tests/contract/test_audio.py
- [X] T110 [P] [US5] Contract test for GET /audio/{cacheKey} streaming in backend/tests/contract/test_audio.py
- [X] T111 [P] [US5] Unit test for TTSService in backend/tests/unit/test_tts_service.py
- [X] T112 [P] [US5] Unit test for AudioCacheService in backend/tests/unit/test_audio_cache.py
- [X] T113 [P] [US5] Vitest unit test for AudioPlayer component in frontend/src/components/__tests__/AudioPlayer.test.tsx
- [X] T114 [P] [US5] Playwright test for TTS playback in frontend/playwright/audio.spec.ts

### Implementation for User Story 5

- [X] T115 [US5] Create Audio domain entity in backend/app/domain/audio/entities/audio.py
- [X] T116 [US5] Create AudioRepository ABC in backend/app/domain/audio/repositories/audio_repository.py
- [X] T117 [US5] Implement SQLAlchemyAudioRepository in backend/app/infrastructure/persistence/repositories/audio_repository.py
- [X] T118 [US5] Create TTSService ABC in backend/app/domain/audio/services/tts_service.py
- [X] T119 [US5] Implement AzureTTSService in backend/app/infrastructure/tts/azure_tts.py
- [X] T120 [US5] Create AudioCacheManager in backend/app/infrastructure/tts/cache_manager.py
- [X] T121 [US5] Create AudioService application service in backend/app/application/services/audio_service.py
- [X] T122 [US5] Implement audio routes (get/generate, stream) in backend/app/api/routes/audio.py
- [X] T123 [US5] Wire Audio dependencies in DI composition root backend/app/config/container.py
- [X] T124 [P] [US5] Create AudioPlayer component in frontend/src/components/AudioPlayer.tsx
- [X] T125 [P] [US5] Create useAudioPlayer hook in frontend/src/hooks/useAudioPlayer.ts
- [X] T126 [US5] Add Listen button to PostDetailPage in frontend/src/pages/posts/PostDetailPage.tsx

**Checkpoint**: User Story 5 complete - TTS playback works independently

---

## ~~Phase 8: User Story 6 - Daily Notifications~~ (OUT OF SCOPE)

**Status**: REMOVED per spec clarification session 2026-02-13

Daily notification feature was removed from scope. No tasks for this user story.

---

## Phase 8: PWA & Polish

**Purpose**: PWA compliance, offline support, and cross-cutting improvements

- [ ] T127 [P] Configure PWA manifest in frontend/public/manifest.json
- [ ] T128 [P] Create PWA icons (192x192, 512x512) in frontend/public/icons/
- [ ] T129 [P] Implement offline caching strategy in frontend/src/sw.ts
- [ ] T130 [P] Create offline indicator component in frontend/src/components/OfflineIndicator.tsx
- [ ] T131 [P] Implement 90-day post retention cleanup job in backend/app/infrastructure/jobs/cleanup.py
- [ ] T132 [P] Add 90-day audio cache cleanup job in backend/app/infrastructure/jobs/audio_cleanup.py
- [ ] T133 Run Lighthouse PWA audit and fix issues
- [ ] T134 Security review: CSRF, XSS, CORS configuration
- [ ] T135 [P] Create README.md with project overview
- [ ] T136 Run quickstart.md validation (verify all setup steps work)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories
- **User Stories (Phases 3-7)**: All depend on Foundational completion
  - US1 (Auth) → US2 (Feeds) → US3 (Posts) → US4 (Reading) → US5 (TTS)
  - Each story CAN be developed in parallel if auth mocking is in place
  - ~~US6 (Notifications)~~ - OUT OF SCOPE
- **PWA & Polish (Phase 8)**: After all user stories or as final increment

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

**Foundational Phase**: T015-T020 (models), T022-T030 (infrastructure) all parallel

**Each User Story**: 
- All tests marked [P] can run in parallel
- Frontend components marked [P] can run in parallel
- Backend entities/repos marked [P] can run in parallel

---

## Summary

| Phase                          | Tasks          | Focus                    |
| ------------------------------ | -------------- | ------------------------ |
| Phase 1: Setup                 | T001-T010 (10) | Project structure        |
| Phase 2: Foundational          | T011-T030 (20) | Core infrastructure      |
| Phase 3: US1 Auth              | T032-T051 (20) | OAuth sign-in 🎯 MVP      |
| Phase 4: US2 Feeds             | T052-T079 (28) | Category/feed management |
| Phase 5: US3 Posts             | T080-T093 (14) | Post browsing            |
| Phase 6: US4 Reading           | T094-T108 (15) | Post detail + read state |
| Phase 7: US5 TTS               | T109-T126 (18) | Text-to-speech           |
| ~~Phase 8: US6 Notifications~~ | ~~(removed)~~  | ~~OUT OF SCOPE~~         |
| Phase 8: PWA/Polish            | T127-T136 (10) | PWA compliance           |
| **Total**                      | **135 tasks**  |                          |

**MVP Scope**: Phases 1-3 (T001-T051) = 50 tasks → Working authentication

**Suggested Commit Points**:
- After Phase 1: "chore: initialize project structure"
- After Phase 2: "feat: add foundational infrastructure"
- After each User Story: "feat(US#): implement [story title]"
- After Phase 8: "feat: add PWA support and polish"
