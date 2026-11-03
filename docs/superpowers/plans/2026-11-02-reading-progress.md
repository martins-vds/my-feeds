# Reading Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate *opening* an article from *reading* it. Opening only records "Opened"; reading progress is credited from the read-along clock (the real audio clock, or a silent timer pacer), which yields per-user Unread / In progress / Read states, an "In progress" sidebar filter and a progress bar on in-progress cards.

**Architecture:** `user_posts` gains `opened_at` and `read_progress` plus a unique `(user_id, post_id)` constraint. The server owns the state machine (`record_opened`, `record_progress`, a 95% completion threshold) behind a new `PUT /posts/{id}/progress`; `GET /posts/{id}` no longer marks the post read. On the client the highlight engine is generalised over a `MediaClock` interface (implemented by `HTMLAudioElement` and a new `PacerClock`), a `useReadingProgress` hook credits position-based high-water progress from either clock and flushes it throttled, and the idle "Listen to article" button becomes one "Start reading" split button (sound / silent).

**Tech Stack:** Python 3.12, Quart, SQLAlchemy 2 (async) + asyncpg, Alembic, PostgreSQL 16, pytest + pytest-crap + mutmut; React 19 + TypeScript, MUI, Vite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-reading-progress-design.md` (approved; it wins over this plan if they ever disagree, except for the items listed under "Deviations from the spec" below, which were decided after reading the code).

## Global Constraints

- **Strict TDD in every task.** Write the failing test first, run it and confirm the *expected* failure, implement the minimum, run it green, then refactor. Tests are part of each task, never a trailing phase. Only the docs task (Task 19) has no test-first step.
- **Dev stack.** Backend tests need Postgres, so everything runs in the compose dev stack. Bring it up once: `docker compose up -d --build backend frontend`. After adding a migration, apply it with `docker compose run --rm migrate`.
- **Backend commands.** `docker compose exec -T backend pytest <args>` (markers `unit` / `integration` / `contract`; `asyncio_mode = "auto"`; `--strict-markers`). Whole suite: `docker compose exec -T backend pytest -q`.
- **Frontend commands (run in the `frontend` container).** One test file: `docker compose exec -T frontend pnpm exec vitest run <path>`. All unit tests: `docker compose exec -T frontend pnpm test`. Types: `docker compose exec -T frontend pnpm exec tsc -b`. Lint: `docker compose exec -T frontend pnpm lint`. Format a *new* file: `docker compose exec -T frontend pnpm exec prettier --write <path>`. Playwright: `docker compose exec -T frontend sh -lc 'npx playwright test <spec> --reporter=line'`.
- **Translating the commands.** Every command is written for the compose dev stack. If an environment has to run one differently (no Docker on the host, another shell, another path style), change the command, never the expectation: each "Expected" line is part of the contract.
- **Pinned values (tests assert them; do not change them):**

  | Value | Setting |
  |---|---|
  | Completion threshold | `READ_COMPLETION_THRESHOLD = 0.95` (applied by the service) |
  | Progress flush cadence | at most 1 `PUT` per 10 s while playing, and only when `floor(progress × 100)` rose since the last send (≤ 6 req/min against the 60/min mutation rate limit) |
  | Credit-jump cap | a `timeupdate` that moves the position by more than 5 s credits nothing (seek / scrub) |
  | Pacer | `BASE_WPM = 250`; `msPerWord = 60000 / baseWpm`; WPM menu 150 / 200 / 250 / 300 / 400 |
  | Preferences | `readAlong.readingMode` (`"sound"` \| `"silent"`, default `"silent"`), `readAlong.wpm` (default `250`) |
  | List filter | `ReadState` gains `"in_progress"`; URL `?read=in_progress`; API `readState=in_progress` |
  | Displayed percent | `max(1, floor(progress × 100))` — `displayPercent()` in `utils/readingProgress.ts` (its `wholePercent()` guards against `0.29 * 100 = 28.999999999999996`) |
  | Migration | `revision = "b8e4a1c7d903"`, `down_revision = "f7a1b2c3d4e5"`; constraints `uq_user_posts_user_id_post_id` and `ck_user_posts_read_progress_range` |

- **Python style.** ruff: line length 100, py312, rules E/W/F/I/B/C4/UP/ARG/SIM. New backend modules use `X | None`; files that already use `Optional[...]` keep it. `Base` has no naming convention, so constraint names are explicit and identical in model and migration.
- **Layering.** Domain → application → infrastructure/api. The service imports repository ABCs only; routes call the service only; the domain imports nothing from outer layers.
- **Frontend style.** React 19 (`useRef` needs an initial argument); TypeScript strict with `noUnusedLocals` / `noUnusedParameters`. New files follow `frontend/.prettierrc` (2 spaces, 100 columns, double quotes, trailing commas `es5`, semicolons). Existing files keep the indentation they already have, so look before you edit: `types/index.ts`, `constants/audio.ts`, `hooks/usePostsData.ts`, `hooks/useReadAlongPreferences.ts`, `utils/wrapWords.ts`, `utils/alignTimings.ts` and their tests (`usePostsData.test.tsx`, `useReadAlongPreferences.test.ts`, `audio.test.ts`, `wrapWords.test.ts`, `alignTimings.test.ts`) are 4-space; the components, the pages, `useReadAlong.ts`, `useAudioPlayer.ts` and `services/api.ts` are 2-space. Never run prettier over an existing file. `.prettierrc` says `endOfLine: lf`, so on a checkout with CRLF line endings `prettier --check` fails on line endings alone: add `--end-of-line auto` to the check there.
- **Quality gates.** After production Python changes run pytest-crap (Task 7). After Python test changes run mutmut (Task 7) inside the Linux container — it needs `fork`; never use `mutmut browse` or `mutmut apply`.
- **No network.** Tests never call external services; Playwright mocks every `/api/**` request.
- **Commits.** Commit steps run *only if the user asked for commits*. When you do commit, end the message with `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`. Never push.

---

## File Structure

**Backend — create**

- `backend/migrations/versions/20261102_1200_b8e4a1c7d903_reading_progress.py` — adds `opened_at`, `read_progress`, the range check, de-duplicates and backfills, then adds the unique `(user_id, post_id)` constraint.
- `backend/app/domain/feed_management/entities/user_post_state.py` — frozen `UserPostState` value object and `READ_COMPLETION_THRESHOLD`.
- `backend/tests/unit/test_user_post_state.py` — value-object and threshold tests.
- `backend/tests/integration/test_reading_progress_migration.py` — env-gated migration test on a scratch database.
- `backend/tests/integration/test_post_reading_progress.py` — repository upserts, filters and bulk operations on real Postgres.

**Backend — modify**

- `backend/app/infrastructure/persistence/models/user_post.py` — new columns, default `is_read=False`, unique and check constraints.
- `backend/app/domain/feed_management/entities/post.py` — `read_progress`, `is_seen` and their JSON keys.
- `backend/app/domain/feed_management/repositories/post_repository.py` — `ReadState` gains `in_progress`; abstract `record_opened`, `record_progress`, `get_user_post_state`.
- `backend/app/infrastructure/persistence/repositories/post_repository.py` — atomic upserts, single-query list with SQL read-state predicates, set-based bulk marking.
- `backend/app/application/services/post_service.py` — `open_post`, `record_progress`, `get_post` populates the new fields; `ReadState` comes from the ABC.
- `backend/app/api/routes/posts.py` — `GET /posts/{id}` opens instead of marking read; new `PUT /posts/{id}/progress`; `readState=in_progress`.
- `backend/tests/unit/test_post.py`, `backend/tests/unit/test_post_service.py` — new and rewritten unit tests.
- `backend/tests/contract/conftest.py`, `backend/tests/contract/test_posts.py` — idempotent seed, state-reset fixtures, contract tests.

**Frontend — create** (under `frontend/src/`)

- `utils/readingProgress.ts` — `wholePercent` / `displayPercent`, the one definition of the percentage the UI shows and the tracker throttles on.
- `utils/mediaClock.ts` — `MediaClock` interface and `MediaClockEvent` type.
- `utils/pacedTimings.ts` — `BASE_WPM` and `buildPacedTimings` (synthetic word timings).
- `utils/pacerClock.ts` — `PacerClock`, a timer-driven `MediaClock`.
- `utils/readingProgressTracker.ts` — `ReadingProgressTracker`, the React-free rules for crediting reading and for when a report may be sent.
- `hooks/usePacer.ts` — React wrapper around `PacerClock`.
- `hooks/useReadingProgress.ts` — feeds any `MediaClock` into the tracker and sends its reports to the server.
- `components/StartReadingButton.tsx` — the "Start reading" split button.
- `components/PacerControls.tsx` — play/pause, seek, WPM and stop controls for silent reading.
- Tests beside each: `utils/__tests__/{readingProgress,pacedTimings,pacerClock,readingProgressTracker}.test.ts`, `hooks/__tests__/{usePacer,useReadingProgress}.test.tsx`, `hooks/__tests__/{useReadAlong.paced,useAudioPlayer.autoplay}.test.tsx`, `services/__tests__/api.keepalive.test.ts`, `components/__tests__/{StartReadingButton,PacerControls,ReadAlongToggles,PostCard,FeedSidebar}.test.tsx`, `pages/posts/__tests__/PostDetailPage.reading.test.tsx`.

**Frontend — modify** (under `frontend/src/` unless noted)

- `types/index.ts`, `services/api.ts`, `constants/audio.ts`.
- `hooks/usePostsData.ts`, `hooks/useReadAlong.ts`, `hooks/useReadAlongPreferences.ts`, `hooks/useAudioPlayer.ts`.
- `components/PostCard.tsx`, `components/PostList.tsx`, `components/FeedSidebar.tsx`, `components/AudioPlayer.tsx`, `components/FloatingAudioControls.tsx`, `components/ReadAlongToggles.tsx`.
- `pages/posts/ReaderPage.tsx`, `pages/posts/PostDetailPage.tsx`.
- Existing tests touched: `components/__tests__/{AudioPlayer,FloatingAudioControls,PostList}.test.tsx`, `hooks/__tests__/{useReadAlongPreferences,usePostsData}.test.ts*`, `constants/__tests__/audio.test.ts`.
- `frontend/playwright/{fixtures,audio.spec,read-along.spec,post-detail.spec}.ts`, plus new `frontend/playwright/reading-progress.spec.ts`.

**Docs — modify**

- `specs/001-rss-feed-reader/{spec.md,data-model.md,tasks.md}`, `specs/001-rss-feed-reader/contracts/openapi.yaml`, `specs/003-read-along-highlight/quickstart.md`, `README.md`, `my-feeds-threat-model.md`.

## Deviations from the spec

The spec is the contract. These are the places where this plan, having read the code, builds something other than what the spec sketched, or does something the spec did not ask for. Each is deliberate and is built by the task named; anything not listed here follows the spec. Task 20, Step 8 puts this list in the final report.

**Where the plan differs from the spec's sketches**

| Spec | This plan | Task |
|---|---|---|
| `usePacer` owns the pace and exposes `wpm` and `setWpm`. | `usePacer(wpm)` takes the pace as an argument. The page passes the stored preference, so the preference stays the one source of truth. | 13 |
| `useReadingProgress` returns `{ progress, reset }`. | It returns `{ reset }`: nothing reads a local high-water mark, because the page shows what the server answers. It also takes a `clockKey` (it subscribes again when the active clock changes) and ignores the answer to a request for a post the page has already left. The crediting and throttling rules live in a React-free `utils/readingProgressTracker.ts`, so they are tested without React. | 14 |
| `useReadAlong` exposes `durationMs` for the pacer. | It exposes `pacedDurationMs`, which is 0 unless `paced` is on. The spec left the name open. | 11 |
| `FloatingAudioControls` gains `speeds`, `formatSpeed` and `hideMute`. | It also gains `speedLabel`, so a screen reader does not call the pace control "Playback speed". | 15 |
| `PacerControls` offers play or pause, a position slider, a pace menu and stop. | The same, plus `onSpeedMenuOpenChange`, so the page can hold auto-scroll while the pace menu is open. Both menus (the pace menu and the start button's arrow) use `role="menuitemradio"`, so the marked item reaches assistive technology as checked. The slider has no value bubble, because the percent beside it says the same. | 16 |
| The local `PostDetailResponse` gains `readProgress` and `isSeen`. | Only `readProgress`. The page never reads `isSeen`; the shared `Post` type has both. | 8, 17 |
| Autoplay blocked: the player "stays in its ready state". | `play()` sets `playing` at once and goes back to `paused` if the browser refuses. Without that, a refusal was an unhandled rejection and the player claimed to play in silence. No progress is credited either way. | 17 |
| The audio surface has a "Read silently" link, and the player's error state also gains a "Read silently" action. | The link is hidden in the error state, so the reader sees one such action, not two. | 17 |
| Audio resume-from-position needs a start-position option on `useAudioPlayer`. | It uses the player's existing `seek` once the clip is loaded, so `useAudioPlayer` gains no option. When the reader switches between sound and silent, the new clock starts at the place the active one reached. | 17 |
| A post that already has audio lands on the audio surface. | The same, and stopping silent reading on such a post returns to that player, not to the start button. | 17 |
| The Playwright specs call a shared `startListening` helper wherever they clicked "Listen to article". | `audio.spec.ts` does. `read-along.spec.ts` flags its seed posts `hasAudio: true` and waits for the preloaded player instead, because "Read with sound" now also starts playback, which would play the clip and then pause it. | 18 |

**Additions beyond the spec.** The user can drop or split any of these.

- **`usePostsData` takes a third parameter, `initialReadState`, and `ReaderPage` passes it the URL's `?read=`.** The list used to load unfiltered and apply the filter afterwards, so a `?read=` deep link, a reload and Back from an article showed the whole list under a filter button that said otherwise. The In progress list is unusable without this. Playwright scenarios in Task 18 pin it. (Task 8)
- **Documentation corrections the spec did not list.** `specs/003-read-along-highlight/quickstart.md`, whose first manual scenario waits for the removed "Listen to article" button. The OpenAPI tag description, and a new `ErrorEnvelope` schema for the nested 400 and 429 bodies of the new endpoint, which the existing flat `Error` schema does not describe. The data model's description of `user_posts`, which called `user_id` and `post_id` a composite primary key when the table has its own `id` key. (Task 19)

**Left as it is.** `useAudioPlayer` keeps its status across a route change. That is existing behaviour, so the page's cleanup deals with its own state only. (Task 17)

---

# Part A — Backend

## Task 1: Migration, `UserPostModel` and the migration test

**Files:**
- Create: `backend/migrations/versions/20261102_1200_b8e4a1c7d903_reading_progress.py`
- Create: `backend/tests/integration/test_reading_progress_migration.py`
- Modify: `backend/app/infrastructure/persistence/models/user_post.py`

**Interfaces:**
- Consumes: Alembic head `f7a1b2c3d4e5`.
- Produces: `user_posts.opened_at timestamptz NULL`; `user_posts.read_progress double precision NOT NULL DEFAULT 0` with check `ck_user_posts_read_progress_range`; unique constraint `uq_user_posts_user_id_post_id (user_id, post_id)`. `UserPostModel.opened_at: Mapped[datetime | None]`, `UserPostModel.read_progress: Mapped[float]`, `UserPostModel.is_read` default `False`.

- [ ] **Step 1: Write the failing migration test**

Create `backend/tests/integration/test_reading_progress_migration.py`. It runs the real Alembic chain in a throw-away database (so it needs the admin URL `MIGRATION_DATABASE_URL` and is skipped in ordinary runs):

```python
"""Migration test for reading progress on ``user_posts``.

Runs the real Alembic chain against a throw-away database, so it needs the admin
connection (``MIGRATION_DATABASE_URL``) and is skipped in ordinary runs.
"""

import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

MIGRATION_URL = os.environ.get("MIGRATION_DATABASE_URL")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not MIGRATION_URL, reason="MIGRATION_DATABASE_URL is not set"),
]

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PREVIOUS_REVISION = "f7a1b2c3d4e5"
READ_AT = datetime(2026, 1, 5, 12, 0, tzinfo=timezone.utc)


def _id(kind: int, n: int) -> uuid.UUID:
    return uuid.UUID(f"00000000-0000-4000-a{kind:03x}-{n:012x}")


USER = _id(0, 1)
FEED = _id(1, 1)
POST_DUP_MIXED = _id(2, 1)
POST_DUP_UNREAD = _id(2, 2)
POST_SINGLE_READ = _id(2, 3)
POST_SINGLE_UNREAD = _id(2, 4)
POST_FRESH = _id(2, 5)  # no user_posts row; used for the CHECK-constraint inserts
POSTS = [POST_DUP_MIXED, POST_DUP_UNREAD, POST_SINGLE_READ, POST_SINGLE_UNREAD, POST_FRESH]

UP_MIXED_UNREAD = _id(3, 1)  # lower id, but the read row below must win
UP_MIXED_READ = _id(3, 2)
UP_UNREAD_LOW = _id(3, 3)  # both unread: the lowest id survives
UP_UNREAD_HIGH = _id(3, 4)
UP_SINGLE_READ = _id(3, 5)
UP_SINGLE_UNREAD = _id(3, 6)
# (row id, post id, is_read)
USER_POSTS = [
    (UP_MIXED_UNREAD, POST_DUP_MIXED, False),
    (UP_MIXED_READ, POST_DUP_MIXED, True),
    (UP_UNREAD_LOW, POST_DUP_UNREAD, False),
    (UP_UNREAD_HIGH, POST_DUP_UNREAD, False),
    (UP_SINGLE_READ, POST_SINGLE_READ, True),
    (UP_SINGLE_UNREAD, POST_SINGLE_UNREAD, False),
]
SURVIVORS = {UP_MIXED_READ, UP_UNREAD_LOW, UP_SINGLE_READ, UP_SINGLE_UNREAD}


def _alembic(database_url: str, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": database_url, "ENVIRONMENT": "testing", "DEBUG": "false"}
    env.pop("MIGRATION_DATABASE_URL", None)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}")


@pytest.fixture
async def database_url():
    base = make_url(MIGRATION_URL)
    name = f"reading_progress_migration_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(
        base.set(database="postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool
    )
    async with admin.connect() as conn:
        await conn.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield base.set(database=name).render_as_string(hide_password=False)
    finally:
        async with admin.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        await admin.dispose()


async def _seed_parents(engine) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO users (id, provider, provider_id, email, name, timezone, "
                "notifications_enabled) VALUES (:id, 'github', 'migration-user', "
                "'migration@example.com', 'Migration User', 'UTC', false)"
            ),
            {"id": USER},
        )
        await conn.execute(
            text(
                "INSERT INTO feeds (id, user_id, url, title, fetch_error_count) "
                "VALUES (:id, :user, 'https://example.com/feed', 'Feed', 0)"
            ),
            {"id": FEED, "user": USER},
        )
        for post_id in POSTS:
            await conn.execute(
                text(
                    "INSERT INTO posts (id, feed_id, guid, title, content, summary, link, "
                    "published_at) VALUES (:id, :feed, :guid, 'Post', 'Body', 'Summary', "
                    "'https://example.com/post', now())"
                ),
                {"id": post_id, "feed": FEED, "guid": f"guid-{post_id}"},
            )


async def _seed_user_posts(engine) -> None:
    async with engine.begin() as conn:
        for row_id, post_id, is_read in USER_POSTS:
            await conn.execute(
                text(
                    "INSERT INTO user_posts (id, user_id, post_id, is_read, read_at) "
                    "VALUES (:id, :user, :post, :is_read, :read_at)"
                ),
                {
                    "id": row_id,
                    "user": USER,
                    "post": post_id,
                    "is_read": is_read,
                    "read_at": READ_AT if is_read else None,
                },
            )


async def _columns(engine) -> set[str]:
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'user_posts'"
            )
        )
        return {row[0] for row in result}


class TestReadingProgressMigration:
    @pytest.mark.asyncio
    async def test_upgrade_dedupes_backfills_and_adds_constraints(self, database_url):
        _alembic(database_url, "upgrade", PREVIOUS_REVISION)
        engine = create_async_engine(database_url, poolclass=NullPool)
        try:
            await _seed_parents(engine)
            await _seed_user_posts(engine)

            _alembic(database_url, "upgrade", "head")

            async with engine.connect() as conn:
                result = await conn.execute(
                    text("SELECT id, read_progress, opened_at FROM user_posts")
                )
                rows = {str(row.id): row for row in result}

            assert set(rows) == {str(row_id) for row_id in SURVIVORS}
            for read_id in (UP_MIXED_READ, UP_SINGLE_READ):
                assert rows[str(read_id)].read_progress == 1
                assert rows[str(read_id)].opened_at == READ_AT
            for unread_id in (UP_UNREAD_LOW, UP_SINGLE_UNREAD):
                assert rows[str(unread_id)].read_progress == 0
                assert rows[str(unread_id)].opened_at is None

            with pytest.raises(IntegrityError, match="uq_user_posts_user_id_post_id"):
                async with engine.begin() as conn:
                    await conn.execute(
                        text(
                            "INSERT INTO user_posts (id, user_id, post_id, is_read) "
                            "VALUES (:id, :user, :post, false)"
                        ),
                        {"id": uuid.uuid4(), "user": USER, "post": POST_SINGLE_UNREAD},
                    )

            for bad_progress in (1.5, -0.1):
                with pytest.raises(IntegrityError, match="ck_user_posts_read_progress_range"):
                    async with engine.begin() as conn:
                        await conn.execute(
                            text(
                                "INSERT INTO user_posts (id, user_id, post_id, is_read, "
                                "read_progress) VALUES (:id, :user, :post, false, :progress)"
                            ),
                            {
                                "id": uuid.uuid4(),
                                "user": USER,
                                "post": POST_FRESH,
                                "progress": bad_progress,
                            },
                        )
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_downgrade_then_upgrade_round_trips(self, database_url):
        _alembic(database_url, "upgrade", "head")
        engine = create_async_engine(database_url, poolclass=NullPool)
        try:
            columns = await _columns(engine)
            assert {"opened_at", "read_progress"} <= columns
            await _seed_parents(engine)

            _alembic(database_url, "downgrade", PREVIOUS_REVISION)
            columns = await _columns(engine)
            assert not {"opened_at", "read_progress"} & columns

            # The unique constraint is gone again, so duplicates are accepted.
            await _seed_user_posts(engine)

            _alembic(database_url, "upgrade", "head")
            async with engine.connect() as conn:
                count = (await conn.execute(text("SELECT count(*) FROM user_posts"))).scalar_one()
            assert count == len(SURVIVORS)
        finally:
            await engine.dispose()
```

- [ ] **Step 2: Run the test and watch it fail**

Run (the `migrate` image has the dev dependencies and the admin URL; `db` must be running and provisioned, which the stack start-up above guarantees):

```bash
docker compose up -d --build backend frontend
docker compose run --rm --no-deps --entrypoint "" migrate python -m pytest -p no:cacheprovider tests/integration/test_reading_progress_migration.py -q
```

Expected: 2 failures. `test_upgrade_dedupes_backfills_and_adds_constraints` fails with `sqlalchemy.exc.ProgrammingError … UndefinedColumnError: column "read_progress" does not exist`; `test_downgrade_then_upgrade_round_trips` fails on `assert {"opened_at", "read_progress"} <= columns`.

- [ ] **Step 3: Write the migration**

Create `backend/migrations/versions/20261102_1200_b8e4a1c7d903_reading_progress.py`:

```python
"""Track reading progress on user_posts.

Adds ``opened_at`` and ``read_progress`` so opening a post and reading it are
recorded separately, and a unique ``(user_id, post_id)`` constraint so progress
writes can upsert atomically. Rows that duplicate a (user, post) pair are
collapsed to one survivor (a read row wins, then the latest ``read_at``, then
the lowest ``id``); that clean-up cannot be reversed by ``downgrade``.
"""

import sqlalchemy as sa
from alembic import op

revision = "b8e4a1c7d903"
down_revision = "f7a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_posts",
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When the user first opened this post",
        ),
    )
    op.add_column(
        "user_posts",
        sa.Column(
            "read_progress",
            sa.Float(),
            nullable=False,
            server_default="0",
            comment="Furthest reading position reached, from 0.0 to 1.0",
        ),
    )
    op.create_check_constraint(
        "ck_user_posts_read_progress_range",
        "user_posts",
        "read_progress >= 0 AND read_progress <= 1",
    )
    op.execute(
        """
        DELETE FROM user_posts
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY user_id, post_id
                           ORDER BY is_read DESC, read_at DESC NULLS LAST, id
                       ) AS rn
                FROM user_posts
            ) ranked
            WHERE ranked.rn > 1
        )
        """
    )
    op.execute("UPDATE user_posts SET read_progress = 1, opened_at = read_at WHERE is_read")
    op.create_unique_constraint("uq_user_posts_user_id_post_id", "user_posts", ["user_id", "post_id"])


def downgrade() -> None:
    op.drop_constraint("uq_user_posts_user_id_post_id", "user_posts", type_="unique")
    op.drop_constraint("ck_user_posts_read_progress_range", "user_posts", type_="check")
    op.drop_column("user_posts", "read_progress")
    op.drop_column("user_posts", "opened_at")
```

- [ ] **Step 4: Update `UserPostModel`**

Edit `backend/app/infrastructure/persistence/models/user_post.py` (four edits).

Docstrings and imports — replace

```python
"""UserPost (read state) SQLAlchemy model."""
```

with

```python
"""UserPost (read state and reading progress) SQLAlchemy model."""
```

Replace the one-line `from sqlalchemy import Boolean, DateTime, ForeignKey, func` with

```python
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    UniqueConstraint,
    func,
)
```

Replace the class docstring body `Junction table tracking per-user read state for posts.` with `Junction table tracking per-user read state and reading progress for posts.`

Replace the `is_read` and `read_at` columns:

```python
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Whether the user has read this post",
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the post was first read",
    )
```

with

```python
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether the user has read this post",
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the post was first read",
    )
    opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the user first opened this post",
    )
    read_progress: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
        server_default="0",
        comment="Furthest reading position reached, from 0.0 to 1.0",
    )
```

Replace

```python
    __table_args__ = (
        # User can only have one read state per post
        {"comment": "Per-user read state for posts"},
    )
```

with

```python
    __table_args__ = (
        UniqueConstraint("user_id", "post_id", name="uq_user_posts_user_id_post_id"),
        CheckConstraint(
            "read_progress >= 0 AND read_progress <= 1",
            name="ck_user_posts_read_progress_range",
        ),
        {"comment": "Per-user read state and reading progress for posts"},
    )
```

- [ ] **Step 5: Run the migration test green and check the head**

```bash
docker compose run --rm --no-deps --entrypoint "" migrate python -m pytest -p no:cacheprovider tests/integration/test_reading_progress_migration.py -q
docker compose run --rm --no-deps --entrypoint "" migrate alembic heads
```

Expected: `2 passed`, then `b8e4a1c7d903 (head)` (a single head).

- [ ] **Step 6: Migrate the dev database and check for regressions**

```bash
docker compose run --rm migrate
docker compose exec -T backend pytest tests/unit -q
```

Expected: the migrate log contains `Running upgrade f7a1b2c3d4e5 -> b8e4a1c7d903, Track reading progress on user_posts.`; the unit suite passes (nothing reads the new columns yet).

- [ ] **Step 7: Commit (only if the user asked for commits)**

```bash
git add backend/migrations/versions/20261102_1200_b8e4a1c7d903_reading_progress.py backend/app/infrastructure/persistence/models/user_post.py backend/tests/integration/test_reading_progress_migration.py
git commit -m "feat(backend): add reading progress columns to user_posts" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Domain — `UserPostState` and the new `Post` fields

**Files:**
- Create: `backend/app/domain/feed_management/entities/user_post_state.py`
- Create: `backend/tests/unit/test_user_post_state.py`
- Modify: `backend/app/domain/feed_management/entities/post.py`
- Modify: `backend/tests/unit/test_post.py`

**Interfaces:**
- Produces: `READ_COMPLETION_THRESHOLD: float = 0.95`; `@dataclass(frozen=True) UserPostState(is_read: bool = False, read_at: datetime | None = None, read_progress: float = 0.0, opened_at: datetime | None = None)` with property `is_seen -> bool` (`opened_at is not None`).
- Produces: `Post.read_progress: float = 0.0`, `Post.is_seen: bool = False`; `Post.to_summary_dict()` gains `"readProgress"` and `"isSeen"` after `"isRead"`; `to_detail_dict()` inherits them.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_user_post_state.py`:

```python
"""Unit tests for the UserPostState value object."""

from dataclasses import FrozenInstanceError
from datetime import datetime, timezone

import pytest

from app.domain.feed_management.entities.user_post_state import (
    READ_COMPLETION_THRESHOLD,
    UserPostState,
)


class TestUserPostState:
    def test_defaults_describe_an_untouched_post(self):
        state = UserPostState()

        assert state.is_read is False
        assert state.read_at is None
        assert state.read_progress == 0.0
        assert state.opened_at is None
        assert state.is_seen is False

    def test_is_seen_once_opened_at_is_set(self):
        state = UserPostState(opened_at=datetime(2026, 1, 5, tzinfo=timezone.utc))

        assert state.is_seen is True

    def test_is_immutable(self):
        state = UserPostState()

        with pytest.raises(FrozenInstanceError):
            state.is_read = True  # type: ignore[misc]

    def test_completion_threshold_is_ninety_five_percent(self):
        assert READ_COMPLETION_THRESHOLD == 0.95
```

Append to the end of `backend/tests/unit/test_post.py` (it already defines `_make_post`):

```python


class TestReadingFields:
    def test_reading_fields_default_to_untouched(self):
        post = _make_post()

        assert post.read_progress == 0.0
        assert post.is_seen is False

    def test_summary_dict_exposes_progress_and_seen(self):
        post = _make_post(summary="Short")
        post.read_progress = 0.42
        post.is_seen = True

        data = post.to_summary_dict()

        assert data["isRead"] is False
        assert data["readProgress"] == 0.42
        assert data["isSeen"] is True

    def test_detail_dict_includes_progress_and_seen(self):
        post = _make_post(content="<p>Body</p>")
        post.is_read = True
        post.read_progress = 1.0
        post.is_seen = True

        data = post.to_detail_dict()

        assert data["isRead"] is True
        assert data["readProgress"] == 1.0
        assert data["isSeen"] is True
        assert "content" in data
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
docker compose exec -T backend pytest tests/unit/test_user_post_state.py tests/unit/test_post.py -q
```

Expected: `test_user_post_state.py` errors with `ModuleNotFoundError: No module named 'app.domain.feed_management.entities.user_post_state'`; the three `TestReadingFields` tests fail with `AttributeError: 'Post' object has no attribute 'read_progress'` / `KeyError: 'readProgress'`.

- [ ] **Step 3: Create the value object**

Create `backend/app/domain/feed_management/entities/user_post_state.py`:

```python
"""UserPostState value object: a user's read state and reading progress for one post."""

from dataclasses import dataclass
from datetime import datetime

# A reading position at or beyond this fraction counts as having read the post.
READ_COMPLETION_THRESHOLD = 0.95


@dataclass(frozen=True)
class UserPostState:
    """A user's relationship to a single post.

    Attributes:
        is_read: Whether the post counts as read (finished, or marked read by hand)
        read_at: When the post first became read
        read_progress: Furthest reading position reached, from 0.0 to 1.0
        opened_at: When the user first opened the post, if they ever did
    """

    is_read: bool = False
    read_at: datetime | None = None
    read_progress: float = 0.0
    opened_at: datetime | None = None

    @property
    def is_seen(self) -> bool:
        """Whether the user has opened the post."""
        return self.opened_at is not None
```

- [ ] **Step 4: Add the fields to `Post`**

Edit `backend/app/domain/feed_management/entities/post.py` (three edits).

In the class docstring's `Attributes:` list, replace

```python
        is_read: Read state for current user (populated dynamically)
```

with

```python
        is_read: Read state for current user (populated dynamically)
        read_progress: Furthest reading position for current user, 0.0-1.0 (populated dynamically)
        is_seen: Whether the current user has opened the post (populated dynamically)
```

In the dataclass fields (under `# These are populated dynamically, not stored in Post table`), replace

```python
    is_read: bool = False
    has_audio: bool = False
```

with

```python
    is_read: bool = False
    read_progress: float = 0.0
    is_seen: bool = False
    has_audio: bool = False
```

In `to_summary_dict`, replace

```python
            "isRead": self.is_read,
```

with

```python
            "isRead": self.is_read,
            "readProgress": self.read_progress,
            "isSeen": self.is_seen,
```

- [ ] **Step 5: Run the tests green**

```bash
docker compose exec -T backend pytest tests/unit -q
```

Expected: all unit tests pass (including the 4 + 3 new ones).

- [ ] **Step 6: Commit (only if the user asked for commits)**

```bash
git add backend/app/domain/feed_management/entities backend/tests/unit/test_user_post_state.py backend/tests/unit/test_post.py
git commit -m "feat(backend): add UserPostState and reading fields to Post" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Repository ABC and atomic upserts

**Files:**
- Create: `backend/tests/integration/test_post_reading_progress.py`
- Modify: `backend/app/domain/feed_management/repositories/post_repository.py`
- Modify: `backend/app/infrastructure/persistence/repositories/post_repository.py`

**Interfaces:**
- Consumes: `UserPostState` (Task 2), the unique constraint `uq_user_posts_user_id_post_id` (Task 1).
- Produces (ABC and `SQLAlchemyPostRepository`): `ReadState = Literal["all", "unread", "in_progress", "read"]`;
  - `async record_opened(user_id: UUID, post_id: UUID) -> None`
  - `async record_progress(user_id: UUID, post_id: UUID, progress: float, *, completed: bool) -> UserPostState`
  - `async get_user_post_state(user_id: UUID, post_id: UUID) -> UserPostState`
  - `mark_as_read(...)` and `mark_all_read(...)` keep their signatures but become upserts that also set `read_progress` (1.0 when read, 0.0 when unread) and leave `opened_at` alone; `get_read_state(...)` keeps returning `(is_read, read_at)`.

- [ ] **Step 1: Write the failing integration tests**

Create `backend/tests/integration/test_post_reading_progress.py` (Task 4 appends list tests to it):

```python
"""Integration tests for reading-progress persistence (real Postgres)."""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.domain.feed_management.entities.category import Category
from app.domain.feed_management.entities.feed import Feed
from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.entities.user_post_state import UserPostState
from app.infrastructure.persistence.database import get_session_factory
from app.infrastructure.persistence.repositories.category_repository import (
    SQLAlchemyCategoryRepository,
)
from app.infrastructure.persistence.repositories.feed_repository import (
    SQLAlchemyFeedRepository,
)
from app.infrastructure.persistence.repositories.post_repository import (
    SQLAlchemyPostRepository,
)


async def _insert_user(label: str):
    uid = uuid4()
    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, provider, provider_id, email, name, "
                "timezone, notifications_enabled) "
                "VALUES (:id, 'github', :pid, :email, :name, 'UTC', false)"
            ),
            {"id": uid, "pid": f"{label}-{uid}", "email": f"{uid}@example.com", "name": label},
        )
        await session.commit()
    return uid


async def _delete_user(uid) -> None:
    factory = get_session_factory()
    async with factory() as session:
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": uid})
        await session.commit()


@pytest.fixture
async def user_id():
    """An isolated user; deleting it cascades to feeds, posts and user_posts."""
    uid = await _insert_user("progress")
    yield uid
    await _delete_user(uid)


@pytest.fixture
async def other_user_id():
    uid = await _insert_user("other")
    yield uid
    await _delete_user(uid)


async def _make_feed_with_posts(owner_id, guids=("a", "b", "c"), category_ids=None):
    """Create a feed with one post per guid; the first guid is the newest post."""
    factory = get_session_factory()
    async with factory() as session:
        feeds = SQLAlchemyFeedRepository(session)
        posts = SQLAlchemyPostRepository(session)
        feed = await feeds.save(
            Feed.create(
                user_id=owner_id,
                url=f"https://example.com/{uuid4()}",
                category_ids=category_ids,
            )
        )
        await session.commit()
        saved = []
        for minutes_ago, guid in enumerate(guids):
            saved.append(
                await posts.save(
                    Post.create(
                        feed_id=feed.id,
                        guid=guid,
                        title=f"Post {guid}",
                        link=f"https://example.com/{guid}",
                        published_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
                    )
                )
            )
        await session.commit()
    return feed, saved


@pytest.fixture
async def feed_and_posts(user_id):
    return await _make_feed_with_posts(user_id)


class TestRecordOpened:
    @pytest.mark.asyncio
    async def test_creates_an_unread_row_marked_as_opened(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            await posts.record_opened(user_id, post_a.id)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert state.is_read is False
        assert state.read_progress == 0.0
        assert state.read_at is None
        assert state.is_seen is True

    @pytest.mark.asyncio
    async def test_keeps_the_first_opened_at(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            await posts.record_opened(user_id, post_a.id)
            first = (await posts.get_user_post_state(user_id, post_a.id)).opened_at
            await posts.record_opened(user_id, post_a.id)
            second = (await posts.get_user_post_state(user_id, post_a.id)).opened_at

        assert first is not None
        assert second == first

    @pytest.mark.asyncio
    async def test_does_not_touch_an_existing_read_state(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_a.id, True)

            await posts.record_opened(user_id, post_a.id)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert state.is_read is True
        assert state.read_progress == 1.0
        assert state.is_seen is True


class TestRecordProgress:
    @pytest.mark.asyncio
    async def test_creates_a_row_with_progress_and_opened_at(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            state = await posts.record_progress(user_id, post_a.id, 0.4, completed=False)

        assert state.is_read is False
        assert state.read_progress == pytest.approx(0.4)
        assert state.read_at is None
        assert state.is_seen is True

    @pytest.mark.asyncio
    async def test_progress_only_moves_forward(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_progress(user_id, post_a.id, 0.5, completed=False)

            lower = await posts.record_progress(user_id, post_a.id, 0.2, completed=False)
            higher = await posts.record_progress(user_id, post_a.id, 0.7, completed=False)

        assert lower.read_progress == pytest.approx(0.5)
        assert higher.read_progress == pytest.approx(0.7)

    @pytest.mark.asyncio
    async def test_completion_marks_the_post_read_at_full_progress(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            state = await posts.record_progress(user_id, post_a.id, 0.97, completed=True)

        assert state.is_read is True
        assert state.read_progress == 1.0
        assert state.read_at is not None

    @pytest.mark.asyncio
    async def test_a_read_post_stays_read_and_keeps_its_read_at(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            done = await posts.record_progress(user_id, post_a.id, 0.97, completed=True)

            later = await posts.record_progress(user_id, post_a.id, 0.1, completed=False)

        assert later.is_read is True
        assert later.read_progress == 1.0
        assert later.read_at == done.read_at

    @pytest.mark.asyncio
    async def test_sets_opened_at_on_a_row_created_by_mark_as_read(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_a.id, True)
            assert (await posts.get_user_post_state(user_id, post_a.id)).is_seen is False

            state = await posts.record_progress(user_id, post_a.id, 0.3, completed=False)

        assert state.opened_at is not None
        assert state.is_read is True

    @pytest.mark.asyncio
    async def test_concurrent_writers_keep_the_highest_progress(self, user_id, feed_and_posts):
        """Tabs and devices race on a post with no row yet: nothing raises, the max wins."""
        _, (post_a, _b, _c) = feed_and_posts

        async def in_own_session(write):
            async with get_session_factory()() as session:
                await write(SQLAlchemyPostRepository(session))
                await session.commit()

        writers = [
            lambda posts: posts.record_opened(user_id, post_a.id),
            lambda posts: posts.record_progress(user_id, post_a.id, 0.2, completed=False),
            lambda posts: posts.record_progress(user_id, post_a.id, 0.6, completed=False),
            lambda posts: posts.record_progress(user_id, post_a.id, 0.4, completed=False),
        ]
        await asyncio.gather(*(in_own_session(write) for write in writers))

        async with get_session_factory()() as session:
            state = await SQLAlchemyPostRepository(session).get_user_post_state(user_id, post_a.id)
        assert state.read_progress == pytest.approx(0.6)
        assert state.is_read is False
        assert state.is_seen is True


class TestMarkAsRead:
    @pytest.mark.asyncio
    async def test_mark_read_without_a_row_creates_one_at_full_progress(
        self, user_id, feed_and_posts
    ):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            await posts.mark_as_read(user_id, post_a.id, True)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert state.is_read is True
        assert state.read_progress == 1.0
        assert state.read_at is not None
        assert state.is_seen is False

    @pytest.mark.asyncio
    async def test_mark_read_keeps_opened_at(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_opened(user_id, post_a.id)
            opened_at = (await posts.get_user_post_state(user_id, post_a.id)).opened_at

            await posts.mark_as_read(user_id, post_a.id, True)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert state.is_read is True
        assert state.opened_at == opened_at

    @pytest.mark.asyncio
    async def test_mark_unread_resets_progress_and_read_at_but_keeps_opened_at(
        self, user_id, feed_and_posts
    ):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_progress(user_id, post_a.id, 0.97, completed=True)
            opened_at = (await posts.get_user_post_state(user_id, post_a.id)).opened_at

            await posts.mark_as_read(user_id, post_a.id, False)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert (state.is_read, state.read_progress, state.read_at) == (False, 0.0, None)
        assert state.opened_at == opened_at

    @pytest.mark.asyncio
    async def test_get_read_state_returns_the_tuple_form(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            assert await posts.get_read_state(user_id, post_a.id) == (False, None)

            await posts.mark_as_read(user_id, post_a.id, True)
            is_read, read_at = await posts.get_read_state(user_id, post_a.id)

        assert is_read is True
        assert read_at is not None

    @pytest.mark.asyncio
    async def test_getters_are_not_stale_after_an_upsert_in_the_same_session(
        self, user_id, feed_and_posts
    ):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_opened(user_id, post_a.id)
            before = await posts.get_user_post_state(user_id, post_a.id)

            await posts.mark_as_read(user_id, post_a.id, True)
            after = await posts.get_user_post_state(user_id, post_a.id)

        assert before.is_read is False
        assert after.is_read is True


class TestMarkAllRead:
    @pytest.mark.asyncio
    async def test_mark_read_creates_missing_rows_and_updates_existing_ones(
        self, user_id, feed_and_posts
    ):
        feed, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_progress(user_id, post_a.id, 0.5, completed=False)
            await posts.mark_as_read(user_id, post_b.id, True)

            count = await posts.mark_all_read(user_id, True, feed_id=feed.id)
            state_a, state_b, state_c = [
                await posts.get_user_post_state(user_id, post.id)
                for post in (post_a, post_b, post_c)
            ]

        assert count == 3
        for state in (state_a, state_b, state_c):
            assert state.is_read is True
            assert state.read_progress == 1.0
            assert state.read_at is not None
        assert state_a.is_seen is True  # the opened_at of an existing row is kept
        assert state_c.is_seen is False  # inserted rows were never opened

    @pytest.mark.asyncio
    async def test_mark_unread_resets_progress_but_keeps_opened_at(self, user_id, feed_and_posts):
        feed, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_progress(user_id, post_a.id, 0.5, completed=False)
            await posts.mark_as_read(user_id, post_b.id, True)

            count = await posts.mark_all_read(user_id, False, feed_id=feed.id)
            state_a, state_b, state_c = [
                await posts.get_user_post_state(user_id, post.id)
                for post in (post_a, post_b, post_c)
            ]

        assert count == 3
        assert (state_a.is_read, state_a.read_progress, state_a.read_at) == (False, 0.0, None)
        assert state_a.is_seen is True
        assert (state_b.is_read, state_b.read_progress, state_b.read_at) == (False, 0.0, None)
        assert state_c == UserPostState()  # no row is created for an untouched post

    @pytest.mark.asyncio
    async def test_scope_never_reaches_other_users_posts(
        self, user_id, other_user_id, feed_and_posts
    ):
        _, (other_post,) = await _make_feed_with_posts(other_user_id, guids=("x",))
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            count = await posts.mark_all_read(user_id, True)
            foreign = await posts.get_user_post_state(user_id, other_post.id)

        assert count == 3
        assert foreign.is_read is False

    @pytest.mark.asyncio
    async def test_category_and_uncategorized_scopes(self, user_id):
        async with get_session_factory()() as session:
            category = await SQLAlchemyCategoryRepository(session).save(
                Category.create(user_id=user_id, name="Tech", position=1)
            )
            await session.commit()
        _, (in_category, _second) = await _make_feed_with_posts(
            user_id, guids=("c1", "c2"), category_ids=[category.id]
        )
        _, (loose,) = await _make_feed_with_posts(user_id, guids=("u1",))

        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            categorized_count = await posts.mark_all_read(user_id, True, category_id=category.id)
            categorized_state = await posts.get_user_post_state(user_id, in_category.id)
            loose_before = await posts.get_user_post_state(user_id, loose.id)
            uncategorized_count = await posts.mark_all_read(user_id, True, uncategorized=True)
            loose_after = await posts.get_user_post_state(user_id, loose.id)

        assert categorized_count == 2
        assert categorized_state.is_read is True
        assert loose_before.is_read is False
        assert uncategorized_count == 1
        assert loose_after.is_read is True
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
docker compose exec -T backend pytest tests/integration/test_post_reading_progress.py -q
```

Expected: every test fails with `AttributeError: 'SQLAlchemyPostRepository' object has no attribute 'record_opened'` (or `get_user_post_state`).

- [ ] **Step 3: Extend the repository ABC**

Edit `backend/app/domain/feed_management/repositories/post_repository.py` (five edits).

Replace

```python
from app.domain.feed_management.entities.post import Post


ReadState = Literal["all", "unread", "read"]
```

with

```python
from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.entities.user_post_state import UserPostState


ReadState = Literal["all", "unread", "in_progress", "read"]
```

In the `get_posts_for_user` docstring replace

```python
            read_state: Filter by read state ("all", "unread", "read")
```

with

```python
            read_state: Filter by read state ("all", "unread", "in_progress", "read");
                "in_progress" means not read yet but with some reading progress
```

and replace

```python
            List of Post entities with is_read and has_audio populated
```

with

```python
            List of Post entities with is_read, read_progress, is_seen and has_audio populated
```

In the `mark_as_read` docstring replace

```python
        Creates UserPost record if it doesn't exist.
```

with

```python
        Creates UserPost record if it doesn't exist. Marking read sets the progress to
        1.0; marking unread resets it to 0.0. ``opened_at`` is left alone either way.
```

Insert the three new abstract methods immediately before `get_unread_counts_by_feed` — replace

```python
    @abstractmethod
    async def get_unread_counts_by_feed(self, user_id: UUID) -> dict[UUID, int]:
```

with

```python
    @abstractmethod
    async def record_opened(self, user_id: UUID, post_id: UUID) -> None:
        """Remember that the user opened a post.

        Creates the UserPost row when it is missing and sets ``opened_at`` only
        while it is still NULL. Never changes the read state or the progress.

        Args:
            user_id: User UUID
            post_id: Post UUID
        """
        pass

    @abstractmethod
    async def record_progress(
        self, user_id: UUID, post_id: UUID, progress: float, *, completed: bool
    ) -> UserPostState:
        """Record reading progress for a post and return the resulting state.

        Progress only ever moves forward (a monotonic maximum). ``completed``
        flips the post to read at 100%. A post that is already read stays read
        and keeps its ``read_at``. ``opened_at`` is set while it is still NULL.

        Args:
            user_id: User UUID
            post_id: Post UUID
            progress: Reading position from 0.0 to 1.0
            completed: Whether this report crosses the completion threshold

        Returns:
            The user's state for the post after the write
        """
        pass

    @abstractmethod
    async def get_user_post_state(self, user_id: UUID, post_id: UUID) -> UserPostState:
        """Get a user's read state, progress and opened time for a post.

        Returns the untouched default state when the user has no row for it.

        Args:
            user_id: User UUID
            post_id: Post UUID
        """
        pass

    @abstractmethod
    async def get_unread_counts_by_feed(self, user_id: UUID) -> dict[UUID, int]:
```

- [ ] **Step 4: Implement the upserts in the SQLAlchemy repository**

Edit `backend/app/infrastructure/persistence/repositories/post_repository.py`.

Replace the SQLAlchemy and entity imports

```python
from sqlalchemy import delete, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.feed_management.entities.post import Post
```

with

```python
from sqlalchemy import case, delete, exists, func, literal, or_, select, true, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.entities.user_post_state import UserPostState
```

Add a module constant between the imports and the class:

```python
_USER_POST_UNIQUE = "uq_user_posts_user_id_post_id"
```

Replace the adjacent methods `mark_as_read` and `get_read_state` with the following. The getters select *columns*, never the entity, so Core upserts in the same session can never leave a stale ORM instance behind:

```python
    async def mark_as_read(self, user_id: UUID, post_id: UUID, is_read: bool = True) -> None:
        """Mark a post as read/unread for a user.

        Marking read sets the progress to 100%; marking unread resets it to 0%.
        ``opened_at`` is never touched.
        """
        stmt = pg_insert(UserPostModel).values(
            user_id=user_id,
            post_id=post_id,
            is_read=is_read,
            read_progress=1.0 if is_read else 0.0,
            read_at=datetime.now(timezone.utc) if is_read else None,
        )
        stmt = stmt.on_conflict_do_update(
            constraint=_USER_POST_UNIQUE,
            set_={
                "is_read": stmt.excluded.is_read,
                "read_progress": stmt.excluded.read_progress,
                "read_at": stmt.excluded.read_at,
            },
        )
        await self._session.execute(stmt)

    async def record_opened(self, user_id: UUID, post_id: UUID) -> None:
        """Remember that the user opened a post; ``opened_at`` is only ever set once."""
        stmt = pg_insert(UserPostModel).values(
            user_id=user_id,
            post_id=post_id,
            is_read=False,
            read_progress=0.0,
            read_at=None,
            opened_at=datetime.now(timezone.utc),
        )
        stmt = stmt.on_conflict_do_update(
            constraint=_USER_POST_UNIQUE,
            set_={"opened_at": func.coalesce(UserPostModel.opened_at, stmt.excluded.opened_at)},
        )
        await self._session.execute(stmt)

    async def record_progress(
        self, user_id: UUID, post_id: UUID, progress: float, *, completed: bool
    ) -> UserPostState:
        """Upsert reading progress and return the resulting state.

        Progress is a monotonic maximum. A post that is already read stays read at
        100% with its original ``read_at``. ``opened_at`` is set while still NULL.
        """
        now = datetime.now(timezone.utc)
        stmt = pg_insert(UserPostModel).values(
            user_id=user_id,
            post_id=post_id,
            is_read=completed,
            read_progress=1.0 if completed else progress,
            read_at=now if completed else None,
            opened_at=now,
        )
        new = stmt.excluded
        already_read = UserPostModel.is_read.is_(True)
        stmt = stmt.on_conflict_do_update(
            constraint=_USER_POST_UNIQUE,
            set_={
                "is_read": or_(UserPostModel.is_read, new.is_read),
                "read_progress": case(
                    (already_read, 1.0),
                    else_=func.greatest(UserPostModel.read_progress, new.read_progress),
                ),
                "read_at": case(
                    (already_read, UserPostModel.read_at),
                    (new.is_read.is_(True), new.read_at),
                    else_=UserPostModel.read_at,
                ),
                "opened_at": func.coalesce(UserPostModel.opened_at, new.opened_at),
            },
        ).returning(
            UserPostModel.is_read,
            UserPostModel.read_at,
            UserPostModel.read_progress,
            UserPostModel.opened_at,
        )
        row = (await self._session.execute(stmt)).one()
        return UserPostState(
            is_read=row.is_read,
            read_at=row.read_at,
            read_progress=float(row.read_progress),
            opened_at=row.opened_at,
        )

    async def get_user_post_state(self, user_id: UUID, post_id: UUID) -> UserPostState:
        """Get a user's state for a post; the untouched default when there is no row."""
        result = await self._session.execute(
            select(
                UserPostModel.is_read,
                UserPostModel.read_at,
                UserPostModel.read_progress,
                UserPostModel.opened_at,
            ).where(UserPostModel.user_id == user_id, UserPostModel.post_id == post_id)
        )
        row = result.one_or_none()
        if row is None:
            return UserPostState()
        return UserPostState(
            is_read=row.is_read,
            read_at=row.read_at,
            read_progress=float(row.read_progress),
            opened_at=row.opened_at,
        )

    async def get_read_state(self, user_id: UUID, post_id: UUID) -> tuple[bool, Optional[datetime]]:
        """Get read state for a specific post and user."""
        state = await self.get_user_post_state(user_id, post_id)
        return (state.is_read, state.read_at)
```

Replace the whole `mark_all_read` method with the set-based version and its scope helper (no per-row loading; a single `INSERT … SELECT … ON CONFLICT` for "mark read", a single `UPDATE` for "mark unread"). `gen_random_uuid()` supplies the `id`, because Python-side defaults do not apply to `INSERT … SELECT`; `literal(..., column.type)` keeps asyncpg's bind casts correct (a tz-aware datetime needs a `timestamptz`):

```python
    @staticmethod
    def _scoped_posts(
        *columns,
        user_id: UUID,
        category_id: Optional[UUID],
        feed_id: Optional[UUID],
        uncategorized: bool,
    ):
        """SELECT ``columns`` for the posts in a scope (only the user's own feeds)."""
        query = (
            select(*columns)
            .select_from(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .where(FeedModel.user_id == user_id)
        )
        if category_id is not None:
            query = query.join(feed_categories, FeedModel.id == feed_categories.c.feed_id).where(
                feed_categories.c.category_id == category_id
            )
        if uncategorized:
            query = query.where(~exists().where(feed_categories.c.feed_id == FeedModel.id))
        if feed_id is not None:
            query = query.where(PostModel.feed_id == feed_id)
        return query

    async def mark_all_read(
        self,
        user_id: UUID,
        is_read: bool,
        *,
        category_id: Optional[UUID] = None,
        feed_id: Optional[UUID] = None,
        uncategorized: bool = False,
    ) -> int:
        """Mark every post in a scope read/unread for a user (set-based)."""
        scope = {
            "user_id": user_id,
            "category_id": category_id,
            "feed_id": feed_id,
            "uncategorized": uncategorized,
        }

        if is_read:
            insert_stmt = pg_insert(UserPostModel).from_select(
                ["id", "user_id", "post_id", "is_read", "read_progress", "read_at"],
                self._scoped_posts(
                    func.gen_random_uuid(),
                    literal(user_id, UserPostModel.user_id.type),
                    PostModel.id,
                    true(),
                    literal(1.0, UserPostModel.read_progress.type),
                    literal(datetime.now(timezone.utc), UserPostModel.read_at.type),
                    **scope,
                ),
            )
            insert_stmt = insert_stmt.on_conflict_do_update(
                constraint=_USER_POST_UNIQUE,
                set_={
                    "is_read": insert_stmt.excluded.is_read,
                    "read_progress": insert_stmt.excluded.read_progress,
                    "read_at": insert_stmt.excluded.read_at,
                },
            )
            result = await self._session.execute(insert_stmt)
            return result.rowcount

        scoped_ids = self._scoped_posts(PostModel.id, **scope)
        total = (
            await self._session.execute(select(func.count()).select_from(scoped_ids.subquery()))
        ).scalar_one()
        if total:
            await self._session.execute(
                update(UserPostModel)
                .where(UserPostModel.user_id == user_id, UserPostModel.post_id.in_(scoped_ids))
                .values(is_read=False, read_progress=0.0, read_at=None)
                .execution_options(synchronize_session=False)
            )
        return total
```

- [ ] **Step 5: Run the tests green, plus the regression suites that touch read state**

```bash
docker compose exec -T backend pytest tests/integration/test_post_reading_progress.py tests/integration/test_unread_counts_by_category.py -q
docker compose exec -T backend pytest tests/unit tests/contract/test_posts.py -q
```

Expected: all pass. If `test_mark_read_creates_missing_rows…` fails with `ON CONFLICT DO UPDATE command cannot affect row a second time`, the scope query returned a post twice — fix `_scoped_posts` (it must yield one row per post), do not weaken the test.

- [ ] **Step 6: Commit (only if the user asked for commits)**

```bash
git add backend/app/domain/feed_management/repositories/post_repository.py backend/app/infrastructure/persistence/repositories/post_repository.py backend/tests/integration/test_post_reading_progress.py
git commit -m "feat(backend): atomic read-progress upserts and set-based bulk marking" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Single-query post listing with SQL read-state filters

The current `get_posts_for_user` issues one `get_read_state` query per post and applies the read-state filter in Python *after* `LIMIT`. A filtered page can therefore come back short (the service reads `len(posts) < limit` as "no more pages" and pagination ends early), and `in_progress` has no SQL form. This task replaces it with one `LEFT JOIN user_posts` and SQL predicates.

**Files:**
- Modify: `backend/tests/integration/test_post_reading_progress.py`
- Modify: `backend/app/infrastructure/persistence/repositories/post_repository.py`

**Interfaces:**
- Consumes: `record_opened`, `record_progress`, `mark_as_read` (Task 3); `Post.read_progress` and `Post.is_seen` (Task 2); `ReadState` with `"in_progress"` (Task 3).
- Produces: `SQLAlchemyPostRepository.get_posts_for_user(user_id, *, category_id, feed_id, read_state, before, limit, uncategorized) -> List[Post]` — same signature as today. Every returned `Post` carries the user's `is_read`, `read_progress` and `is_seen` from a single joined query, and `read_state` (`all` | `unread` | `in_progress` | `read`) is a SQL predicate applied before `LIMIT`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/integration/test_post_reading_progress.py`, replace

```python
from sqlalchemy import text
```

with

```python
from sqlalchemy import event, text
```

replace

```python
from app.domain.feed_management.entities.category import Category
```

with

```python
from app.application.services.post_service import PostService
from app.domain.feed_management.entities.category import Category
```

and replace

```python
from app.infrastructure.persistence.database import get_session_factory
```

with

```python
from app.infrastructure.persistence.database import get_engine, get_session_factory
```

Append at the end of the file:

```python


async def _seed_reading_states(posts, user_id, post_a, post_b, post_c):
    """a = marked read, b = 40% read, c = opened only."""
    await posts.mark_as_read(user_id, post_a.id, True)
    await posts.record_progress(user_id, post_b.id, 0.4, completed=False)
    await posts.record_opened(user_id, post_c.id)


class TestListPostsForUser:
    @pytest.mark.asyncio
    async def test_posts_carry_the_users_reading_state(self, user_id, feed_and_posts):
        _, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await _seed_reading_states(posts, user_id, post_a, post_b, post_c)

            listed = {post.guid: post for post in await posts.get_posts_for_user(user_id)}

        read, partial, opened = listed["a"], listed["b"], listed["c"]
        assert (read.is_read, read.read_progress, read.is_seen) == (True, 1.0, False)
        assert (partial.is_read, partial.is_seen) == (False, True)
        assert partial.read_progress == pytest.approx(0.4)
        assert (opened.is_read, opened.read_progress, opened.is_seen) == (False, 0.0, True)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("read_state", "expected"),
        [
            ("all", ["a", "b", "c"]),
            ("unread", ["b", "c"]),
            ("in_progress", ["b"]),
            ("read", ["a"]),
        ],
    )
    async def test_read_state_filters(self, user_id, feed_and_posts, read_state, expected):
        _, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await _seed_reading_states(posts, user_id, post_a, post_b, post_c)

            listed = await posts.get_posts_for_user(user_id, read_state=read_state)

        assert [post.guid for post in listed] == expected

    @pytest.mark.asyncio
    async def test_limit_applies_after_the_read_state_filter(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_a.id, True)  # the newest post

            listed = await posts.get_posts_for_user(user_id, read_state="unread", limit=2)

        assert [post.guid for post in listed] == ["b", "c"]

    @pytest.mark.asyncio
    async def test_before_cursor_paginates_within_a_filter(self, user_id, feed_and_posts):
        _, (post_a, post_b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_b.id, True)

            page = await posts.get_posts_for_user(
                user_id, read_state="unread", before=post_a.published_at
            )

        assert [post.guid for post in page] == ["c"]

    @pytest.mark.asyncio
    async def test_another_users_state_does_not_leak(self, user_id, other_user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(other_user_id, post_a.id, True)

            everything = await posts.get_posts_for_user(user_id)
            unread = await posts.get_posts_for_user(user_id, read_state="unread")

        assert [(post.guid, post.is_read) for post in everything] == [
            ("a", False),
            ("b", False),
            ("c", False),
        ]
        assert [post.guid for post in unread] == ["a", "b", "c"]

    @pytest.mark.asyncio
    async def test_a_filtered_list_pages_through_the_service_without_gaps(
        self, user_id, feed_and_posts
    ):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_a.id, True)
            service = PostService(
                post_repository=posts,
                category_repository=SQLAlchemyCategoryRepository(session),
                feed_repository=SQLAlchemyFeedRepository(session),
            )

            first = await service.list_posts(user_id, read_state="unread", limit=1)
            assert ([post.guid for post in first.posts], first.has_more) == (["b"], True)

            second = await service.list_posts(
                user_id,
                read_state="unread",
                limit=1,
                before=datetime.fromisoformat(first.next_cursor),
            )
            assert ([post.guid for post in second.posts], second.has_more) == (["c"], True)

            third = await service.list_posts(
                user_id,
                read_state="unread",
                limit=1,
                before=datetime.fromisoformat(second.next_cursor),
            )
            assert (third.posts, third.has_more) == ([], False)

    @pytest.mark.asyncio
    async def test_progress_does_not_change_the_unread_counts(self, user_id, feed_and_posts):
        feed, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await _seed_reading_states(posts, user_id, post_a, post_b, post_c)

            counts = await posts.get_unread_counts_by_feed(user_id)

        # Only the hand-marked post leaves the badge; 40% read and merely opened both stay.
        assert counts == {feed.id: 2}

    @pytest.mark.asyncio
    async def test_reads_user_posts_in_a_single_statement(self, user_id, feed_and_posts):
        _, (post_a, post_b, post_c) = feed_and_posts
        statements: list[str] = []

        def record(_conn, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement)

        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await _seed_reading_states(posts, user_id, post_a, post_b, post_c)

            sync_engine = get_engine().sync_engine
            event.listen(sync_engine, "before_cursor_execute", record)
            try:
                await posts.get_posts_for_user(user_id)
            finally:
                event.remove(sync_engine, "before_cursor_execute", record)

        assert sum("user_posts" in statement for statement in statements) == 1
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
docker compose exec -T backend pytest tests/integration/test_post_reading_progress.py -k TestListPostsForUser -q
```

Expected: five failures — `test_posts_carry_the_users_reading_state` (`read_progress` is `0.0`, the old listing never sets it), `test_read_state_filters[in_progress-…]` (the old code returns all three posts), `test_limit_applies_after_the_read_state_filter` (`['b'] != ['b', 'c']`: the limit cut the read post first), `test_a_filtered_list_pages_through_the_service_without_gaps` (the first `limit=1` page is empty and `has_more` is false, so paging dead-ends) and `test_reads_user_posts_in_a_single_statement` (`3 == 1`, one query per post). The `all` / `unread` / `read` cases, the `before` test, the leak test and the unread-count test already pass; they guard the rewrite.

- [ ] **Step 3: Rewrite `get_posts_for_user`**

Edit `backend/app/infrastructure/persistence/repositories/post_repository.py`.

Replace the SQLAlchemy import (as Task 3 left it)

```python
from sqlalchemy import case, delete, exists, func, literal, or_, select, true, update
```

with

```python
from sqlalchemy import and_, case, delete, exists, func, literal, or_, select, true, update
```

Replace the whole method `get_posts_for_user` — from `async def get_posts_for_user(` through its final `return posts`, the line just before `async def get_by_feed(` — with:

```python
    async def get_posts_for_user(
        self,
        user_id: UUID,
        *,
        category_id: Optional[UUID] = None,
        feed_id: Optional[UUID] = None,
        read_state: ReadState = "all",
        before: Optional[datetime] = None,
        limit: int = 50,
        uncategorized: bool = False,
    ) -> List[Post]:
        """Get posts for a user with optional filters.

        The user's reading state comes from one LEFT JOIN, and the read-state
        filter is a SQL predicate, so LIMIT applies to the filtered rows.
        """
        query = (
            select(
                PostModel,
                UserPostModel.is_read,
                UserPostModel.read_progress,
                UserPostModel.opened_at.is_not(None).label("is_seen"),
            )
            .select_from(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            # The user predicate sits in the ON clause so posts without a row stay in.
            .outerjoin(
                UserPostModel,
                and_(UserPostModel.post_id == PostModel.id, UserPostModel.user_id == user_id),
            )
            .where(FeedModel.user_id == user_id)
            .options(selectinload(PostModel.feed), selectinload(PostModel.audio))
        )

        if category_id is not None:
            query = query.join(feed_categories, FeedModel.id == feed_categories.c.feed_id).where(
                feed_categories.c.category_id == category_id
            )

        if uncategorized:
            query = query.where(~exists().where(feed_categories.c.feed_id == FeedModel.id))

        if feed_id is not None:
            query = query.where(PostModel.feed_id == feed_id)

        # A post with no user_posts row is unread with no progress, hence IS NOT TRUE.
        if read_state == "read":
            query = query.where(UserPostModel.is_read.is_(True))
        elif read_state == "unread":
            query = query.where(UserPostModel.is_read.is_not(True))
        elif read_state == "in_progress":
            query = query.where(
                UserPostModel.is_read.is_not(True), UserPostModel.read_progress > 0.0
            )

        # Cursor-based pagination
        if before is not None:
            query = query.where(PostModel.published_at < before)

        # Order by published_at descending (newest first); id breaks ties so the
        # ordering — and the response ETag — is deterministic.
        query = query.order_by(PostModel.published_at.desc(), PostModel.id.desc())

        # Limit
        query = query.limit(limit)

        result = await self._session.execute(query)
        posts: List[Post] = []
        for model, is_read, read_progress, is_seen in result.all():
            post = self._to_entity(model)
            post.is_read = bool(is_read)
            post.read_progress = float(read_progress or 0.0)
            post.is_seen = bool(is_seen)
            posts.append(post)
        return posts
```

`_to_entity` is unchanged (it still leaves `is_read=False  # Populated by caller`); the loop above is the caller. `get_read_state` stays — `PostService.mark_as_read` still returns it.

- [ ] **Step 4: Run the tests green, plus the regression suites**

```bash
docker compose exec -T backend pytest tests/integration/test_post_reading_progress.py tests/integration/test_unread_counts_by_category.py -q
docker compose exec -T backend pytest tests/unit tests/contract/test_posts.py -q
```

Expected: all pass. The contract suite still sees the old `GET /posts/{id}` behaviour (Task 6 changes the route); only the list query changed here.

- [ ] **Step 5: Commit (only if the user asked for commits)**

```bash
git add backend/app/infrastructure/persistence/repositories/post_repository.py backend/tests/integration/test_post_reading_progress.py
git commit -m "feat(backend): list posts in one query with SQL read-state filters" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Service — `open_post`, `record_progress` and the reading state in `get_post`

**Files:**
- Modify: `backend/tests/unit/test_post_service.py`
- Modify: `backend/app/application/services/post_service.py`

**Interfaces:**
- Consumes: `PostRepository.record_opened`, `record_progress`, `get_user_post_state` and `ReadState` (Task 3); `READ_COMPLETION_THRESHOLD` (Task 2); `Post.read_progress` / `Post.is_seen` (Task 2).
- Produces:
  - `PostService.get_post(user_id, post_id) -> Post` — now also sets `post.read_progress` and `post.is_seen`.
  - `PostService.open_post(user_id, post_id) -> Post` — records the *first* open (`opened_at`) and never marks the post read.
  - `PostService.record_progress(user_id, post_id, progress: float) -> tuple[bool, float, datetime | None]` — returns `(is_read, read_progress, read_at)`; `completed` is `progress >= READ_COMPLETION_THRESHOLD`.
  - `ReadState` is imported from the repository ABC, so it gains `"in_progress"`; the name stays importable from `post_service`.
- `auto_mark_read` is left in place here because the `GET /posts/{id}` route still calls it. Task 6 switches the route to `open_post` and then deletes `auto_mark_read` with its two unit tests.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_post_service.py`, replace the header imports

```python
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
```

with

```python
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.entities.user_post_state import UserPostState
```

Insert this class between `TestPostServiceReadState` and `class TestPostServiceUnreadCounts:`:

```python
class TestPostServiceReadingProgress:
    """Opening a post only records that it was seen; progress is reported separately."""

    @pytest.fixture
    def user_id(self):
        return uuid4()

    @pytest.fixture
    def post(self):
        return Post.create(
            feed_id=uuid4(),
            guid="guid-1",
            title="Title",
            link="https://example.com/1",
            published_at=datetime.now(timezone.utc),
        )

    @pytest.fixture
    def repo(self, post):
        repo = AsyncMock()
        repo.get_by_id.return_value = post
        repo.get_user_post_state.return_value = UserPostState()
        return repo

    @pytest.fixture
    def service(self, repo, post, user_id):
        from app.application.services.post_service import PostService

        feeds = AsyncMock()
        feeds.get_by_id.return_value = MagicMock(id=post.feed_id, user_id=user_id)
        return PostService(
            post_repository=repo, category_repository=AsyncMock(), feed_repository=feeds
        )

    @pytest.mark.asyncio
    async def test_get_post_includes_the_users_reading_state(self, service, repo, post, user_id):
        repo.get_user_post_state.return_value = UserPostState(
            read_progress=0.4, opened_at=datetime.now(timezone.utc)
        )

        result = await service.get_post(user_id, post.id)

        assert result.is_read is False
        assert result.read_progress == 0.4
        assert result.is_seen is True

    @pytest.mark.asyncio
    async def test_open_post_records_the_first_open_without_marking_read(
        self, service, repo, post, user_id
    ):
        result = await service.open_post(user_id, post.id)

        repo.record_opened.assert_awaited_once_with(user_id, post.id)
        repo.mark_as_read.assert_not_called()
        assert result.is_seen is True
        assert result.is_read is False

    @pytest.mark.asyncio
    async def test_open_post_does_not_write_for_an_already_seen_post(
        self, service, repo, post, user_id
    ):
        repo.get_user_post_state.return_value = UserPostState(
            read_progress=0.6, opened_at=datetime.now(timezone.utc)
        )

        result = await service.open_post(user_id, post.id)

        repo.record_opened.assert_not_called()
        assert result.read_progress == 0.6
        assert result.is_seen is True

    @pytest.mark.asyncio
    async def test_open_post_records_the_open_of_a_post_marked_read_by_hand(
        self, service, repo, post, user_id
    ):
        repo.get_user_post_state.return_value = UserPostState(
            is_read=True, read_at=datetime.now(timezone.utc), read_progress=1.0
        )

        result = await service.open_post(user_id, post.id)

        repo.record_opened.assert_awaited_once_with(user_id, post.id)
        assert result.is_read is True
        assert result.is_seen is True

    @pytest.mark.asyncio
    async def test_open_post_rejects_another_users_post(self, service, repo, post):
        from app.application.services.post_service import PostPermissionError

        with pytest.raises(PostPermissionError):
            await service.open_post(uuid4(), post.id)

        repo.record_opened.assert_not_called()

    @pytest.mark.asyncio
    async def test_open_post_raises_for_a_missing_post(self, service, repo, user_id):
        from app.application.services.post_service import PostNotFoundError

        repo.get_by_id.return_value = None

        with pytest.raises(PostNotFoundError):
            await service.open_post(user_id, uuid4())

        repo.record_opened.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("progress", "completed"),
        [(0.0, False), (0.949, False), (0.95, True), (1.0, True)],
    )
    async def test_record_progress_completes_at_the_threshold(
        self, service, repo, post, user_id, progress, completed
    ):
        repo.record_progress.return_value = UserPostState()

        await service.record_progress(user_id, post.id, progress)

        repo.record_progress.assert_awaited_once_with(
            user_id, post.id, progress, completed=completed
        )

    @pytest.mark.asyncio
    async def test_record_progress_returns_the_stored_state(self, service, repo, post, user_id):
        read_at = datetime.now(timezone.utc)
        repo.record_progress.return_value = UserPostState(
            is_read=True, read_at=read_at, read_progress=1.0
        )

        result = await service.record_progress(user_id, post.id, 0.97)

        assert result == (True, 1.0, read_at)

    @pytest.mark.asyncio
    async def test_record_progress_rejects_another_users_post(self, service, repo, post):
        from app.application.services.post_service import PostPermissionError

        with pytest.raises(PostPermissionError):
            await service.record_progress(uuid4(), post.id, 0.5)

        repo.record_progress.assert_not_called()

    @pytest.mark.asyncio
    async def test_record_progress_raises_for_a_missing_post(self, service, repo, user_id):
        from app.application.services.post_service import PostNotFoundError

        repo.get_by_id.return_value = None

        with pytest.raises(PostNotFoundError):
            await service.record_progress(user_id, uuid4(), 0.5)

        repo.record_progress.assert_not_called()
```

Insert this test in `TestPostServiceListPosts`, right after `test_list_posts_filters_by_read_state`:

```python
    @pytest.mark.asyncio
    async def test_list_posts_passes_the_in_progress_filter_through(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should hand the in-progress filter to the repository unchanged."""
        from app.application.services.post_service import PostService

        mock_post_repository.get_posts_for_user.return_value = []

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.list_posts(user_id=uuid4(), read_state="in_progress", limit=50)

        call_kwargs = mock_post_repository.get_posts_for_user.call_args[1]
        assert call_kwargs.get("read_state") == "in_progress"
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
docker compose exec -T backend pytest tests/unit/test_post_service.py -q
```

Expected: the `open_post` and `record_progress` tests fail with `AttributeError: 'PostService' object has no attribute 'open_post'` (or `'record_progress'`), and `test_get_post_includes_the_users_reading_state` fails because `get_post` still calls `get_read_state`. `test_list_posts_passes_the_in_progress_filter_through` already passes (the service never validated the filter) and guards the pass-through. The existing tests keep passing.

- [ ] **Step 3: Implement the service methods**

Edit `backend/app/application/services/post_service.py` (four edits).

Replace the imports and the module-level `ReadState`

```python
from typing import List, Literal, Optional
from uuid import UUID

from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.repositories.category_repository import CategoryRepository
from app.domain.feed_management.repositories.feed_repository import FeedRepository
from app.domain.feed_management.repositories.post_repository import PostRepository

ReadState = Literal["all", "unread", "read"]
```

with

```python
from typing import List, Optional
from uuid import UUID

from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.entities.user_post_state import READ_COMPLETION_THRESHOLD
from app.domain.feed_management.repositories.category_repository import CategoryRepository
from app.domain.feed_management.repositories.feed_repository import FeedRepository
from app.domain.feed_management.repositories.post_repository import PostRepository, ReadState
```

In `get_post`, replace the docstring line

```python
            Post with full content
```

with

```python
            Post with full content and the user's reading state
```

and replace the tail

```python
        # Get read state
        is_read, _ = await self._post_repository.get_read_state(user_id, post_id)
        post.is_read = is_read

        return post
```

with

```python
        state = await self._post_repository.get_user_post_state(user_id, post_id)
        post.is_read = state.is_read
        post.read_progress = state.read_progress
        post.is_seen = state.is_seen

        return post
```

Insert these two methods directly after `mark_as_read` (before `auto_mark_read`):

```python
    async def open_post(self, user_id: UUID, post_id: UUID) -> Post:
        """Open a post: record that the user has seen it, without marking it read.

        Reading is credited separately through record_progress.

        Args:
            user_id: User UUID
            post_id: Post UUID

        Returns:
            Post with full content and the user's reading state

        Raises:
            PostNotFoundError: If post doesn't exist
            PostPermissionError: If user doesn't have access
        """
        post = await self.get_post(user_id, post_id)
        if not post.is_seen:
            await self._post_repository.record_opened(user_id, post_id)
            post.is_seen = True
        return post

    async def record_progress(
        self, user_id: UUID, post_id: UUID, progress: float
    ) -> tuple[bool, float, Optional[datetime]]:
        """Record the furthest reading position the user has reached.

        Progress only moves forward. A position at or beyond
        READ_COMPLETION_THRESHOLD marks the post read.

        Args:
            user_id: User UUID
            post_id: Post UUID
            progress: Reading position from 0.0 to 1.0 (range-checked by the API layer)

        Returns:
            Tuple of (is_read, read_progress, read_at)

        Raises:
            PostNotFoundError: If post doesn't exist
            PostPermissionError: If user doesn't have access
        """
        await self.get_post(user_id, post_id)

        state = await self._post_repository.record_progress(
            user_id,
            post_id,
            progress,
            completed=progress >= READ_COMPLETION_THRESHOLD,
        )
        return (state.is_read, state.read_progress, state.read_at)
```

- [ ] **Step 4: Run the tests green**

```bash
docker compose exec -T backend pytest tests/unit tests/contract/test_posts.py -q
```

Expected: all pass — the route still calls `auto_mark_read`, which is untouched.

- [ ] **Step 5: Commit (only if the user asked for commits)**

```bash
git add backend/app/application/services/post_service.py backend/tests/unit/test_post_service.py
git commit -m "feat(backend): open_post and record_progress in PostService" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 6: API — opening is not reading, `PUT /posts/{id}/progress`, `readState=in_progress`

**Files:**
- Modify: `backend/tests/contract/conftest.py`
- Modify: `backend/tests/contract/test_posts.py`
- Modify: `backend/app/api/routes/posts.py`
- Modify: `backend/app/application/services/post_service.py` (delete `auto_mark_read`)
- Modify: `backend/tests/unit/test_post_service.py` (delete the two `auto_mark_read` tests)

**Interfaces:**
- Consumes: `PostService.open_post` and `PostService.record_progress` (Task 5); `ReadState` with `"in_progress"` (Tasks 3-5); `Post.to_summary_dict()` / `to_detail_dict()` with `readProgress` and `isSeen` (Task 2).
- Produces (HTTP):
  - `GET /api/posts?readState=all|unread|in_progress|read`. Each list item carries `readProgress` (0..1) and `isSeen`.
  - `GET /api/posts/{postId}` records the open and returns the real `isRead` / `readProgress` with `isSeen: true`. It no longer marks the post read.
  - `PUT /api/posts/{postId}/progress` with `{"progress": <0..1>}` → `200 {postId, isRead, readProgress, readAt}`; `400 VALIDATION_ERROR`; `401`; `404 {"error": "not_found", "message": "Post not found"}` (the flat shape the other post routes use).

**Error shapes the tests rely on.** The global handler renders `ValidationError` as `{"error": {"code": "VALIDATION_ERROR", "message": ...}}`, while the post routes' own 404 is the flat `{"error": "not_found", ...}`. Contract tests therefore assert `data["error"]["code"]` for validation and `data["error"] == "not_found"` for 404s.

**Rate limits.** Every `/api/` request passes `RequestAdmission` (`backend/app/api/middleware/request_security.py`): fixed 60 s windows, 60 mutations and 120 reads per user. The contract suite shares one app, so every `TEST_USER_ID` request counts toward the same window. The new tests add at most 9 mutations for `TEST_USER_ID` (the stateful ones) and run everything else (validation, 404) as a brand-new user through `fresh_auth_headers`. A `429 RATE_LIMITED` in a contract run means a window was exceeded: move the offending test to `fresh_auth_headers`.

- [ ] **Step 1: Make the contract seed idempotent and add the state-reset fixtures**

The contract database is persistent and never rolled back, and earlier tests (`test_mark_post_as_read`, …) leave state behind. The new tests therefore pin the exact starting state they rely on.

In `backend/tests/contract/conftest.py`, replace

```python
        # Mark post2 as read
        await session.execute(
            text(
                "INSERT INTO user_posts (id, user_id, post_id, is_read, read_at) "
                "VALUES (:id, :uid, :pid, true, :at) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": TEST_USERPOST_ID, "uid": TEST_USER_ID, "pid": TEST_POST2_ID, "at": now},
        )
```

with

```python
        # Mark post2 as read. No conflict target: either the primary key or the
        # (user_id, post_id) unique constraint may already hold the row.
        await session.execute(
            text(
                "INSERT INTO user_posts (id, user_id, post_id, is_read, read_progress, read_at) "
                "VALUES (:id, :uid, :pid, true, 1, :at) "
                "ON CONFLICT DO NOTHING"
            ),
            {"id": TEST_USERPOST_ID, "uid": TEST_USER_ID, "pid": TEST_POST2_ID, "at": now},
        )
```

Then add two fixtures directly after the existing `read_post_id` fixture (and before `other_user_post_id`):

```python
@pytest.fixture
async def fresh_unread_post_id():
    """TEST_POST1_ID with the reading state cleared: unread, never opened, no progress."""
    await _seed_full_data()

    from app.infrastructure.persistence.database import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            text("DELETE FROM user_posts WHERE user_id = :uid AND post_id = :pid"),
            {"uid": TEST_USER_ID, "pid": TEST_POST1_ID},
        )
        await session.commit()
    return TEST_POST1_ID


@pytest.fixture
async def fresh_read_post_id():
    """TEST_POST2_ID read with full progress and not yet opened."""
    await _seed_full_data()

    from app.infrastructure.persistence.database import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            text(
                "INSERT INTO user_posts (id, user_id, post_id, is_read, read_progress, read_at) "
                "VALUES (:id, :uid, :pid, true, 1, now()) "
                "ON CONFLICT (user_id, post_id) DO UPDATE SET "
                "is_read = true, read_progress = 1, read_at = now(), opened_at = NULL"
            ),
            {"id": uuid4(), "uid": TEST_USER_ID, "pid": TEST_POST2_ID},
        )
        await session.commit()
    return TEST_POST2_ID
```

Run (the Task 1 migration must already be applied):

```bash
docker compose exec -T backend pytest tests/contract/test_posts.py -q
```

Expected: all pass — nothing uses the new fixtures yet and the seed change only adds `read_progress` and loosens the conflict target.

- [ ] **Step 2: Write the failing contract tests**

In `backend/tests/contract/test_posts.py`:

**(a)** In `TestListPosts`, insert these three tests directly before `test_list_posts_pagination_with_limit` (before the `@pytest.mark.asyncio` line that precedes `async def test_list_posts_pagination_with_limit(self, client, auth_headers):`):

```python
    @pytest.mark.asyncio
    async def test_list_posts_expose_reading_state(self, client, auth_headers, feed_id):
        """Each post summary exposes the reading progress and whether it was opened."""
        response = await client.get(f"/api/posts?feedId={feed_id}", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert data["posts"]
        for post in data["posts"]:
            assert isinstance(post["isSeen"], bool)
            assert 0 <= post["readProgress"] <= 1

    @pytest.mark.asyncio
    async def test_list_posts_filter_by_in_progress(
        self, client, auth_headers, feed_id, fresh_unread_post_id
    ):
        """Should list only posts that were started but not finished."""
        started = await client.put(
            f"/api/posts/{fresh_unread_post_id}/progress",
            headers=auth_headers,
            json={"progress": 0.4},
        )
        assert started.status_code == 200

        response = await client.get(
            f"/api/posts?readState=in_progress&feedId={feed_id}", headers=auth_headers
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert str(fresh_unread_post_id) in [post["id"] for post in data["posts"]]
        for post in data["posts"]:
            assert post["isRead"] is False
            assert post["readProgress"] > 0

    @pytest.mark.asyncio
    async def test_list_posts_rejects_an_unknown_read_state(self, client, auth_headers):
        """Should reject a readState outside all|unread|in_progress|read."""
        response = await client.get("/api/posts?readState=started", headers=auth_headers)

        assert response.status_code == 400
```

**(b)** In `TestGetPostDetail`, replace the whole old test

```python
    @pytest.mark.asyncio
    async def test_get_post_auto_marks_as_read(self, client, auth_headers, unread_post_id):
        """Should auto-mark post as read when viewing."""
        # First, verify post is unread
        list_response = await client.get("/api/posts?readState=unread", headers=auth_headers)
        list_data = await list_response.get_json()
        unread_ids = [p["id"] for p in list_data["posts"]]

        # View the post
        response = await client.get(f"/api/posts/{unread_post_id}", headers=auth_headers)
        assert response.status_code == 200

        # Verify it's now marked as read
        data = await response.get_json()
        assert data["isRead"] is True
```

with these three tests (opening no longer marks a post read; that is the point of this feature):

```python
    @pytest.mark.asyncio
    async def test_get_post_records_open_without_marking_read(
        self, client, auth_headers, fresh_unread_post_id
    ):
        """Opening a post records that it was seen but does not mark it read."""
        response = await client.get(f"/api/posts/{fresh_unread_post_id}", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert data["isRead"] is False
        assert data["isSeen"] is True
        assert data["readProgress"] == 0

    @pytest.mark.asyncio
    async def test_opened_post_stays_in_the_unread_list(
        self, client, auth_headers, feed_id, fresh_unread_post_id
    ):
        """An opened post still counts as unread: it stays in the Unread filter."""
        opened = await client.get(f"/api/posts/{fresh_unread_post_id}", headers=auth_headers)
        assert opened.status_code == 200

        response = await client.get(
            f"/api/posts?readState=unread&feedId={feed_id}", headers=auth_headers
        )

        assert response.status_code == 200
        data = await response.get_json()
        listed = [post for post in data["posts"] if post["id"] == str(fresh_unread_post_id)]
        assert len(listed) == 1
        assert listed[0]["isRead"] is False
        assert listed[0]["isSeen"] is True

    @pytest.mark.asyncio
    async def test_get_post_keeps_a_read_post_read(self, client, auth_headers, fresh_read_post_id):
        """Opening an already-read post leaves it read with full progress."""
        response = await client.get(f"/api/posts/{fresh_read_post_id}", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert data["isRead"] is True
        assert data["readProgress"] == 1
        assert data["isSeen"] is True
```

**(c)** Insert a new class between `TestUpdateReadState` and `TestUnreadCounts`: replace

```python
class TestUnreadCounts:
    """Tests for GET /api/posts/unread-counts endpoint."""
```

with

```python
class TestUpdateProgress:
    """Tests for PUT /api/posts/{postId}/progress endpoint."""

    @pytest.mark.asyncio
    async def test_records_the_reading_progress(self, client, auth_headers, fresh_unread_post_id):
        """Should store the progress and leave the post unread below the threshold."""
        response = await client.put(
            f"/api/posts/{fresh_unread_post_id}/progress",
            headers=auth_headers,
            json={"progress": 0.4},
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert data == {
            "postId": str(fresh_unread_post_id),
            "isRead": False,
            "readProgress": 0.4,
            "readAt": None,
        }

    @pytest.mark.asyncio
    async def test_progress_never_moves_backwards(
        self, client, auth_headers, fresh_unread_post_id
    ):
        """Should keep the furthest position when a smaller one arrives later."""
        url = f"/api/posts/{fresh_unread_post_id}/progress"
        first = await client.put(url, headers=auth_headers, json={"progress": 0.6})
        assert first.status_code == 200

        response = await client.put(url, headers=auth_headers, json={"progress": 0.2})

        assert response.status_code == 200
        data = await response.get_json()
        assert data["readProgress"] == 0.6
        assert data["isRead"] is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize("progress", [0.95, 1], ids=["threshold", "integer-one"])
    async def test_reaching_the_end_marks_the_post_read(
        self, client, auth_headers, fresh_unread_post_id, progress
    ):
        """Should mark the post read at the completion threshold; JSON integers are accepted."""
        response = await client.put(
            f"/api/posts/{fresh_unread_post_id}/progress",
            headers=auth_headers,
            json={"progress": progress},
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert data["isRead"] is True
        assert data["readProgress"] == 1
        assert data["readAt"] is not None

    @pytest.mark.asyncio
    async def test_a_read_post_stays_read(self, client, auth_headers, fresh_read_post_id):
        """Should not let a later, smaller position undo a finished article."""
        response = await client.put(
            f"/api/posts/{fresh_read_post_id}/progress",
            headers=auth_headers,
            json={"progress": 0.1},
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert data["isRead"] is True
        assert data["readProgress"] == 1

    @pytest.mark.asyncio
    async def test_marking_unread_resets_the_progress(
        self, client, auth_headers, fresh_read_post_id
    ):
        """Should start again from zero once the post is explicitly marked unread."""
        unread = await client.put(
            f"/api/posts/{fresh_read_post_id}/read-state",
            headers=auth_headers,
            json={"isRead": False},
        )
        assert unread.status_code == 200

        response = await client.put(
            f"/api/posts/{fresh_read_post_id}/progress",
            headers=auth_headers,
            json={"progress": 0.1},
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert data["isRead"] is False
        assert data["readProgress"] == pytest.approx(0.1)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "body",
        [
            pytest.param({}, id="empty-body"),
            pytest.param({"progress": None}, id="null"),
            pytest.param({"progress": True}, id="boolean"),
            pytest.param({"progress": "0.5"}, id="string"),
            pytest.param({"progress": [0.5]}, id="list"),
            pytest.param({"progress": -0.1}, id="negative"),
            pytest.param({"progress": 1.1}, id="above-one"),
            pytest.param({"progress": 2}, id="integer-above-one"),
        ],
    )
    async def test_rejects_an_invalid_progress(self, client, fresh_auth_headers, body):
        """Should answer 400 VALIDATION_ERROR before it looks the post up."""
        response = await client.put(
            f"/api/posts/{uuid4()}/progress", headers=fresh_auth_headers, json=body
        )

        assert response.status_code == 400
        data = await response.get_json()
        assert data["error"]["code"] == "VALIDATION_ERROR"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity", "1e999"])
    async def test_rejects_a_non_finite_progress(self, client, fresh_auth_headers, literal):
        """Should reject values Python's JSON parser accepts but that are not positions."""
        response = await client.put(
            f"/api/posts/{uuid4()}/progress",
            headers={**fresh_auth_headers, "Content-Type": "application/json"},
            data=f'{{"progress": {literal}}}',
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_unknown_post_returns_404(self, client, fresh_auth_headers):
        """Should answer 404 for a post that does not exist."""
        response = await client.put(
            f"/api/posts/{uuid4()}/progress",
            headers=fresh_auth_headers,
            json={"progress": 0.5},
        )

        assert response.status_code == 404
        data = await response.get_json()
        assert data["error"] == "not_found"

    @pytest.mark.asyncio
    async def test_a_post_the_user_cannot_access_returns_404(
        self, client, fresh_auth_headers, other_user_post_id
    ):
        """Should answer 404 for a post in a feed the user does not own."""
        response = await client.put(
            f"/api/posts/{other_user_post_id}/progress",
            headers=fresh_auth_headers,
            json={"progress": 0.5},
        )

        assert response.status_code == 404
        data = await response.get_json()
        assert data["error"] == "not_found"

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client, post_id):
        """Should return 401 when not authenticated."""
        response = await client.put(
            f"/api/posts/{post_id}/progress",
            headers={"X-Requested-With": "XMLHttpRequest"},
            json={"progress": 0.5},
        )

        assert response.status_code == 401


class TestUnreadCounts:
    """Tests for GET /api/posts/unread-counts endpoint."""
```

- [ ] **Step 3: Run the tests and confirm they fail for the right reason**

```bash
docker compose exec -T backend pytest tests/contract/test_posts.py -q
```

Expected: **25 failures** — `test_list_posts_filter_by_in_progress` (the PUT answers 404, the route does not exist), the three new `TestGetPostDetail` tests (`GET` still marks the post read and does not record the open), and all 21 `TestUpdateProgress` cases (no route, so 404 instead of 200 / 400 / 401, and the 404 body is the global handler's, not `"not_found"`). Everything else passes, including `test_list_posts_expose_reading_state` and `test_list_posts_rejects_an_unknown_read_state`, which lock in behaviour that already holds (the list contract was wired in Tasks 2 and 4).

- [ ] **Step 4: Implement the route changes**

All edits are in `backend/app/api/routes/posts.py`; no import changes are needed.

**(a)** In the `list_posts` docstring, replace

```python
        readState: Filter by read state (all|unread|read, default: all)
```

with

```python
        readState: Filter by read state (all|unread|in_progress|read, default: all)
```

**(b)** Replace

```python
    if read_state not in ("all", "unread", "read"):
        raise ValidationError("readState must be one of: all, unread, read")
```

with

```python
    if read_state not in ("all", "unread", "in_progress", "read"):
        raise ValidationError("readState must be one of: all, unread, in_progress, read")
```

**(c)** In the `get_post` route, replace

```python
    GET /api/posts/{postId}

    Auto-marks the post as read.

    Returns:
        PostDetail with full content
    """
    user_id = await get_current_user_id()
    container = get_request_container()

    try:
        # Get post
        post = await container.post_service.get_post(user_id, post_id)

        # Auto-mark as read
        await container.post_service.auto_mark_read(user_id, post_id)
        post.is_read = True

        return jsonify(post.to_detail_dict())
```

with

```python
    GET /api/posts/{postId}

    Records that the user opened the post. It stays unread until the user reads
    it (see PUT /api/posts/{postId}/progress) or marks it read.

    Returns:
        PostDetail with full content and the user's reading state
    """
    user_id = await get_current_user_id()
    container = get_request_container()

    try:
        post = await container.post_service.open_post(user_id, post_id)

        return jsonify(post.to_detail_dict())
```

(the two `except` clauses below it stay as they are).

**(d)** Append this route at the end of the file, after `update_read_state`:

```python


@bp.route("/<uuid:post_id>/progress", methods=["PUT"])
async def update_progress(post_id: UUID):
    """Record how far the user has read a post.

    PUT /api/posts/{postId}/progress
    Body: { "progress": 0.0-1.0 }

    Progress only moves forward, and reaching the end (95% or more) marks the
    post read. Use PUT /api/posts/{postId}/read-state to start over.

    Returns:
        { postId, isRead, readProgress, readAt }
    """
    user_id = await get_current_user_id()
    container = get_request_container()

    data = await request.get_json()
    if not isinstance(data, dict) or not data:
        raise ValidationError("Request body is required")

    progress = data.get("progress")
    if progress is None:
        raise ValidationError("progress is required")
    if isinstance(progress, bool) or not isinstance(progress, (int, float)):
        raise ValidationError("progress must be a number")
    # NaN and the infinities, which Python's JSON parser accepts, fail both comparisons.
    if not 0 <= progress <= 1:
        raise ValidationError("progress must be between 0 and 1")

    try:
        is_read, read_progress, read_at = await container.post_service.record_progress(
            user_id, post_id, float(progress)
        )
    except (PostNotFoundError, PostPermissionError):
        return jsonify({"error": "not_found", "message": "Post not found"}), 404

    return jsonify(
        {
            "postId": str(post_id),
            "isRead": is_read,
            "readProgress": read_progress,
            "readAt": read_at.isoformat() if read_at else None,
        }
    )
```

Validation runs before the post lookup, so malformed requests never touch the database. A JSON `1` (an integer, which is what the frontend sends at completion) is accepted.

- [ ] **Step 5: Remove `auto_mark_read`**

Nothing calls it any more. In `backend/app/application/services/post_service.py`, delete this whole method (and the blank line after it):

```python
    async def auto_mark_read(self, user_id: UUID, post_id: UUID) -> None:
        """Auto-mark a post as read when viewing.

        Args:
            user_id: User UUID
            post_id: Post UUID
        """
        # Only mark if not already read
        is_read, _ = await self._post_repository.get_read_state(user_id, post_id)
        if not is_read:
            await self._post_repository.mark_as_read(user_id, post_id, True)

```

In `backend/tests/unit/test_post_service.py`, delete these two tests from `TestPostServiceReadState` (they sit directly before `class TestPostServiceUnreadCounts:`; keep the two blank lines that precede that class):

```python
    @pytest.mark.asyncio
    async def test_auto_mark_read_only_marks_unread_posts(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should only mark as read if post is currently unread."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        post_id = uuid4()

        # Post is already read
        mock_post_repository.get_read_state.return_value = (True, datetime.now(timezone.utc))

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.auto_mark_read(user_id, post_id)

        # Should NOT call mark_as_read since already read
        mock_post_repository.mark_as_read.assert_not_called()

    @pytest.mark.asyncio
    async def test_auto_mark_read_marks_unread_post(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should mark as read if post is currently unread."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        post_id = uuid4()

        # Post is unread
        mock_post_repository.get_read_state.return_value = (False, None)

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.auto_mark_read(user_id, post_id)

        # Should call mark_as_read
        mock_post_repository.mark_as_read.assert_called_once_with(user_id, post_id, True)
```

The `datetime` / `timezone` imports in that file stay: other tests still use them.

- [ ] **Step 6: Run the tests green**

```bash
docker compose exec -T backend pytest tests/contract/test_posts.py tests/unit tests/integration/test_post_reading_progress.py -q
docker compose exec -T backend pytest tests/contract -q
git grep -n "auto_mark_read" -- backend
```

Expected: every test passes, including the whole contract folder (this also proves the new mutations stay under the admission limit), and the `git grep` prints nothing.

- [ ] **Step 7: Commit (only if the user asked for commits)**

```bash
git add backend/app/api/routes/posts.py backend/app/application/services/post_service.py backend/tests/contract/conftest.py backend/tests/contract/test_posts.py backend/tests/unit/test_post_service.py
git commit -m "feat(api): open a post without marking it read; add PUT /posts/{id}/progress" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 7: Backend quality gates — suite, CRAP and mutation testing

**Files:**
- Modify only if a surviving mutant calls for it: `backend/tests/unit/test_post_service.py`, `backend/tests/unit/test_user_post_state.py`, `backend/tests/unit/test_post.py`.

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a verified backend plus the CRAP and mutation evidence to quote in the final report.

- [ ] **Step 1: Run the whole backend suite, the migration test and the revision check**

```bash
docker compose exec -T backend pytest -q
docker compose run --rm --no-deps --entrypoint "" migrate python -m pytest -p no:cacheprovider tests/integration/test_reading_progress_migration.py -q
docker compose run --rm --no-deps --entrypoint "" migrate alembic heads
```

Expected: everything passes. The migration test is skipped in the first command (the `backend` container has no `MIGRATION_DATABASE_URL`) and runs in the second. `alembic heads` prints the single head `b8e4a1c7d903 (head)`. Keep the pass / skip counts for the report.

- [ ] **Step 2: Run the CRAP report**

Use the `python-crap` skill. The whole suite is the right scope: the repository and route code is covered by the integration and contract tests, not by `tests/unit`.

```bash
docker compose exec -T backend pytest -q --crap
```

Expected: the suite passes and pytest-crap prints its function, file and folder tables (threshold 30, top 20). Read the rows for the code this plan added or changed: `PostService.open_post` / `record_progress`, `UserPostState`, `Post.to_summary_dict`, the repository's `record_opened` / `record_progress` / `get_user_post_state` / `get_posts_for_user`, and `update_progress` / `get_post` / `list_posts` in `routes/posts.py`. If one of them scores 30 or more, add tests for its uncovered branches (or simplify it) and re-run. CRAP is advisory, so risky functions this plan did not touch are reported, not fixed. Keep the command, the counts and the top functions (score, complexity, coverage) for the report.

- [ ] **Step 3: Establish the mutation baseline**

```bash
docker compose exec -T backend pytest tests/unit -q
```

Expected: pass. mutmut only runs `tests/unit/` (`[tool.mutmut]` in `backend/pyproject.toml`), so it can only kill service and entity mutants; the SQL and the routes are protected by the integration and contract tests and are outside mutmut's reach by configuration.

- [ ] **Step 4: Run mutmut on the changed service and entities**

Use the `python-mutmut` skill. mutmut needs `fork`, so it runs in the Linux container. Never use `mutmut browse` or `mutmut apply`.

```bash
docker compose exec -T backend mutmut run "app.application.services.post_service.*" "app.domain.feed_management.entities.user_post_state.*" "app.domain.feed_management.entities.post.*"
docker compose exec -T backend mutmut results
```

Expected: the run completes (it is resumable if interrupted) and `results` lists any surviving, suspicious or timed-out mutants. `backend/mutants/` is git-ignored.

- [ ] **Step 5: Kill the meaningful survivors**

For each mutant `results` lists, inspect it with `docker compose exec -T backend mutmut show <mutant-name>`, then decide:

- It changes observable behaviour (a comparison operator, a boundary such as `>=` → `>` at the 0.95 threshold, a swapped or dropped argument, a dropped repository call): add the smallest unit test that fails against it. Threshold and call-argument mutants belong in `TestPostServiceReadingProgress` (`test_post_service.py`), value-object mutants in `test_user_post_state.py`, JSON-key mutants in `test_post.py`. Confirm it is now killed with `docker compose exec -T backend mutmut run <mutant-name>`.
- It changes nothing observable (exception message text, an equivalent rewrite): leave it and list it in the report as an equivalent mutant with a one-line reason.
- Suspicious or timed-out mutants must be investigated and are never counted as killed.

Expected: no unexplained survivors in the three globs, and `docker compose exec -T backend pytest tests/unit -q` is still green.

- [ ] **Step 6: Lint and format the touched Python**

```bash
docker compose exec -T backend ruff check migrations/versions/20261102_1200_b8e4a1c7d903_reading_progress.py app/domain/feed_management/entities/user_post_state.py tests/unit/test_user_post_state.py tests/integration/test_reading_progress_migration.py tests/integration/test_post_reading_progress.py
docker compose exec -T backend ruff format --check migrations/versions/20261102_1200_b8e4a1c7d903_reading_progress.py app/domain/feed_management/entities/user_post_state.py tests/unit/test_user_post_state.py tests/integration/test_reading_progress_migration.py tests/integration/test_post_reading_progress.py
docker compose exec -T backend ruff check app/api/routes/posts.py app/application/services/post_service.py app/domain/feed_management app/infrastructure/persistence tests/unit/test_post.py tests/unit/test_post_service.py tests/contract/conftest.py tests/contract/test_posts.py
```

Expected: the files this plan created are clean. For the modified files, fix only the findings on lines this plan added or changed; leave pre-existing findings alone.

- [ ] **Step 7: Commit (only if the user asked for commits, and only if Step 5 or 6 changed a file)**

```bash
git add backend/tests/unit
git commit -m "test(backend): kill surviving reading-progress mutants" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

# Part B — Frontend

Every command below runs in the `frontend` container, whose working directory is the repository's `frontend/` folder, so test paths in commands start with `src/`. Vitest does not type-check, so each task ends with `pnpm exec tsc -b`. Each red step quotes the failure to expect: if a red step does not fail that way, stop and find out why before writing any production code.

## Task 8: Reading state in the list — types, `usePostsData`, In-progress filter, `PostCard` progress

**Files:**
- Create: `frontend/src/utils/readingProgress.ts`
- Create: `frontend/src/utils/__tests__/readingProgress.test.ts`
- Create: `frontend/src/components/__tests__/PostCard.test.tsx`
- Create: `frontend/src/components/__tests__/FeedSidebar.test.tsx`
- Modify (4-space files): `frontend/src/types/index.ts`, `frontend/src/hooks/usePostsData.ts`, `frontend/src/hooks/__tests__/usePostsData.test.tsx`
- Modify: `frontend/src/components/PostCard.tsx`, `frontend/src/components/FeedSidebar.tsx`, `frontend/src/components/PostList.tsx`, `frontend/src/components/__tests__/PostList.test.tsx`, `frontend/src/pages/posts/ReaderPage.tsx`

**Interfaces:**
- Consumes: the API from Tasks 4-6 (`readProgress` and `isSeen` on every post; `readState=in_progress`).
- Produces: `wholePercent(progress): number` and `displayPercent(progress): number` (reused by Tasks 14, 16 and 17); `PostSummary` and `Post` gain `readProgress: number` and `isSeen: boolean`; `ReadState = "all" | "unread" | "in_progress" | "read"`; `parseReadState(value: string | null): ReadState`, exported from `hooks/usePostsData.ts` (not from a component file, because oxlint's `react/only-export-components` rule warns on that); `usePostsData(initialCategoryId?, initialFeedId?, initialReadState: ReadState = "all")` starts on the read state it is given, so a `?read=` deep link loads once, already filtered (see the "Why" after Step 4); `PostList` takes an optional `readState?: ReadState` that only changes its empty-state wording.

- [ ] **Step 1: Red — the percentage helper**

Create `frontend/src/utils/__tests__/readingProgress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { displayPercent, wholePercent } from "../readingProgress";

describe("wholePercent", () => {
  it.each([
    [0, 0],
    [0.004, 0],
    [0.42, 42],
    [0.949, 94],
    [1, 100],
  ])("floors %f to %i", (progress, expected) => {
    expect(wholePercent(progress)).toBe(expected);
  });

  it("is not thrown off by floating point noise", () => {
    expect(wholePercent(0.29)).toBe(29);
    expect(wholePercent(0.57)).toBe(57);
  });

  it("clamps to 0..100 and treats NaN as 0", () => {
    expect(wholePercent(-0.5)).toBe(0);
    expect(wholePercent(1.5)).toBe(100);
    expect(wholePercent(Number.NaN)).toBe(0);
  });
});

describe("displayPercent", () => {
  it("never shows 0% for an article that has been started", () => {
    expect(displayPercent(0.004)).toBe(1);
  });

  it("matches wholePercent from 1% upwards", () => {
    expect(displayPercent(0.42)).toBe(42);
    expect(displayPercent(0.949)).toBe(94);
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/utils/__tests__/readingProgress.test.ts
```

Expected: FAIL — `Failed to resolve import "../readingProgress" from "src/utils/__tests__/readingProgress.test.ts". Does the file exist?`

- [ ] **Step 2: Green — the percentage helper**

Create `frontend/src/utils/readingProgress.ts`:

```ts
/**
 * The one definition of "how many percent" for reading progress. The UI shows
 * it and the tracker throttles on it, so they can never disagree.
 */

/** Whole percent, 0..100, rounded down. The epsilon absorbs float noise such as 0.29 * 100. */
export function wholePercent(progress: number): number {
  if (Number.isNaN(progress)) return 0;
  return Math.min(100, Math.max(0, Math.floor(progress * 100 + 1e-9)));
}

/** What the UI prints for a started article: never "0%". */
export function displayPercent(progress: number): number {
  return Math.max(1, wholePercent(progress));
}
```

Run the Step 1 command again. Expected: PASS, 9 tests.

- [ ] **Step 3: Red — `parseReadState`, the initial read state, and `markAsRead` keeps `readProgress` in step**

`frontend/src/hooks/__tests__/usePostsData.test.tsx` is a 4-space file; it already imports `describe, it, expect, vi, beforeEach`, `renderHook, act, waitFor`, mocks `../../services/api`, and has a `response(posts)` helper. Make these edits.

Replace the import of the hook (line 30):

```tsx
import { usePostsData, type PostSummary } from "../usePostsData";
```

with:

```tsx
import { usePostsData, parseReadState, type PostSummary } from "../usePostsData";
```

Replace the `makePost` signature:

```tsx
function makePost(id: string): PostSummary {
```

with:

```tsx
function makePost(id: string, overrides: Partial<PostSummary> = {}): PostSummary {
```

and, at the end of the object `makePost` returns, replace:

```tsx
        isRead: false,
        hasAudio: false,
        hasContent: true,
    };
}
```

with:

```tsx
        isRead: false,
        readProgress: 0,
        isSeen: false,
        hasAudio: false,
        hasContent: true,
        ...overrides,
    };
}
```

Append to the end of the file:

```tsx

describe("parseReadState", () => {
    it.each(["all", "unread", "in_progress", "read"] as const)("keeps %s", (value) => {
        expect(parseReadState(value)).toBe(value);
    });

    it.each([null, "", "started", "IN_PROGRESS", "in-progress"])(
        "falls back to all for %j",
        (value) => {
            expect(parseReadState(value)).toBe("all");
        }
    );
});

describe("usePostsData initial read state", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("loads the list once, already filtered by the read state it starts on", async () => {
        vi.mocked(api.get).mockResolvedValue(response([makePost("a", { readProgress: 0.4 })]));

        const { result } = renderHook(() => usePostsData(undefined, undefined, "in_progress"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.readState).toBe("in_progress");
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining("readState=in_progress"));
    });

    it("starts on all, with no read state in the request, when none is given", async () => {
        vi.mocked(api.get).mockResolvedValue(response([makePost("a")]));

        const { result } = renderHook(() => usePostsData());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.readState).toBe("all");
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(vi.mocked(api.get).mock.calls[0][0]).not.toContain("readState");
    });
});

describe("usePostsData reading progress", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("marking a post read moves its progress to 1", async () => {
        vi.mocked(api.get).mockResolvedValue(
            response([makePost("a", { readProgress: 0.4, isSeen: true })])
        );
        vi.mocked(api.put).mockResolvedValue({});

        const { result } = renderHook(() => usePostsData());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.markAsRead("a", true);
        });

        expect(api.put).toHaveBeenCalledWith("/posts/a/read-state", { isRead: true });
        expect(result.current.posts[0]).toMatchObject({ isRead: true, readProgress: 1 });
    });

    it("marking a post unread resets its progress to 0", async () => {
        vi.mocked(api.get).mockResolvedValue(
            response([makePost("a", { isRead: true, readProgress: 1, isSeen: true })])
        );
        vi.mocked(api.put).mockResolvedValue({});

        const { result } = renderHook(() => usePostsData());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.markAsRead("a", false);
        });

        expect(result.current.posts[0]).toMatchObject({ isRead: false, readProgress: 0 });
    });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/usePostsData.test.tsx
```

Expected: FAIL — 12 failures; the other 4 tests pass (the 3 existing ones and `starts on all, with no read state in the request, when none is given`, which pins behaviour that must not change). The failures are 9 × `TypeError: parseReadState is not a function` (4 `keeps …`, 5 `falls back …`), the 2 `markAsRead` tests with an `AssertionError` about `readProgress` (the optimistic update only flips `isRead` today), and `loads the list once, already filtered by the read state it starts on` with `AssertionError: expected 'all' to be 'in_progress'` (the hook ignores a third argument and always starts on `all`).

- [ ] **Step 4: Green — the types, `ReadState`, `parseReadState`, the initial read state and the optimistic update**

In `frontend/src/types/index.ts` (4-space), inside `interface Post`, replace:

```ts
    isRead: boolean;
    hasAudio: boolean;
```

with:

```ts
    isRead: boolean;
    readProgress: number;
    isSeen: boolean;
    hasAudio: boolean;
```

In `frontend/src/hooks/usePostsData.ts` (4-space) make five edits.

1. Inside `interface PostSummary`, replace:

```ts
    isRead: boolean;
    hasAudio: boolean;
```

with:

```ts
    isRead: boolean;
    // How far the user got, 0..1 (1 once read). Opening a post does not move it.
    readProgress: number;
    // True once the user has opened the post, even if they never read it.
    isSeen: boolean;
    hasAudio: boolean;
```

2. Replace:

```ts
export type ReadState = "all" | "unread" | "read";
```

with:

```ts
export type ReadState = "all" | "unread" | "in_progress" | "read";

const READ_STATES: readonly ReadState[] = ["all", "unread", "in_progress", "read"];

/** Parses the `?read=` URL parameter; anything unrecognised means "all". */
export function parseReadState(value: string | null): ReadState {
    return READ_STATES.find((state) => state === value) ?? "all";
}
```

3. In `markAsRead`'s optimistic update, replace:

```ts
                        post.id === postId ? { ...post, isRead } : post
```

with:

```ts
                        post.id === postId
                            ? { ...post, isRead, readProgress: isRead ? 1 : 0 }
                            : post
```

4. Start on the read state the caller gives it, the way the category and the feed already are. Replace:

```ts
    initialFeedId?: string
): UsePostsDataReturn {
```

with:

```ts
    initialFeedId?: string,
    initialReadState: ReadState = "all"
): UsePostsDataReturn {
```

5. In the hook's initial state, replace:

```ts
        readState: "all",
```

with:

```ts
        readState: initialReadState,
```

`markAllRead` already refreshes the list from the server afterwards, so it needs no change. Run the Step 3 command. Expected: PASS, 16 tests (3 existing + 9 `parseReadState` + 2 initial read state + 2 reading-progress).

Why the hook takes the read state as a third argument:

- `ReaderPage` used to apply `?read=` after the first render, through `setFilters` in an effect. By then the hook's mount effect had already started its first request on `all`, and `refresh()` returns early while a request is in flight, so the filtered refetch was dropped and the unfiltered list won.
- That is a bug in the code today: a `?read=unread` deep link, a reload and the browser's Back button all show the whole list under a filter button that says otherwise. It was easy to miss while Unread was the only filter. The In progress list is unusable without the fix: open it, open an article, press Back, and the list is unfiltered again.
- Seeding the state is how the category and the feed are already handled, so the first request is the right one and `setFilters` then changes nothing. The first new test pins exactly one request, so a design that fetches `all` first and the filtered list second cannot pass.
- A filter button pressed while the very first load is still in flight is dropped by the same guard. That is out of scope here and no worse than before.

`pnpm exec tsc -b` now reports exactly one error, in `PostList.test.tsx`: its `makePost` lacks the new required `readProgress` and `isSeen`. Step 9 fixes that, so do not treat it as a failure yet.

- [ ] **Step 5: Red — `PostCard` says Opened and shows progress**

Create `frontend/src/components/__tests__/PostCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostCard } from "../PostCard";
import type { PostSummary } from "../../hooks/usePostsData";

function makePost(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    id: "post-1",
    feedId: "feed-1",
    feedTitle: "Test Feed",
    feedIconUrl: null,
    title: "Test Post Title",
    summary: "A short summary",
    author: "Author Name",
    link: "https://example.com/1",
    publishedAt: "2026-02-13T12:00:00Z",
    isRead: false,
    readProgress: 0,
    isSeen: false,
    hasAudio: false,
    hasContent: true,
    ...overrides,
  };
}

describe("PostCard reading state", () => {
  it("shows no reading hints for an article that was never opened", () => {
    render(<PostCard post={makePost()} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Opened")).not.toBeInTheDocument();
  });

  it("says Opened when the article was opened but not read", () => {
    render(<PostCard post={makePost({ isSeen: true })} />);

    expect(screen.getByText("Opened")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows a progress bar and percent for an article in progress", () => {
    render(<PostCard post={makePost({ isSeen: true, readProgress: 0.42 })} />);

    const bar = screen.getByRole("progressbar", { name: "Reading progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.queryByText("Opened")).not.toBeInTheDocument();
  });

  it("never shows 0% for a started article", () => {
    render(<PostCard post={makePost({ isSeen: true, readProgress: 0.004 })} />);

    expect(screen.getByText("1%")).toBeInTheDocument();
  });

  it("shows nothing extra once the article is read", () => {
    render(<PostCard post={makePost({ isRead: true, readProgress: 1, isSeen: true })} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Opened")).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/PostCard.test.tsx
```

Expected: FAIL — 3 failures (`Opened` not found, no `progressbar`, `1%` not found). The two "nothing extra" tests already pass; they guard against over-showing.

- [ ] **Step 6: Green — `PostCard`**

In `frontend/src/components/PostCard.tsx` (2-space) make five edits.

1. In the MUI import, add `LinearProgress` between `Chip` and `Tooltip`:

```tsx
  Chip,
  LinearProgress,
  Tooltip,
```

2. After the `usePublisherImages` import add:

```tsx
import { displayPercent } from "../utils/readingProgress";
```

3. After the `handleClick` callback (`}, [post, onClick]);`) and before `return (` add:

```tsx
  const inProgress = !post.isRead && post.readProgress > 0;
  const opened = !post.isRead && post.isSeen && post.readProgress === 0;
  const percent = displayPercent(post.readProgress);
```

4. In the footer, the left-hand `Box` (the one that holds the Audio `Chip`) becomes `alignItems: "center"` and gains two captions after the Audio `Chip`. Replace its opening line:

```tsx
            <Box sx={{ display: "flex", gap: 0.5 }}>
              {post.hasContent && post.hasAudio && (
```

with:

```tsx
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {post.hasContent && post.hasAudio && (
```

and directly after that `Box`'s Audio-chip block (`)}`), before its closing `</Box>`, add:

```tsx
              {inProgress && (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {`${percent}%`}
                </Typography>
              )}
              {opened && (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  Opened
                </Typography>
              )}
```

5. Directly after `</CardActionArea>` (and before `</Card>`) add the thin bar:

```tsx
      {inProgress && (
        <LinearProgress
          variant="determinate"
          value={percent}
          aria-label="Reading progress"
          sx={{ height: 3 }}
        />
      )}
```

Run the Step 5 command. Expected: PASS, 5 tests.

- [ ] **Step 7: Red — the In progress filter button**

Create `frontend/src/components/__tests__/FeedSidebar.test.tsx`:

```tsx
import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedSidebar } from "../FeedSidebar";

type SidebarProps = ComponentProps<typeof FeedSidebar>;

function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    categories: [],
    feedsByCategory: {},
    loadingFeeds: new Set<string>(),
    onExpandCategory: vi.fn(),
    loading: false,
    error: null,
    selectedCategoryId: null,
    activeFeedId: null,
    readState: "all",
    uncategorizedActive: false,
    totalUnread: 0,
    unreadByFeed: {},
    unreadByCategory: {},
    uncategorizedUnread: 0,
    onSelectAll: vi.fn(),
    onSelectCategory: vi.fn(),
    onSelectFeed: vi.fn(),
    onSelectUncategorized: vi.fn(),
    onReadStateChange: vi.fn(),
    onMarkCategoryRead: vi.fn(),
    onMarkUncategorizedRead: vi.fn(),
    onMarkFeedRead: vi.fn(),
    onCreateCategory: vi.fn(),
    onUpdateCategory: vi.fn(),
    onDeleteCategory: vi.fn(),
    onAddFeed: vi.fn(),
    onDeleteFeed: vi.fn(),
    onRefreshFeed: vi.fn(),
    onSetFeedCategories: vi.fn(),
    onSetFeedActive: vi.fn(),
    ...overrides,
  };
  render(<FeedSidebar {...props} />);
  return props;
}

describe("FeedSidebar read-state filter", () => {
  it("offers All, Unread, In progress and Read, in that order", () => {
    renderSidebar();

    const group = screen.getByRole("group", { name: "read state filter" });
    const labels = within(group)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels).toEqual(["All", "Unread", "In progress", "Read"]);
  });

  it("marks the active filter as pressed", () => {
    renderSidebar({ readState: "in_progress" });

    const group = screen.getByRole("group", { name: "read state filter" });
    expect(within(group).getByRole("button", { name: "In progress" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(group).getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("reports the chosen filter", async () => {
    const props = renderSidebar();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "In progress" }));

    expect(props.onReadStateChange).toHaveBeenCalledWith("in_progress");
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/FeedSidebar.test.tsx
```

Expected: FAIL — all 3 tests (the labels come back as `["All", "Unread", "Read"]`, and no `In progress` button exists).

- [ ] **Step 8: Green — `FeedSidebar`**

In `frontend/src/components/FeedSidebar.tsx` (2-space), the read-state `ToggleButtonGroup` loses `fullWidth` (four buttons of different widths must not wrap, so they size to their content and share the row) and gains the new button. Replace:

```tsx
          size="small"
          fullWidth
          onChange={(_e, value: ReadState | null) => value && onReadStateChange(value)}
          aria-label="read state filter"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="unread">Unread</ToggleButton>
          <ToggleButton value="read">Read</ToggleButton>
```

with:

```tsx
          size="small"
          onChange={(_e, value: ReadState | null) => value && onReadStateChange(value)}
          aria-label="read state filter"
          sx={{
            display: "flex",
            "& .MuiToggleButton-root": { flex: "1 1 auto", px: 1, whiteSpace: "nowrap" },
          }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="unread">Unread</ToggleButton>
          <ToggleButton value="in_progress">In progress</ToggleButton>
          <ToggleButton value="read">Read</ToggleButton>
```

Run the Step 7 command. Expected: PASS, 3 tests. jsdom cannot measure layout, so "the four buttons stay on one line inside the sidebar" is asserted in the Playwright spec in Task 18.

- [ ] **Step 9: Red — the In progress empty state**

In `frontend/src/components/__tests__/PostList.test.tsx` (2-space file, tests nested in `describe("rendering")`) make two edits.

In `makePost`, add the two new fields between `isRead` and `hasAudio`:

```tsx
    isRead: false,
    readProgress: 0,
    isSeen: false,
    hasAudio: false,
```

Add this test right after `it("should display empty state when no posts exist", …)` and before `it("should display posts sorted by date descending", …)`:

```tsx
    it("should explain the In progress filter when nothing is in progress", () => {
      render(
        <PostList
          posts={[]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
          readState="in_progress"
        />
      );
      expect(screen.getByText("Nothing in progress yet")).toBeInTheDocument();
      expect(screen.getByText("Start reading an article.")).toBeInTheDocument();
      expect(screen.queryByText(/no posts found/i)).not.toBeInTheDocument();
    });
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/PostList.test.tsx
```

Expected: FAIL — one failure, `Unable to find an element with the text: Nothing in progress yet`; the other 16 tests pass. (`pnpm exec tsc -b` would additionally say `Property 'readState' does not exist on type … PostListProps`.)

- [ ] **Step 10: Green — `PostList`, and `ReaderPage` passes the filter down**

In `frontend/src/components/PostList.tsx` (2-space) make five edits.

1. Replace `import type { PostSummary } from "../hooks/usePostsData";` with:

```tsx
import type { PostSummary, ReadState } from "../hooks/usePostsData";
```

2. In `interface PostListProps`, between `error: string | null;` and `onLoadMore?`, add:

```tsx
  // Only changes the empty-state wording
  readState?: ReadState;
```

3. Replace the `EmptyState` signature:

```tsx
const EmptyState: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
```

with:

```tsx
const EmptyState: React.FC<{ readState?: ReadState; onRefresh?: () => void }> = ({
  readState,
  onRefresh,
}) => (
```

4. In `EmptyState`, replace the heading text `No posts found` with:

```tsx
      {readState === "in_progress" ? "Nothing in progress yet" : "No posts found"}
```

and the body text `Try adjusting your filters or add more feeds` with:

```tsx
      {readState === "in_progress"
        ? "Start reading an article."
        : "Try adjusting your filters or add more feeds"}
```

5. Destructure the prop in `PostList` (after `error,`, before `onLoadMore,`) and pass it on. Add `readState,` to the destructured props, then replace `return <EmptyState onRefresh={onRefresh} />;` with:

```tsx
    return <EmptyState readState={readState} onRefresh={onRefresh} />;
```

In `frontend/src/pages/posts/ReaderPage.tsx` (2-space) make four edits.

1. Replace `import { usePostsData, type PostSummary, type ReadState } from "../../hooks/usePostsData";` with:

```tsx
import {
  parseReadState,
  usePostsData,
  type PostSummary,
  type ReadState,
} from "../../hooks/usePostsData";
```

2. Delete the local copy (and the blank line after it); the shared one in `usePostsData.ts` replaces it. `ReadState` stays imported because `handleReadStateChange` still uses it:

```tsx
function parseReadState(value: string | null): ReadState {
  return value === "unread" || value === "read" ? value : "all";
}
```

3. Pass the filter to the list: in the `<PostList … />` element add `readState={readState}` directly after `error={error}`.

4. Start the list on the URL's read state, so a `?read=` deep link, a reload and Back from an article load once, already filtered (see the "Why" after Step 4). `readState` is already in scope: it is derived from `searchParams` above the call. Replace:

```tsx
  } = usePostsData(categoryId ?? undefined, feedId ?? undefined);
```

with:

```tsx
  } = usePostsData(categoryId ?? undefined, feedId ?? undefined, readState);
```

Run the Step 9 command. Expected: PASS, 17 tests.

`ReaderPage` has no unit test, so edit 4 has none of its own. Two Playwright scenarios in Task 18 cover it: "the In progress filter explains when nothing was started" (a `?read=in_progress` deep link) and "the In progress filter is still applied after opening an article and coming back". Task 18 Step 3 proves that they fail without it.

- [ ] **Step 11: Verify the task**

```bash
docker compose exec -T frontend pnpm exec vitest run src/utils/__tests__/readingProgress.test.ts src/hooks/__tests__/usePostsData.test.tsx src/components/__tests__/PostCard.test.tsx src/components/__tests__/FeedSidebar.test.tsx src/components/__tests__/PostList.test.tsx
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check src/utils/readingProgress.ts src/utils/__tests__/readingProgress.test.ts src/components/__tests__/PostCard.test.tsx src/components/__tests__/FeedSidebar.test.tsx
```

Expected: 50 Vitest tests pass in 5 files (9 + 16 + 5 + 3 + 17); `tsc -b` prints nothing; `pnpm lint` reports **no new warnings** (4 already exist and are not yours: `AuthContext.tsx` and `theme.tsx` ×2 `only-export-components`, and `usePostsData.ts` `exhaustive-deps` on `refresh`); prettier reports the four new files are formatted. If prettier flags one of them, run `pnpm exec prettier --write` on that **new** file only. Never run prettier over an existing file.

- [ ] **Step 12: Commit (only if the user asked for commits)**

```bash
git add frontend/src/utils/readingProgress.ts frontend/src/utils/__tests__/readingProgress.test.ts frontend/src/types/index.ts frontend/src/hooks/usePostsData.ts frontend/src/hooks/__tests__/usePostsData.test.tsx frontend/src/components/PostCard.tsx frontend/src/components/FeedSidebar.tsx frontend/src/components/PostList.tsx frontend/src/pages/posts/ReaderPage.tsx frontend/src/components/__tests__/PostCard.test.tsx frontend/src/components/__tests__/FeedSidebar.test.tsx frontend/src/components/__tests__/PostList.test.tsx
git commit -m "feat(frontend): show reading state in the list and add the In progress filter" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 9: `api.put` can ask for `keepalive`

A progress report sent while the page is being closed is cancelled by the browser unless the request is `keepalive`. Task 14's `pagehide` flush needs that, so the API client has to be able to pass it.

**Files:**
- Create: `frontend/src/services/__tests__/api.keepalive.test.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `api.put<T>(path: string, body?: unknown, options?: { keepalive?: boolean }): Promise<T>`. With `keepalive: true` the flag is forwarded to `fetch`; without it the request carries no `keepalive` key at all.

- [ ] **Step 1: Red — `put` forwards `keepalive`**

Create `frontend/src/services/__tests__/api.keepalive.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("api.put keepalive", () => {
  it("forwards keepalive to fetch so a request can outlive the page", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await api.put("/posts/p1/progress", { progress: 0.5 }, { keepalive: true });

    expect(fetcher.mock.calls[0][1].keepalive).toBe(true);
  });

  it("leaves keepalive out of the request unless asked", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await api.put("/posts/p1/progress", { progress: 0.5 });

    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("keepalive");
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/services/__tests__/api.keepalive.test.ts
```

Expected: FAIL — the first test with `AssertionError: expected undefined to be true`. The second test already passes; it guards against sending `keepalive: undefined`. (`pnpm exec tsc -b` would also report `error TS2554: Expected 1-2 arguments, but got 3.`)

- [ ] **Step 2: Green — `request` and `put`**

In `frontend/src/services/api.ts` (2-space) make three edits.

1. In `request`'s `options` type, replace:

```ts
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
```

with:

```ts
      body?: unknown;
      headers?: Record<string, string>;
      keepalive?: boolean;
    }
  ): Promise<T> {
```

2. In the `fetch` call, replace:

```ts
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
```

with:

```ts
      body: options?.body ? JSON.stringify(options.body) : undefined,
      ...(options?.keepalive ? { keepalive: true } : {}),
    });
```

3. Replace `put`:

```ts
  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }
```

with:

```ts
  async put<T>(path: string, body?: unknown, options?: { keepalive?: boolean }): Promise<T> {
    return this.request<T>("PUT", path, { body, keepalive: options?.keepalive });
  }
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/services/__tests__/api.keepalive.test.ts src/services/__tests__/privacy.test.ts
```

Expected: PASS, 6 tests (the 2 new ones and the 4 in `privacy.test.ts`, which exercise the same `fetch` call).

- [ ] **Step 3: Verify the task**

```bash
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check src/services/__tests__/api.keepalive.test.ts
```

Expected: `tsc -b` prints nothing; `pnpm lint` reports no new warnings; prettier accepts the new test file (if it does not, run `pnpm exec prettier --write` on that new file only).

- [ ] **Step 4: Commit (only if the user asked for commits)**

```bash
git add frontend/src/services/api.ts frontend/src/services/__tests__/api.keepalive.test.ts
git commit -m "feat(frontend): let api.put ask for keepalive" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 10: Pacer foundations — `MediaClock`, `buildPacedTimings`, `PacerClock`

Silent reading needs a clock that behaves like an audio element and word timings that exist without any audio. This task builds both as plain TypeScript with no React, so everything after it (highlighting, progress tracking, the pacer hook) can treat "audio" and "silent" the same way.

**Files:**
- Create: `frontend/src/utils/mediaClock.ts`
- Create: `frontend/src/utils/pacedTimings.ts`
- Create: `frontend/src/utils/pacerClock.ts`
- Create: `frontend/src/utils/__tests__/pacedTimings.test.ts`
- Create: `frontend/src/utils/__tests__/pacerClock.test.ts`

**Interfaces:**
- Consumes: `WordTiming` (`{ text, startMs, durationMs }`) from `frontend/src/types/index.ts`.
- Produces: `MediaClockEvent` and `MediaClock` (`currentTime` in seconds, `ended`, `paused`, `addEventListener`, `removeEventListener`; an `HTMLAudioElement` satisfies it). Task 11 (`useReadAlong`) and Task 14 (`useReadingProgress`) take their clock as a `MediaClock`.
- Produces: `BASE_WPM = 250` and `buildPacedTimings(words: readonly string[], baseWpm: number): WordTiming[]`.
- Produces: `PacerClock implements MediaClock` with `setDurationMs(ms)`, `setRate(rate)`, `play()`, `pause()`, `seek(seconds)` and `dispose()`; plus `PacerScheduler` (`now`, `requestFrame`, `cancelFrame`, injectable so tests need no timers), `PACER_TIMEUPDATE_INTERVAL_MS = 250` and `PACER_MAX_FRAME_GAP_MS = 1000`. Task 13 (`usePacer`) wraps it.

These are new files with no existing indentation to follow, so they use the project's prettier style (2-space).

- [ ] **Step 1: Red — paced word timings**

Create `frontend/src/utils/__tests__/pacedTimings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BASE_WPM, buildPacedTimings } from "../pacedTimings";

const durations = (words: string[], wpm = BASE_WPM) =>
  buildPacedTimings(words, wpm).map((timing) => timing.durationMs);

describe("buildPacedTimings", () => {
  it("returns nothing for no words", () => {
    expect(buildPacedTimings([], BASE_WPM)).toEqual([]);
  });

  it("gives a five-letter word exactly one beat of 60000 / wpm milliseconds", () => {
    expect(durations(["hello"])).toEqual([240]);
    expect(durations(["hello"], 125)).toEqual([480]);
    expect(durations(["hello", "world."], 500)).toEqual([120, 240]);
  });

  it("scales a word's time with its length, within bounds", () => {
    expect(durations(["a"])).toEqual([125]);
    expect(durations(["a".repeat(15)])).toEqual([528]);
    expect(durations(["a".repeat(30)])).toEqual([600]);
  });

  it("counts letters and digits but not punctuation", () => {
    expect(durations(["(hello)"])).toEqual(durations(["hello"]));
    expect(durations(["2024"])).toEqual([211]);
  });

  it("pauses a beat after a sentence end and half a beat after a clause break", () => {
    expect(durations(["hello.", "hello!", "hello?", "hello…"])).toEqual([480, 480, 480, 480]);
    expect(durations(["hello,", "hello;", "hello:", "hello—", "hello–"])).toEqual([
      360, 360, 360, 360, 360,
    ]);
  });

  it("looks through closing quotes and brackets for the punctuation", () => {
    expect(durations(['hello."', "hello.)", "hello.”", "hello?’"])).toEqual([480, 480, 480, 480]);
    expect(durations(['hello,"', "hello,)"])).toEqual([360, 360]);
  });

  it.each(["a.b", "a,b", "a;b", "a:b", "a—b"])(
    "does not pause for punctuation inside %s",
    (word) => {
      expect(durations([word])).toEqual(durations(["ab"]));
    }
  );

  it("treats a word with no letters as short, and still pauses on a dash", () => {
    expect(durations(["•"])).toEqual([120]);
    expect(durations(["—"])).toEqual([240]);
  });

  it("lays the words end to end starting at zero and keeps their text", () => {
    const timings = buildPacedTimings(["Hello", "brave", "new", "world."], BASE_WPM);

    expect(timings.map((timing) => timing.text)).toEqual(["Hello", "brave", "new", "world."]);
    expect(timings[0].startMs).toBe(0);
    timings.slice(1).forEach((timing, index) => {
      expect(timing.startMs).toBe(timings[index].startMs + timings[index].durationMs);
    });
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/utils/__tests__/pacedTimings.test.ts
```

Expected: FAIL — `Failed to resolve import "../pacedTimings" from "src/utils/__tests__/pacedTimings.test.ts". Does the file exist?`

- [ ] **Step 2: Green — `buildPacedTimings`**

Create `frontend/src/utils/pacedTimings.ts`:

```ts
import type { WordTiming } from "../types";

/** The speed (words per minute) the synthetic timings are built at; the pacer's rate scales it. */
export const BASE_WPM = 250;

const MIN_LENGTH_FACTOR = 0.5;
const MAX_LENGTH_FACTOR = 2.5;
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:\u2014\u2013]["'”’)\]]*$/;

/** 1 for a five-letter word; shorter words go quicker and longer ones slower, within bounds. */
function lengthFactor(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
  return Math.min(MAX_LENGTH_FACTOR, Math.max(MIN_LENGTH_FACTOR, 0.4 + 0.6 * (letters / 5)));
}

/** Extra beats spent after the word: a full beat after a sentence, half a beat after a clause. */
function pauseBeats(word: string): number {
  if (SENTENCE_END.test(word)) return 1;
  if (CLAUSE_END.test(word)) return 0.5;
  return 0;
}

/**
 * Synthetic, contiguous word timings for silent reading, so the read-along
 * highlighter can run without audio. Each word gets one beat (60000 / baseWpm ms)
 * scaled by its length, plus a pause after sentence and clause punctuation.
 * `words` are the whitespace-delimited tokens from `collectWords`.
 */
export function buildPacedTimings(words: readonly string[], baseWpm: number): WordTiming[] {
  const beatMs = 60000 / baseWpm;
  let startMs = 0;
  return words.map((text) => {
    const durationMs = Math.round(beatMs * (lengthFactor(text) + pauseBeats(text)));
    const timing = { text, startMs, durationMs };
    startMs += durationMs;
    return timing;
  });
}
```

Run the Step 1 command. Expected: PASS, 13 tests. The pinned numbers follow from one beat being 240 ms at 250 WPM: a five-letter word has length factor 1 (240 ms); `"a"` is `0.4 + 0.6 × 1/5 = 0.52` (125 ms); fifteen letters is 2.2 (528 ms); thirty letters would be 4.0 and is capped at 2.5 (600 ms); a word with no letters sits on the 0.5 floor (`"•"`, 120 ms) and a dash adds half a beat (`"—"`, 240 ms).

- [ ] **Step 3: Red — `PacerClock`**

Create `frontend/src/utils/__tests__/pacerClock.test.ts`. The `FakeScheduler` replaces real time and real animation frames, so every test is deterministic. `idle(ms)` moves time without running a frame (a busy main thread between frames), which is what lets the tests catch "time since the last frame" mistakes that a clock that always ticks on schedule would hide.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaClock, MediaClockEvent } from "../mediaClock";
import { PacerClock, type PacerScheduler } from "../pacerClock";

class FakeScheduler implements PacerScheduler {
  private time = 0;
  private nextHandle = 1;
  private frames = new Map<number, () => void>();

  now() {
    return this.time;
  }

  requestFrame(callback: () => void) {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number) {
    this.frames.delete(handle);
  }

  /** Moves time forward without running a frame, like a busy main thread between frames. */
  idle(ms: number) {
    this.time += ms;
  }

  /** Moves time forward `step` ms at a time, running the frames scheduled along the way. */
  advance(ms: number, step = 50) {
    const end = this.time + ms;
    while (this.time < end) {
      this.time = Math.min(end, this.time + step);
      const due = [...this.frames.values()];
      this.frames.clear();
      due.forEach((callback) => callback());
    }
  }
}

const EVENTS: MediaClockEvent[] = ["play", "pause", "seeking", "seeked", "timeupdate", "ended"];
const created: PacerClock[] = [];

function setup(durationMs = 60_000) {
  const scheduler = new FakeScheduler();
  const clock = new PacerClock(scheduler);
  created.push(clock);
  clock.setDurationMs(durationMs);
  const events: MediaClockEvent[] = [];
  EVENTS.forEach((type) => clock.addEventListener(type, () => events.push(type)));
  return { scheduler, clock, events };
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  created.splice(0).forEach((clock) => clock.dispose());
  Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
});

describe("PacerClock", () => {
  it("starts paused at the beginning", () => {
    const { clock } = setup();

    expect(clock.currentTime).toBe(0);
    expect(clock.paused).toBe(true);
    expect(clock.ended).toBe(false);
  });

  it("does not start when there is nothing to read", () => {
    const { clock, events } = setup(0);

    clock.play();

    expect(clock.paused).toBe(true);
    expect(events).toEqual([]);
  });

  it("ignores play while it is already running", () => {
    const { clock, events } = setup();

    clock.play();
    clock.play();

    expect(events).toEqual(["play"]);
  });

  it("advances with real time", () => {
    const { clock, scheduler } = setup();

    clock.play();
    scheduler.advance(2000);

    expect(clock.currentTime).toBeCloseTo(2, 5);
    expect(clock.paused).toBe(false);
  });

  it("multiplies elapsed time by the rate, from the moment the rate changes", () => {
    const { clock, scheduler } = setup();

    clock.play();
    scheduler.advance(1000);
    scheduler.idle(100);
    clock.setRate(2);
    scheduler.advance(1000);

    expect(clock.currentTime).toBeCloseTo(3.1, 5);
  });

  it("fires play, then timeupdate four times a second", () => {
    const { clock, scheduler, events } = setup();

    clock.play();
    scheduler.advance(1000);

    expect(events).toEqual(["play", "timeupdate", "timeupdate", "timeupdate", "timeupdate"]);
  });

  it("holds its position while paused, announcing it with timeupdate then pause", () => {
    const { clock, scheduler, events } = setup();
    clock.play();
    scheduler.advance(1100);
    events.length = 0;

    clock.pause();
    const pausedAt = clock.currentTime;
    scheduler.advance(5000);

    expect(events).toEqual(["timeupdate", "pause"]);
    expect(clock.currentTime).toBe(pausedAt);
    expect(clock.paused).toBe(true);
  });

  it("counts the time since the last frame when it pauses", () => {
    const { clock, scheduler } = setup();
    clock.play();
    scheduler.advance(1000);
    scheduler.idle(30);

    clock.pause();

    expect(clock.currentTime).toBeCloseTo(1.03, 5);
  });

  it("ignores pause while it is not running", () => {
    const { clock, events } = setup();

    clock.pause();

    expect(events).toEqual([]);
  });

  it("resumes from where it paused", () => {
    const { clock, scheduler } = setup();
    clock.play();
    scheduler.advance(1000);
    clock.pause();
    scheduler.advance(3000);

    clock.play();
    scheduler.advance(1000);

    expect(clock.currentTime).toBeCloseTo(2, 5);
  });

  it("moves to the new position first, then fires seeking, timeupdate and seeked", () => {
    const { clock, events } = setup();
    const positions: number[] = [];
    clock.addEventListener("seeking", () => positions.push(clock.currentTime));

    clock.seek(12.5);

    expect(positions).toEqual([12.5]);
    expect(events).toEqual(["seeking", "timeupdate", "seeked"]);
  });

  it("clamps a seek to the readable range", () => {
    const { clock } = setup(10_000);

    clock.seek(-4);
    expect(clock.currentTime).toBe(0);
    clock.seek(99);
    expect(clock.currentTime).toBe(10);
  });

  it("keeps running after a seek, counting from the new position", () => {
    const { clock, scheduler } = setup();
    clock.play();
    scheduler.advance(500);
    scheduler.idle(10);

    clock.seek(20);
    scheduler.advance(1000);

    expect(clock.currentTime).toBeCloseTo(21, 5);
  });

  it("ends exactly at the duration, never past it", () => {
    const { clock, scheduler, events } = setup(1000);
    const positions: number[] = [];
    clock.addEventListener("timeupdate", () => positions.push(clock.currentTime));

    clock.play();
    scheduler.advance(5000, 300);

    expect(events.slice(-3)).toEqual(["timeupdate", "pause", "ended"]);
    expect(positions.at(-1)).toBe(1);
    expect(clock.currentTime).toBe(1);
    expect(clock.ended).toBe(true);
    expect(clock.paused).toBe(true);
  });

  it("treats a seek to the end like reaching it", () => {
    const { clock, events } = setup(10_000);
    clock.play();
    events.length = 0;

    clock.seek(99);

    expect(events.slice(-2)).toEqual(["pause", "ended"]);
    expect(clock.ended).toBe(true);
    expect(clock.paused).toBe(true);
  });

  it("marks a paused seek to the end as ended without announcing an end of playback", () => {
    const { clock, events } = setup(10_000);

    clock.seek(99);

    expect(events).toEqual(["seeking", "timeupdate", "seeked"]);
    expect(clock.ended).toBe(true);
  });

  it("restarts from the beginning when played after the end", () => {
    const { clock, scheduler } = setup(1000);
    clock.play();
    scheduler.advance(2000);

    clock.play();
    expect(clock.ended).toBe(false);
    expect(clock.currentTime).toBe(0);
    scheduler.advance(500);

    expect(clock.currentTime).toBeCloseTo(0.5, 5);
  });

  it("is no longer ended once it is moved back", () => {
    const { clock, scheduler } = setup(1000);
    clock.play();
    scheduler.advance(2000);

    clock.seek(0.2);

    expect(clock.ended).toBe(false);
  });

  it("counts a long stall as one second so a suspended tab cannot jump ahead", () => {
    const { clock, scheduler } = setup();
    clock.play();

    scheduler.advance(60_000, 60_000);

    expect(clock.currentTime).toBeCloseTo(1, 5);
  });

  it("pauses itself when the tab is hidden and does not resume when it is shown again", () => {
    const { clock, scheduler } = setup();
    clock.play();
    scheduler.advance(500);

    setVisibility("hidden");
    expect(clock.paused).toBe(true);
    setVisibility("visible");

    expect(clock.paused).toBe(true);
  });

  it("stops delivering events to a listener that was removed", () => {
    const { clock } = setup();
    const listener = vi.fn();
    clock.addEventListener("seeking", listener);
    clock.removeEventListener("seeking", listener);

    clock.seek(1);

    expect(listener).not.toHaveBeenCalled();
  });

  it("does nothing more once disposed", () => {
    const { clock, scheduler, events } = setup();
    clock.play();
    clock.dispose();
    events.length = 0;

    scheduler.advance(1000);
    setVisibility("hidden");

    expect(events).toEqual([]);
  });

  it("stops listening for the page being hidden once disposed", () => {
    const removeListener = vi.spyOn(document, "removeEventListener");
    const { clock } = setup();

    clock.dispose();

    expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("can stand in for an audio element wherever a MediaClock is expected", () => {
    const pacer = new PacerClock();
    const clocks: MediaClock[] = [pacer, document.createElement("audio")];
    pacer.dispose();

    expect(clocks).toHaveLength(2);
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/utils/__tests__/pacerClock.test.ts
```

Expected: FAIL — `Failed to resolve import "../pacerClock" from "src/utils/__tests__/pacerClock.test.ts". Does the file exist?` (The `../mediaClock` import is type-only, so it is erased and is not what fails.)

- [ ] **Step 4: Green — `MediaClock` and `PacerClock`**

Create `frontend/src/utils/mediaClock.ts`:

```ts
export type MediaClockEvent = "play" | "pause" | "seeking" | "seeked" | "timeupdate" | "ended";

/**
 * The minimal surface the read-along highlighter and the reading-progress
 * tracker need from a clock. An HTMLAudioElement satisfies it, and so does the
 * timer-driven PacerClock used for silent reading.
 */
export interface MediaClock {
  /** Seconds. */
  readonly currentTime: number;
  readonly ended: boolean;
  readonly paused: boolean;
  addEventListener(type: MediaClockEvent, listener: () => void): void;
  removeEventListener(type: MediaClockEvent, listener: () => void): void;
}
```

Create `frontend/src/utils/pacerClock.ts`:

```ts
import type { MediaClock, MediaClockEvent } from "./mediaClock";

/** Spacing of `timeupdate` events while running, close to what an audio element fires. */
export const PACER_TIMEUPDATE_INTERVAL_MS = 250;

/**
 * The longest gap between two frames that still counts as reading time. A
 * suspended or stalled tab then slows the clock down instead of jumping it ahead.
 */
export const PACER_MAX_FRAME_GAP_MS = 1000;

export interface PacerScheduler {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

const browserScheduler: PacerScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

/**
 * A virtual media clock for silent reading. It advances with real time scaled by
 * `rate` instead of with an audio file, and it speaks the same events as an audio
 * element, so highlighting and reading progress run on it unchanged.
 */
export class PacerClock implements MediaClock {
  private readonly scheduler: PacerScheduler;
  private readonly listeners = new Map<MediaClockEvent, Set<() => void>>();
  private positionMs = 0;
  private durationMs = 0;
  private rate = 1;
  private running = false;
  private finished = false;
  private lastFrameAt = 0;
  private lastTimeupdateAt = 0;
  private frame = 0;

  constructor(scheduler: PacerScheduler = browserScheduler) {
    this.scheduler = scheduler;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  get currentTime(): number {
    return this.positionMs / 1000;
  }

  get ended(): boolean {
    return this.finished;
  }

  get paused(): boolean {
    return !this.running;
  }

  setDurationMs(durationMs: number): void {
    this.durationMs = durationMs;
  }

  setRate(rate: number): void {
    this.advance();
    this.rate = rate;
  }

  play(): void {
    if (this.running || this.durationMs <= 0) return;
    if (this.finished) {
      this.positionMs = 0;
      this.finished = false;
    }
    this.running = true;
    this.lastFrameAt = this.scheduler.now();
    this.frame = this.scheduler.requestFrame(this.tick);
    this.emit("play");
  }

  pause(): void {
    if (!this.running) return;
    this.advance();
    this.halt();
    this.emit("timeupdate");
    this.emit("pause");
  }

  seek(seconds: number): void {
    this.positionMs = Math.min(this.durationMs, Math.max(0, seconds * 1000));
    this.finished = false;
    if (this.running) this.lastFrameAt = this.scheduler.now();
    this.emit("seeking");
    this.emit("timeupdate");
    this.emit("seeked");
    if (this.durationMs > 0 && this.positionMs >= this.durationMs) this.finish();
  }

  dispose(): void {
    this.halt();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  addEventListener(type: MediaClockEvent, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: MediaClockEvent, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  private readonly tick = (): void => {
    this.advance();
    if (this.positionMs >= this.durationMs) {
      this.finish();
      return;
    }
    const now = this.scheduler.now();
    if (now - this.lastTimeupdateAt >= PACER_TIMEUPDATE_INTERVAL_MS) {
      this.lastTimeupdateAt = now;
      this.emit("timeupdate");
    }
    this.frame = this.scheduler.requestFrame(this.tick);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.pause();
  };

  /** Moves the position forward by the time since the last frame, scaled by the rate. */
  private advance(): void {
    if (!this.running) return;
    const now = this.scheduler.now();
    const elapsed = Math.min(now - this.lastFrameAt, PACER_MAX_FRAME_GAP_MS);
    this.lastFrameAt = now;
    this.positionMs = Math.min(this.durationMs, this.positionMs + elapsed * this.rate);
  }

  private halt(): void {
    this.running = false;
    this.scheduler.cancelFrame(this.frame);
  }

  private finish(): void {
    const wasRunning = this.running;
    this.halt();
    this.finished = true;
    if (wasRunning) {
      this.emit("timeupdate");
      this.emit("pause");
      this.emit("ended");
    }
  }

  private emit(type: MediaClockEvent): void {
    // A copy, so a listener can unsubscribe while the event is being delivered.
    [...(this.listeners.get(type) ?? [])].forEach((listener) => listener());
  }
}
```

Two behaviours matter to later tasks. `pause()` and the end of the text both emit `timeupdate` **before** `pause`/`ended`, so a listener always sees the final position (Task 14 relies on that to credit the last stretch). And a hidden tab pauses the clock and never resumes it by itself, so reading time is never credited while nobody is looking.

Run the Step 3 command. Expected: PASS, 24 tests. Then:

```bash
docker compose exec -T frontend pnpm exec tsc -b
```

Expected: no output. This also proves the last test's claim at compile time: `HTMLAudioElement` is assignable to `MediaClock`.

- [ ] **Step 5: Verify the task**

```bash
docker compose exec -T frontend pnpm exec vitest run src/utils/__tests__/pacedTimings.test.ts src/utils/__tests__/pacerClock.test.ts
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check src/utils/mediaClock.ts src/utils/pacedTimings.ts src/utils/pacerClock.ts src/utils/__tests__/pacedTimings.test.ts src/utils/__tests__/pacerClock.test.ts
```

Expected: 37 tests pass (13 + 24); `pnpm lint` reports no new warnings; prettier accepts all five new files (if it flags one, run `pnpm exec prettier --write` on that new file only).

- [ ] **Step 6: Commit (only if the user asked for commits)**

```bash
git add frontend/src/utils/mediaClock.ts frontend/src/utils/pacedTimings.ts frontend/src/utils/pacerClock.ts frontend/src/utils/__tests__/pacedTimings.test.ts frontend/src/utils/__tests__/pacerClock.test.ts
git commit -m "feat(frontend): add MediaClock, paced word timings and the PacerClock" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 11: `useReadAlong` follows a pacer — paced mode

Silent reading has no audio, so there are no server word timings. In paced mode the hook builds the timeline itself, from the words it has just wrapped, and follows whatever `MediaClock` it is given: the same word highlight, the same continuous fill and the same auto-scroll as with audio. Because the timeline is built from the displayed tokens, the 90 % alignment gate has nothing to decide and timing *i* is span *i* by construction.

The spec's Open Items left "how paced mode exposes the total duration" to this plan. Settled here: the result gains `pacedDurationMs` (the spec's working name was `durationMs`; the longer name is the truthful one, because it is 0 unless `paced` is on). Task 17 hands it to the pacer.

**Files:**
- Modify: `frontend/src/hooks/useReadAlong.ts`
- Create: `frontend/src/hooks/__tests__/useReadAlong.paced.test.tsx`

**Interfaces:**
- Consumes: `MediaClock` and `MediaClockEvent` from `frontend/src/utils/mediaClock.ts`; `BASE_WPM` and `buildPacedTimings` from `frontend/src/utils/pacedTimings.ts` (both Task 10).
- Produces:
  - `UseReadAlongArgs.paced?: boolean` (default `false`). While paced, `timings` is ignored, so audio timings that arrive mid-reading (the audio preload finishing) never re-wrap the article.
  - `UseReadAlongArgs.getMediaElement: () => MediaClock | null`. An `HTMLAudioElement` still fits, so `PostDetailPage` keeps type-checking.
  - `UseReadAlongResult.pacedDurationMs: number`: the length of the paced timeline in ms; 0 unless `paced` is on and there are words to pace.
- With `paced` off the hook behaves exactly as before; the 37 existing `useReadAlong*` tests are the proof.

- [ ] **Step 1: Red — the paced-mode tests**

Create `frontend/src/hooks/__tests__/useReadAlong.paced.test.tsx` (2-space). It stubs `CSS.highlights`, `Highlight` and `requestAnimationFrame` the way `useReadAlong.continuous.test.tsx` does, and drives the hook with a `FakeClock` that is deliberately **not** an `HTMLAudioElement`, so a pass proves the hook follows any `MediaClock`:

```tsx
import { act, cleanup, render, screen } from "@testing-library/react";
import { useCallback, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WordTiming } from "../../types";
import type { MediaClock } from "../../utils/mediaClock";
import { BASE_WPM, buildPacedTimings } from "../../utils/pacedTimings";
import { useReadAlong, type HighlightMode } from "../useReadAlong";

// Not an HTMLAudioElement: proves the hook follows any MediaClock.
class FakeClock extends EventTarget implements MediaClock {
  currentTime = 0;
  ended = false;
  paused = true;
}

const registry = new Map<string, Set<Range>>();
let frames: FrameRequestCallback[] = [];

const TITLE = "Hello world";
const BODY = "foo bar baz";
const WORDS = ["Hello", "world", "foo", "bar", "baz"];

const endOf = (timings: WordTiming[]) =>
  timings[timings.length - 1].startMs + timings[timings.length - 1].durationMs;
const PACED = buildPacedTimings(WORDS, BASE_WPM);
const PACED_END_MS = endOf(PACED);
const AUDIO: WordTiming[] = WORDS.map((text, index) => ({
  text,
  startMs: index * 1000,
  durationMs: 1000,
}));

/** Seconds at the middle of the word at `index` on the paced timeline. */
const midpoint = (index: number) => (PACED[index].startMs + PACED[index].durationMs / 2) / 1000;

function frame() {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((callback) => callback(0)));
}

function active() {
  return document.querySelector<HTMLElement>(".ra-active");
}

function paintedText() {
  return [...registry.values()].flatMap((highlight) =>
    [...highlight].map((range) => range.toString())
  );
}

const text = (testId: string) => screen.getByTestId(testId).textContent;

function Harness({
  clock,
  timings = null,
  paced = false,
  playing = true,
  mode = "word",
  enabled = true,
  title = TITLE,
  body = BODY,
  durations,
}: {
  clock: FakeClock;
  timings?: WordTiming[] | null;
  paced?: boolean;
  playing?: boolean;
  mode?: HighlightMode;
  enabled?: boolean;
  title?: string;
  body?: string;
  /** Collects the duration reported by every render. */
  durations?: number[];
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const getMediaElement = useCallback(() => clock, [clock]);
  const { highlightingActive, pacedDurationMs } = useReadAlong({
    timings,
    getMediaElement,
    isPlaying: playing,
    titleRef,
    contentRef,
    highlightEnabled: enabled,
    autoScrollEnabled: false,
    highlightMode: mode,
    paced,
    contentVersion: body,
  });
  durations?.push(pacedDurationMs);
  return (
    <>
      <h1 ref={titleRef}>{title}</h1>
      <div ref={contentRef} dangerouslySetInnerHTML={{ __html: body }} />
      <span data-testid="active">{String(highlightingActive)}</span>
      <span data-testid="duration">{pacedDurationMs}</span>
    </>
  );
}

beforeEach(() => {
  registry.clear();
  frames = [];
  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal(
    "Highlight",
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    }
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useReadAlong paced mode", () => {
  it("wraps the displayed words and activates with no audio timings at all", () => {
    render(<Harness clock={new FakeClock()} paced />);

    expect(text("active")).toBe("true");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(5);
  });

  it("starts pacing when paced is turned on for an article with no audio", () => {
    const clock = new FakeClock();
    const view = render(<Harness clock={clock} />);
    expect(text("active")).toBe("false");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(0);

    view.rerender(<Harness clock={clock} paced />);

    expect(text("active")).toBe("true");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(5);
  });

  it("reports the length of the paced timeline as pacedDurationMs", () => {
    render(<Harness clock={new FakeClock()} paced />);

    expect(text("duration")).toBe(String(PACED_END_MS));
  });

  it("highlights the word the clock is inside, in the title and in the body", () => {
    const clock = new FakeClock();
    render(<Harness clock={clock} paced />);

    clock.currentTime = midpoint(1);
    frame();
    expect(active()?.dataset.raIndex).toBe("1");
    expect(active()?.textContent).toBe("world");

    clock.currentTime = midpoint(3);
    frame();
    expect(active()?.dataset.raIndex).toBe("3");
    expect(active()?.textContent).toBe("bar");
  });

  it("ignores audio timings, even ones that do not match the text", () => {
    const unrelated: WordTiming[] = [
      { text: "completely", startMs: 9000, durationMs: 500 },
      { text: "different", startMs: 9500, durationMs: 500 },
    ];
    const clock = new FakeClock();
    render(<Harness clock={clock} paced timings={unrelated} />);

    clock.currentTime = midpoint(0);
    frame();

    expect(text("active")).toBe("true");
    expect(active()?.textContent).toBe("Hello");
  });

  it("gives a punctuation-only token its own slot on the timeline", () => {
    const words = ["Hello", "world", "foo", "—", "bar"];
    const timeline = buildPacedTimings(words, BASE_WPM);
    const clock = new FakeClock();
    render(<Harness clock={clock} paced body="foo — bar" />);

    clock.currentTime = (timeline[3].startMs + timeline[3].durationMs / 2) / 1000;
    frame();

    expect(active()?.textContent).toBe("—");
    expect(text("duration")).toBe(String(endOf(timeline)));
  });

  it("holds the last word until its time is up, then clears", () => {
    const clock = new FakeClock();
    render(<Harness clock={clock} paced />);

    clock.currentTime = (PACED_END_MS - 10) / 1000;
    frame();
    expect(active()?.textContent).toBe("baz");

    clock.currentTime = (PACED_END_MS + 10) / 1000;
    frame();
    expect(active()).toBeNull();
  });

  it("does not wrap or time anything while highlighting is off", () => {
    render(<Harness clock={new FakeClock()} paced enabled={false} />);

    expect(text("active")).toBe("false");
    expect(text("duration")).toBe("0");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(0);
  });

  it("forgets the paced timeline when highlighting is turned off", () => {
    const clock = new FakeClock();
    const view = render(<Harness clock={clock} paced />);
    expect(text("duration")).toBe(String(PACED_END_MS));

    view.rerender(<Harness clock={clock} paced enabled={false} />);

    expect(text("active")).toBe("false");
    expect(text("duration")).toBe("0");
  });

  it("has nothing to pace when the article has no words", () => {
    render(<Harness clock={new FakeClock()} paced title="" body="" />);

    expect(text("active")).toBe("false");
    expect(text("duration")).toBe("0");
  });

  it("has no paced duration when it follows the audio timings", () => {
    render(<Harness clock={new FakeClock()} timings={AUDIO} />);

    expect(text("active")).toBe("true");
    expect(text("duration")).toBe("0");
  });

  it("switches between the audio and paced timelines as paced is toggled", () => {
    // 1.5 s is inside "world" on the audio timeline but past the end of the paced one.
    expect(PACED_END_MS).toBeLessThan(1500);
    const clock = new FakeClock();
    clock.currentTime = 1.5;
    const view = render(<Harness clock={clock} timings={AUDIO} />);
    frame();
    expect(active()?.textContent).toBe("world");

    view.rerender(<Harness clock={clock} timings={AUDIO} paced />);
    frame();
    expect(text("duration")).toBe(String(PACED_END_MS));
    expect(active()).toBeNull();
    expect(document.querySelectorAll(".ra-word")).toHaveLength(5);

    view.rerender(<Harness clock={clock} timings={AUDIO} />);
    frame();
    expect(text("duration")).toBe("0");
    expect(active()?.textContent).toBe("world");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(5);
  });

  it("keeps its wrapped words when audio timings arrive while paced", () => {
    const clock = new FakeClock();
    const view = render(<Harness clock={clock} paced />);
    const first = document.querySelector(".ra-word");

    view.rerender(<Harness clock={clock} paced timings={AUDIO} />);

    expect(document.querySelector(".ra-word")).toBe(first);
  });

  it("reports no paced duration in any render once paced is off", () => {
    const clock = new FakeClock();
    const durations: number[] = [];
    const view = render(<Harness clock={clock} paced durations={durations} />);
    expect(durations[durations.length - 1]).toBe(PACED_END_MS);

    durations.length = 0;
    view.rerender(<Harness clock={clock} durations={durations} />);

    expect(durations.length).toBeGreaterThan(0);
    expect(durations.every((duration) => duration === 0)).toBe(true);
  });

  it("paces the new text when the article DOM is replaced", () => {
    const clock = new FakeClock();
    const view = render(<Harness clock={clock} paced />);

    view.rerender(<Harness clock={clock} paced body="foo bar baz qux quux" />);

    expect(document.querySelectorAll(".ra-word")).toHaveLength(7);
    const longer = buildPacedTimings([...WORDS, "qux", "quux"], BASE_WPM);
    expect(text("duration")).toBe(String(endOf(longer)));
  });

  it("fills the current word from the paced timeline in continuous mode", () => {
    const clock = new FakeClock();
    clock.currentTime = midpoint(1);

    render(<Harness clock={clock} paced mode="continuous" />);

    expect(paintedText()).toEqual(["Hello ", ""]);
    const current = document.querySelector<HTMLElement>(".ra-progress");
    expect(current?.textContent).toBe("world");
    expect(parseFloat(current?.style.getPropertyValue("--ra-progress") ?? "")).toBeCloseTo(50, 3);
  });

  it("repaints on the clock's own events while paused", () => {
    const clock = new FakeClock();
    clock.currentTime = midpoint(1);
    render(<Harness clock={clock} paced mode="continuous" playing={false} />);
    expect(document.querySelector(".ra-progress")?.textContent).toBe("world");

    act(() => {
      clock.currentTime = midpoint(3);
      clock.dispatchEvent(new Event("seeked"));
    });

    expect(paintedText()).toEqual(["Hello world", "foo "]);
    expect(document.querySelector(".ra-progress")?.textContent).toBe("bar");
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/useReadAlong.paced.test.tsx
```

Expected: FAIL — `Tests  17 failed (17)`. The unchanged hook has no `paced` option and returns no `pacedDurationMs`, so the tests fail with `AssertionError: expected 'false' to be 'true'` (it never activates), `expected '' to be '1026'` (no duration) or `expected undefined to be '1'` (nothing highlighted). `pnpm exec tsc -b` would also report `error TS2339: Property 'pacedDurationMs' does not exist on type 'UseReadAlongResult'` and `error TS2322: Type '() => FakeClock' is not assignable to type '() => HTMLAudioElement | null'`.

- [ ] **Step 2: Green — paced mode in the hook**

In `frontend/src/hooks/useReadAlong.ts` (2-space) make these thirteen edits, in order.

1. Header comment. Replace:

```ts
 *     seeks and completed playback. Auto-scroll follows active-word changes.
 */
```

with:

```ts
 *     seeks and completed playback. Auto-scroll follows active-word changes.
 *
 * With `paced`, there is no audio: every displayed token gets a timing from
 * `buildPacedTimings`, so the same highlighting follows a PacerClock instead
 * (silent reading). The alignment gate is skipped because the timeline is
 * built from the displayed words themselves.
 */
```

2. Imports. Replace:

```ts
import { alignSpokenToDisplay, normalizeToken } from "../utils/alignTimings";
import { collectWords, unwrapWords, wrapWords } from "../utils/wrapWords";
```

with:

```ts
import { alignSpokenToDisplay, normalizeToken } from "../utils/alignTimings";
import type { MediaClock, MediaClockEvent } from "../utils/mediaClock";
import { BASE_WPM, buildPacedTimings } from "../utils/pacedTimings";
import { collectWords, unwrapWords, wrapWords } from "../utils/wrapWords";
```

3. The clock type. Replace:

```ts
  getMediaElement: () => HTMLAudioElement | null;
```

with:

```ts
  /** The clock the highlight follows: the audio element, or a PacerClock when `paced`. */
  getMediaElement: () => MediaClock | null;
```

4. The `paced` argument. Replace:

```ts
  highlightMode?: HighlightMode;
  /** Changes when sanitized article DOM is replaced (e.g. image consent). */
```

with:

```ts
  highlightMode?: HighlightMode;
  /**
   * Pace the displayed words with a built-in timeline instead of `timings`
   * (silent reading). `getMediaElement` must then return the pacer's clock.
   */
  paced?: boolean;
  /** Changes when sanitized article DOM is replaced (e.g. image consent). */
```

5. The result, plus a helper for the end of a timeline. Replace:

```ts
  highlightingActive: boolean;
}

/** Greatest index whose start <= mediaMs; -1 before the first / after the last ends. */
```

with:

```ts
  highlightingActive: boolean;
  /** Length of the paced timeline in ms; 0 unless `paced` is on and there are words to pace. */
  pacedDurationMs: number;
}

/** When the last word finishes, in ms (0 for no timeline). */
function timelineEndMs(timings: WordTiming[] | null): number {
  const last = timings?.[timings.length - 1];
  return last ? last.startMs + last.durationMs : 0;
}

/** Greatest index whose start <= mediaMs; -1 before the first / after the last ends. */
```

6. The hook's arguments. The audio timings get their own name. Replace:

```ts
  const {
    timings,
    getMediaElement,
```

with:

```ts
  const {
    timings: audioTimings,
    getMediaElement,
```

7. The two timelines. Replace:

```ts
    highlightMode = "word",
  } = args;

  const [highlightingActive, setHighlightingActive] = useState(false);
```

with:

```ts
    highlightMode = "word",
    paced = false,
  } = args;

  const [highlightingActive, setHighlightingActive] = useState(false);
  // Built from the displayed words once they are wrapped (effect 1).
  const [paceTimings, setPaceTimings] = useState<WordTiming[] | null>(null);
  // Audio timings never apply to a paced timeline, so they must not re-wrap it.
  const timingsToAlign = paced ? null : audioTimings;
  // The timeline the painting effect follows.
  const timings = paced ? paceTimings : audioTimings;
```

8. Effect 1, reset. Replace:

```ts
    setHighlightingActive(false);

    const title = titleRef.current;
```

with:

```ts
    setHighlightingActive(false);
    setPaceTimings(null);

    const title = titleRef.current;
```

9. Effect 1, eligibility: a paced article needs no audio timings and skips the alignment gate. Replace:

```ts
    if (!highlightEnabled || !timings || timings.length === 0) return;
    if (!title && !content) return;

    const spoken = timings.map((t) => normalizeToken(t.text));
    const displayWords = [
      ...(title ? collectWords(title) : []),
      ...(content ? collectWords(content) : []),
    ].map(normalizeToken);

    const alignment = alignSpokenToDisplay(spoken, displayWords);
    if (!alignment.enabled) return;

    const spans: HTMLElement[] = [];
```

with:

```ts
    if (!highlightEnabled || (!paced && !timingsToAlign?.length)) return;
    if (!title && !content) return;

    let timingToDisplay: Int32Array | null = null;
    if (timingsToAlign) {
      const spoken = timingsToAlign.map((t) => normalizeToken(t.text));
      const displayWords = [
        ...(title ? collectWords(title) : []),
        ...(content ? collectWords(content) : []),
      ].map(normalizeToken);

      const alignment = alignSpokenToDisplay(spoken, displayWords);
      if (!alignment.enabled) return;
      timingToDisplay = alignment.timingToDisplay;
    }

    const spans: HTMLElement[] = [];
```

10. Effect 1, pacing: build the timeline from the wrapped words. Replace:

```ts
    spansRef.current = spans;
    mapRef.current = alignment.timingToDisplay;
    setHighlightingActive(true);
```

with:

```ts
    if (paced) {
      // Every displayed token is its own timing, so timing i is span i.
      const words = spans.map((span) => span.textContent ?? "");
      if (words.length === 0) return;
      timingToDisplay = Int32Array.from(words, (_, index) => index);
      setPaceTimings(buildPacedTimings(words, BASE_WPM));
    }

    spansRef.current = spans;
    mapRef.current = timingToDisplay;
    setHighlightingActive(true);
```

11. Effect 1, dependencies. Replace:

```ts
  }, [timings, highlightEnabled, titleRef, contentRef, clearActive, contentVersion]);
```

with:

```ts
  }, [timingsToAlign, paced, highlightEnabled, titleRef, contentRef, clearActive, contentVersion]);
```

12. Effect 2 (painting). Its body is untouched: it keeps reading the name `timings`, which is now the timeline of the current mode. Only the event list gains its type. Replace:

```ts
    const events = ["seeking", "seeked", "timeupdate", "ended", "play"];
```

with:

```ts
    const events: MediaClockEvent[] = ["seeking", "seeked", "timeupdate", "ended", "play"];
```

13. The result. Replace:

```ts
  return { highlightingActive };
}
```

with:

```ts
  return { highlightingActive, pacedDurationMs: paced ? timelineEndMs(paceTimings) : 0 };
}
```

Why it is shaped this way:

- The words come from the wrapped spans' `textContent`, so the timeline can never disagree with what is on screen and no alignment is needed.
- `paceTimings` is state, not a ref: a re-wrap (`contentVersion` changes) has to re-render the hook so `pacedDurationMs` follows the new text.
- Effect 1 depends on `timingsToAlign`, which is `null` while paced, so audio timings arriving mid-reading do not re-wrap.
- `pacedDurationMs` is gated on `paced`, so no render shows a stale duration between `paced` going off and effect 1's reset running.
- If `paced` is on and the article has no words, the hook stays inert: no `highlightingActive`, duration 0.

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/useReadAlong
```

Expected: PASS, 4 files and 54 tests: the 17 new ones plus the 37 that already existed in `useReadAlong.test.ts`, `useReadAlong.continuous.test.tsx` and `useReadAlongPreferences.test.ts`. The prefix also matches the new file.

- [ ] **Step 3: Verify the task**

```bash
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check src/hooks/__tests__/useReadAlong.paced.test.tsx
docker compose exec -T frontend pnpm exec vitest run src/pages/posts
```

Expected: `tsc -b` prints nothing. `PostDetailPage` still passes `player.getMediaElement`, a `() => HTMLAudioElement | null`, to the widened `() => MediaClock | null`, which type-checks because `HTMLAudioElement` is a `MediaClock`. `pnpm lint` reports no new warnings. Prettier accepts the new test file (if it does not, run `pnpm exec prettier --write` on that new file only; never on `useReadAlong.ts`, which is not strictly prettier-formatted). The `PostDetailPage` test still passes, which shows `paced` off changes nothing for the page.

- [ ] **Step 4: Commit (only if the user asked for commits)**

```bash
git add frontend/src/hooks/useReadAlong.ts frontend/src/hooks/__tests__/useReadAlong.paced.test.tsx
git commit -m "feat(frontend): let useReadAlong follow a pacer for silent reading" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 12: Reading-mode and pace preferences

The Start button's main click has to remember sound versus silent, and the pacer has to remember its speed. Both go beside the existing read-along preferences with the same `localStorage` pattern, and the pace menu's options become a shared constant.

**Files:**
- Modify: `frontend/src/constants/audio.ts`
- Modify: `frontend/src/constants/__tests__/audio.test.ts`
- Modify: `frontend/src/hooks/useReadAlongPreferences.ts`
- Modify: `frontend/src/hooks/__tests__/useReadAlongPreferences.test.ts`

**Interfaces:**
- Consumes: `HighlightMode` from `./useReadAlong` (unchanged).
- Produces:
  - `WPM_OPTIONS: readonly number[]` (`[150, 200, 250, 300, 400]`) and `DEFAULT_WPM` (`250`) from `constants/audio.ts`.
  - `type ReadingMode = "sound" | "silent"`, exported from `hooks/useReadAlongPreferences.ts`.
  - `useReadAlongPreferences()` also returns `readingMode: ReadingMode` (default `"silent"`, key `readAlong.readingMode`), `setReadingMode(value)`, `wpm: number` (always one of `WPM_OPTIONS`, default `DEFAULT_WPM`, key `readAlong.wpm`) and `setWpm(value)`, which ignores a value that is not in `WPM_OPTIONS`.

- [ ] **Step 1: Red — the options and the two preferences**

In `frontend/src/constants/__tests__/audio.test.ts` (4-space) make two edits.

1. Replace:

```ts
import { PLAYBACK_SPEEDS } from "../audio";
```

with:

```ts
import { DEFAULT_WPM, PLAYBACK_SPEEDS, WPM_OPTIONS } from "../audio";
```

2. Replace:

```ts
        expect(PLAYBACK_SPEEDS).toContain(1);
    });
});
```

with:

```ts
        expect(PLAYBACK_SPEEDS).toContain(1);
    });
});

describe("WPM_OPTIONS", () => {
    it("lists the silent-reading paces in words per minute", () => {
        expect([...WPM_OPTIONS]).toEqual([150, 200, 250, 300, 400]);
    });

    it("offers the default pace", () => {
        expect(DEFAULT_WPM).toBe(250);
        expect(WPM_OPTIONS).toContain(DEFAULT_WPM);
    });
});
```

In `frontend/src/hooks/__tests__/useReadAlongPreferences.test.ts` (4-space) make two edits.

1. Replace:

```ts
import { renderHook, act } from "@testing-library/react";
import { useReadAlongPreferences } from "../useReadAlongPreferences";
```

with:

```ts
import { renderHook, act } from "@testing-library/react";
import { WPM_OPTIONS } from "../../constants/audio";
import { useReadAlongPreferences } from "../useReadAlongPreferences";
```

2. Replace the end of the file (the last existing test and the closing of the `describe`):

```ts
            setItem.mockRestore();
        }
    });
});
```

with:

```ts
            setItem.mockRestore();
        }
    });

    it("defaults to silent reading at 250 words per minute", () => {
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.readingMode).toBe("silent");
        expect(result.current.wpm).toBe(250);
    });

    it("remembers the reading mode without touching the other preferences", () => {
        const first = renderHook(() => useReadAlongPreferences());
        act(() => first.result.current.setReadingMode("sound"));

        expect(first.result.current.readingMode).toBe("sound");
        expect(first.result.current.highlight).toBe(true);
        expect(first.result.current.wpm).toBe(250);
        expect(localStorage.getItem("readAlong.readingMode")).toBe("sound");
        expect(localStorage.getItem("readAlong.highlight")).toBeNull();
        expect(localStorage.getItem("readAlong.autoScroll")).toBeNull();
        expect(localStorage.getItem("readAlong.highlightMode")).toBeNull();
        expect(localStorage.getItem("readAlong.wpm")).toBeNull();
        first.unmount();

        const second = renderHook(() => useReadAlongPreferences());
        expect(second.result.current.readingMode).toBe("sound");
    });

    it("switches back to silent reading", () => {
        localStorage.setItem("readAlong.readingMode", "sound");
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.readingMode).toBe("sound");

        act(() => result.current.setReadingMode("silent"));

        expect(result.current.readingMode).toBe("silent");
        expect(localStorage.getItem("readAlong.readingMode")).toBe("silent");
    });

    it("uses silent reading when the stored mode is invalid", () => {
        localStorage.setItem("readAlong.readingMode", "invalid");
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.readingMode).toBe("silent");
    });

    it("remembers the pace without touching the reading mode", () => {
        const first = renderHook(() => useReadAlongPreferences());
        act(() => first.result.current.setWpm(300));

        expect(first.result.current.wpm).toBe(300);
        expect(first.result.current.readingMode).toBe("silent");
        expect(localStorage.getItem("readAlong.wpm")).toBe("300");
        expect(localStorage.getItem("readAlong.readingMode")).toBeNull();
        first.unmount();

        const second = renderHook(() => useReadAlongPreferences());
        expect(second.result.current.wpm).toBe(300);
    });

    it("reads back every pace the speed menu offers", () => {
        for (const wpm of WPM_OPTIONS) {
            localStorage.setItem("readAlong.wpm", String(wpm));
            const { result, unmount } = renderHook(() => useReadAlongPreferences());
            expect(result.current.wpm).toBe(wpm);
            unmount();
        }
    });

    it.each(["fast", "", "0", "-250", "275", "300.5", "Infinity", "NaN"])(
        "uses the default pace when the stored value is %j",
        (stored) => {
            localStorage.setItem("readAlong.wpm", stored);
            const { result } = renderHook(() => useReadAlongPreferences());
            expect(result.current.wpm).toBe(250);
        }
    );

    it("ignores a pace the speed menu does not offer", () => {
        const { result } = renderHook(() => useReadAlongPreferences());
        act(() => result.current.setWpm(275));

        expect(result.current.wpm).toBe(250);
        expect(localStorage.getItem("readAlong.wpm")).toBeNull();
    });

    it("falls back to silent reading at the default pace when storage reads throw", () => {
        const getItem = vi
            .spyOn(Storage.prototype, "getItem")
            .mockImplementation(() => {
                throw new Error("storage disabled");
            });
        try {
            const { result } = renderHook(() => useReadAlongPreferences());
            expect(result.current.readingMode).toBe("silent");
            expect(result.current.wpm).toBe(250);
        } finally {
            getItem.mockRestore();
        }
    });

    it("swallows write failures for the reading mode and the pace", () => {
        const setItem = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("storage disabled");
            });
        try {
            const { result } = renderHook(() => useReadAlongPreferences());
            expect(() => act(() => result.current.setReadingMode("sound"))).not.toThrow();
            expect(() => act(() => result.current.setWpm(400))).not.toThrow();
            expect(result.current.readingMode).toBe("sound");
            expect(result.current.wpm).toBe(400);
        } finally {
            setItem.mockRestore();
        }
    });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/constants/__tests__/audio.test.ts src/hooks/__tests__/useReadAlongPreferences.test.ts
```

Expected: FAIL, 19 tests. The 2 new constants tests fail with `TypeError: WPM_OPTIONS is not iterable` and `AssertionError: expected undefined to be 250`. The 17 new preference tests fail with `AssertionError: expected undefined to be 'silent'`, `AssertionError: expected undefined to be 250`, `TypeError: first.result.current.setReadingMode is not a function`, `TypeError: first.result.current.setWpm is not a function` and `TypeError: WPM_OPTIONS is not iterable`. The 10 tests that already existed (1 constants, 9 preferences) still pass. `pnpm exec tsc -b` agrees: `error TS2305: Module '"../audio"' has no exported member 'WPM_OPTIONS'.` and `error TS2339: Property 'readingMode' does not exist on type 'ReadAlongPreferences'.`

- [ ] **Step 2: Green — the options and the two preferences**

In `frontend/src/constants/audio.ts` (4-space) replace:

```ts
export const PLAYBACK_SPEEDS: readonly number[] = [0.5, 1, 1.2, 1.5, 2, 2.5, 3];
```

with:

```ts
export const PLAYBACK_SPEEDS: readonly number[] = [0.5, 1, 1.2, 1.5, 2, 2.5, 3];

/** Silent-reading paces (words per minute) offered by the pacer's speed menu. */
export const WPM_OPTIONS: readonly number[] = [150, 200, 250, 300, 400];

/**
 * Pace a reader starts at, and always one of `WPM_OPTIONS`. It is the user's default, not
 * the pace word timings are built at: that is `BASE_WPM` in `utils/pacedTimings.ts`.
 */
export const DEFAULT_WPM = 250;
```

In `frontend/src/hooks/useReadAlongPreferences.ts` (4-space) make six edits.

1. Replace the header comment, the imports and the key constants:

```ts
/**
 * Per-device read-along preferences persisted in localStorage.
 * Unset keys read as `true` (both default on).
 */

import { useCallback, useState } from "react";
import type { HighlightMode } from "./useReadAlong";

const HIGHLIGHT_KEY = "readAlong.highlight";
const AUTO_SCROLL_KEY = "readAlong.autoScroll";
const MODE_KEY = "readAlong.highlightMode";
```

with:

```ts
/**
 * Per-device read-along preferences persisted in localStorage.
 * Unset toggles read as `true` (both default on), an unset reading mode as `"silent"` and an
 * unset or unknown pace as `DEFAULT_WPM`.
 */

import { useCallback, useState } from "react";
import { DEFAULT_WPM, WPM_OPTIONS } from "../constants/audio";
import type { HighlightMode } from "./useReadAlong";

export type ReadingMode = "sound" | "silent";

const HIGHLIGHT_KEY = "readAlong.highlight";
const AUTO_SCROLL_KEY = "readAlong.autoScroll";
const MODE_KEY = "readAlong.highlightMode";
const READING_MODE_KEY = "readAlong.readingMode";
const WPM_KEY = "readAlong.wpm";
```

2. Add the two readers above `readPref`. Replace:

```ts
function readPref(key: string): boolean {
```

with:

```ts
function readReadingMode(): ReadingMode {
    try {
        return localStorage.getItem(READING_MODE_KEY) === "sound" ? "sound" : "silent";
    } catch {
        return "silent";
    }
}

function readWpm(): number {
    try {
        const stored = Number(localStorage.getItem(WPM_KEY));
        return WPM_OPTIONS.includes(stored) ? stored : DEFAULT_WPM;
    } catch {
        return DEFAULT_WPM;
    }
}

function readPref(key: string): boolean {
```

3. Let `writePref` store the new value types. Replace:

```ts
function writePref(key: string, value: boolean | HighlightMode): void {
```

with:

```ts
function writePref(key: string, value: boolean | number | HighlightMode | ReadingMode): void {
```

4. Extend the result type. Replace:

```ts
    highlightMode: HighlightMode;
    setHighlightMode: (value: HighlightMode) => void;
}
```

with:

```ts
    highlightMode: HighlightMode;
    setHighlightMode: (value: HighlightMode) => void;
    readingMode: ReadingMode;
    setReadingMode: (value: ReadingMode) => void;
    /** Silent-reading pace; always one of `WPM_OPTIONS`. */
    wpm: number;
    /** Ignores a pace that is not in `WPM_OPTIONS`, so whatever is stored reads back. */
    setWpm: (value: number) => void;
}
```

5. Add the two pieces of state. Replace:

```ts
    const [highlightMode, setHighlightModeState] = useState(readMode);
```

with:

```ts
    const [highlightMode, setHighlightModeState] = useState(readMode);
    const [readingMode, setReadingModeState] = useState(readReadingMode);
    const [wpm, setWpmState] = useState(readWpm);
```

6. Add the setters and return the new fields. Replace:

```ts
    return { highlight, setHighlight, autoScroll, setAutoScroll, highlightMode, setHighlightMode };
```

with:

```ts
    const setReadingMode = useCallback((value: ReadingMode) => {
        setReadingModeState(value);
        writePref(READING_MODE_KEY, value);
    }, []);

    const setWpm = useCallback((value: number) => {
        if (!WPM_OPTIONS.includes(value)) return;
        setWpmState(value);
        writePref(WPM_KEY, value);
    }, []);

    return {
        highlight,
        setHighlight,
        autoScroll,
        setAutoScroll,
        highlightMode,
        setHighlightMode,
        readingMode,
        setReadingMode,
        wpm,
        setWpm,
    };
```

Why it is shaped this way:

- A stored pace is accepted only if it is in `WPM_OPTIONS`, not "any positive number": a hand-edited `0`, negative or `Infinity` would otherwise reach the pacer as a zero, negative or unbounded rate. A value that is not on the menu falls back to the default rather than being rounded to a neighbour. The test list uses `"300.5"` rather than `"250.5"` on purpose: truncating `"250.5"` gives the default, so it could not tell a `parseInt` read from a strict one.
- `setWpm` ignores values outside `WPM_OPTIONS`, so the rule holds in memory as well as in storage; otherwise an off-menu pace would show until the next reload and then silently revert.
- The default reading mode is silent because the operator's external TTS is off by default (`external_tts_enabled = False`), so a first-time "read with sound" would end in a 403 `EXTERNAL_PROCESSING_DISABLED`.
- `DEFAULT_WPM` (where a reader starts) and `BASE_WPM` (the pace `buildPacedTimings` builds timings at, Task 10) stay separate on purpose. The pacer's rate is `wpm / BASE_WPM`, so changing the default must not re-time any article.

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/constants/__tests__/audio.test.ts src/hooks/__tests__/useReadAlongPreferences.test.ts
```

Expected: PASS, 2 files and 29 tests (3 in `audio.test.ts`, 26 in the preferences suite).

- [ ] **Step 3: Verify the task**

```bash
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
```

Expected: `tsc -b` prints nothing (`PostDetailPage` is the only consumer of `useReadAlongPreferences` and it still compiles, because the hook only gained fields). `pnpm lint` reports no new warnings. Do not run prettier over these four files: they are 4-space and not prettier-formatted, so keep their indentation.

- [ ] **Step 4: Commit (only if the user asked for commits)**

```bash
git add frontend/src/constants/audio.ts frontend/src/constants/__tests__/audio.test.ts frontend/src/hooks/useReadAlongPreferences.ts frontend/src/hooks/__tests__/useReadAlongPreferences.test.ts
git commit -m "feat(frontend): remember the reading mode and the silent-reading pace" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 13: `usePacer` — React state around the pacer clock

`PacerClock` (Task 10) is plain TypeScript. This task wraps it in a hook that owns its lifecycle and mirrors it as React state: `PacerControls` (Task 16) and the page (Task 17) read `status` and `fraction` and call `play`, `pause` and `seekToFraction`, while `useReadAlong` and `useReadingProgress` talk to the very same clock object through `getClock()`.

**Files:**
- Create: `frontend/src/hooks/usePacer.ts`
- Create: `frontend/src/hooks/__tests__/usePacer.test.tsx`

**Interfaces:**
- Consumes: `PacerClock`, `BASE_WPM`, `MediaClock` and `MediaClockEvent` from Task 10. The pace comes from the caller as an argument: Task 17 passes `readAlongPrefs.wpm` (Task 12), so the stored preference stays the only source of truth and the hook keeps no second copy.
- Produces: `usePacer(wpm: number): UsePacerResult`, where `UsePacerResult` is `{ status: "playing" | "paused"; isPlaying; positionMs; durationMs; fraction /* 0 to 1 */; setDurationMs(ms); play(); pause(); toggle(); seekToFraction(fraction); stop(); getClock(): MediaClock | null }`. `getClock` is stable, creates the clock on first use and returns `null` after unmount. Tasks 15, 16 and 17 consume it.

These are new files, so they use the project's prettier style (2-space).

- [ ] **Step 1: Red — the hook's behaviour**

Create `frontend/src/hooks/__tests__/usePacer.test.tsx`:

```tsx
import { StrictMode, useEffect, useLayoutEffect } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaClock } from "../../utils/mediaClock";
import { usePacer } from "../usePacer";

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

/** Mounts the hook at the given pace and gives it a timeline of `durationMs`. */
function setup(wpm = 250, durationMs = 10_000) {
  const hook = renderHook(({ pace }) => usePacer(pace), { initialProps: { pace: wpm } });
  act(() => hook.result.current.setDurationMs(durationMs));
  return hook;
}

describe("usePacer", () => {
  it("starts paused at the beginning of the timeline", () => {
    const { result } = setup();

    expect(result.current.status).toBe("paused");
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.positionMs).toBe(0);
    expect(result.current.durationMs).toBe(10_000);
    expect(result.current.fraction).toBe(0);
  });

  it("reads in real time at 250 words per minute", () => {
    const { result } = setup();

    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
    expect(result.current.isPlaying).toBe(true);

    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.pause());

    expect(result.current.status).toBe("paused");
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.positionMs).toBe(2000);
    expect(result.current.fraction).toBeCloseTo(0.2, 10);
  });

  it("follows the position while it reads, not only when it pauses", () => {
    const { result } = setup();

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.positionMs).toBeGreaterThan(500);
    expect(result.current.positionMs).toBeLessThanOrEqual(1000);
  });

  it("reports its position in whole milliseconds", () => {
    const { result } = setup();

    act(() => result.current.seekToFraction(1 / 3));

    expect(result.current.positionMs).toBe(3333);
  });

  it("reads twice as fast at 500 words per minute", () => {
    const { result } = setup(500);

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.pause());

    expect(result.current.positionMs).toBe(2000);
  });

  it("uses a pace chosen before it first plays", () => {
    const hook = setup(250);
    hook.rerender({ pace: 500 });

    act(() => hook.result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    act(() => hook.result.current.pause());

    expect(hook.result.current.positionMs).toBe(2000);
  });

  it("follows a pace change made while reading without jumping", () => {
    const hook = setup(250);

    act(() => hook.result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    hook.rerender({ pace: 500 });
    act(() => vi.advanceTimersByTime(1000));
    act(() => hook.result.current.pause());

    expect(hook.result.current.positionMs).toBe(3000);
  });

  it("toggles between reading and paused", () => {
    const { result } = setup();

    act(() => result.current.toggle());
    expect(result.current.status).toBe("playing");

    act(() => result.current.toggle());
    expect(result.current.status).toBe("paused");
  });

  it("seeks to a fraction of the timeline and stays paused", () => {
    const { result } = setup();

    act(() => result.current.seekToFraction(0.5));

    expect(result.current.positionMs).toBe(5000);
    expect(result.current.fraction).toBe(0.5);
    expect(result.current.status).toBe("paused");
  });

  it.each([
    [-0.5, 0],
    [1.5, 10_000],
  ])("clamps a seek to %s into the timeline", (fraction, expectedMs) => {
    const { result } = setup();
    act(() => result.current.seekToFraction(0.5));

    act(() => result.current.seekToFraction(fraction));

    expect(result.current.positionMs).toBe(expectedMs);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("ignores a seek to %s", (fraction) => {
    const { result } = setup();
    act(() => result.current.seekToFraction(0.5));

    act(() => result.current.seekToFraction(fraction));

    expect(result.current.positionMs).toBe(5000);
  });

  it("does not play when there is nothing to read", () => {
    const { result } = setup(250, 0);

    act(() => result.current.play());

    expect(result.current.status).toBe("paused");
    expect(result.current.fraction).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops at the end of the timeline and starts over when played again", () => {
    const { result } = setup(250, 2000);

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(2500));

    expect(result.current.status).toBe("paused");
    expect(result.current.positionMs).toBe(2000);
    expect(result.current.fraction).toBe(1);

    act(() => result.current.play());

    expect(result.current.status).toBe("playing");
    expect(result.current.positionMs).toBe(0);
  });

  it("stops by pausing and going back to the start", () => {
    const { result } = setup();
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1500));

    act(() => result.current.stop());

    expect(result.current.status).toBe("paused");
    expect(result.current.positionMs).toBe(0);
    expect(result.current.fraction).toBe(0);

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.pause());

    expect(result.current.positionMs).toBe(500);
  });

  it("follows a pause the clock makes by itself when the tab is hidden", () => {
    const { result } = setup();
    act(() => result.current.play());

    act(() => setVisibility("hidden"));

    expect(result.current.status).toBe("paused");
  });

  it("hands out the same clock for as long as it is mounted", () => {
    const hook = setup();
    const clock = hook.result.current.getClock();

    hook.rerender({ pace: 300 });

    expect(clock).not.toBeNull();
    expect(hook.result.current.getClock()).toBe(clock);
    expect(clock?.currentTime).toBe(0);
    expect(clock?.paused).toBe(true);
  });

  it("keeps a timeline length that was set before its clock existed", () => {
    const { result } = renderHook(() => {
      const pacer = usePacer(250);
      const { setDurationMs } = pacer;
      // A layout effect runs before any passive effect could have created the clock.
      useLayoutEffect(() => setDurationMs(4000), [setDurationMs]);
      return pacer;
    });

    act(() => result.current.seekToFraction(0.5));

    expect(result.current.positionMs).toBe(2000);
  });

  it("takes a new timeline length after its clock exists", () => {
    const { result } = setup(250, 10_000);
    act(() => result.current.seekToFraction(0.1));

    act(() => result.current.setDurationMs(2000));
    act(() => result.current.seekToFraction(0));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(2500));

    expect(result.current.positionMs).toBe(2000);
    expect(result.current.status).toBe("paused");
  });

  it("never reports more than the whole timeline when the timeline gets shorter", () => {
    const { result } = setup();
    act(() => result.current.seekToFraction(0.5));

    act(() => result.current.setDurationMs(2000));

    expect(result.current.fraction).toBe(1);
  });

  it("releases its clock when it unmounts", () => {
    const { result, unmount } = setup();
    act(() => result.current.play());
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.getClock()).toBeNull();

    result.current.play();
    result.current.toggle();
    result.current.pause();
    result.current.seekToFraction(0.5);
    result.current.stop();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("replaces its clock after React's strict-mode remount and keeps the new one live", () => {
    const seen: Array<MediaClock | null> = [];
    const { result } = renderHook(
      () => {
        const pacer = usePacer(250);
        const { getClock } = pacer;
        useEffect(() => {
          seen.push(getClock());
        }, [getClock]);
        return pacer;
      },
      { wrapper: StrictMode }
    );
    act(() => result.current.setDurationMs(10_000));

    // Strict mode runs the mount effects, cleans them up and runs them again.
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
    expect(result.current.getClock()).toBe(seen[1]);

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    act(() => setVisibility("hidden"));

    expect(result.current.status).toBe("paused");
    expect(result.current.positionMs).toBe(1000);
    expect(seen[1]?.currentTime).toBe(1);
  });
});
```

`vi.useFakeTimers()` also fakes `performance.now()` and `requestAnimationFrame`, which is what the real `PacerClock` reads by default. So these tests drive the real clock with `vi.advanceTimersByTime` and need no injected scheduler.

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/usePacer.test.tsx
```

Expected: FAIL, the suite cannot load: `Failed to resolve import "../usePacer" from "src/hooks/__tests__/usePacer.test.tsx". Does the file exist?`

- [ ] **Step 2: Green — the hook**

Create `frontend/src/hooks/usePacer.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaClock, MediaClockEvent } from "../utils/mediaClock";
import { BASE_WPM } from "../utils/pacedTimings";
import { PacerClock } from "../utils/pacerClock";

export type PacerStatus = "playing" | "paused";

export interface UsePacerResult {
  status: PacerStatus;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  /** How far through the timeline the pacer is, from 0 to 1. */
  fraction: number;
  setDurationMs: (durationMs: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Moves to a fraction of the timeline (0 to 1) without changing play or pause. */
  seekToFraction: (fraction: number) => void;
  /** Pauses and goes back to the start. */
  stop: () => void;
  /** A stable accessor for the clock. It is null once the hook has unmounted. */
  getClock: () => MediaClock | null;
}

// Pausing and reaching the end emit "timeupdate" once the clock has stopped, so
// the mirrored state needs no listener for "pause".
const SYNC_EVENTS: readonly MediaClockEvent[] = ["play", "timeupdate"];

/**
 * Owns the `PacerClock` that paces silent reading and mirrors it as React state.
 * The clock is created on first use, so a strict-mode remount just creates a new
 * one, and it is released when the component unmounts. `wpm` sets how fast it
 * reads: the timeline is built at `BASE_WPM` and the clock rate is `wpm / BASE_WPM`.
 */
export function usePacer(wpm: number): UsePacerResult {
  const [status, setStatus] = useState<PacerStatus>("paused");
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMsState] = useState(0);

  const clockRef = useRef<PacerClock | null>(null);
  const retiredRef = useRef(false);
  const durationRef = useRef(0);
  const rateRef = useRef(wpm / BASE_WPM);

  const ensureClock = useCallback((): PacerClock | null => {
    if (retiredRef.current) return null;
    if (clockRef.current === null) {
      const clock = new PacerClock();
      clock.setDurationMs(durationRef.current);
      clock.setRate(rateRef.current);
      const sync = () => {
        setStatus(clock.paused ? "paused" : "playing");
        setPositionMs(Math.round(clock.currentTime * 1000));
      };
      SYNC_EVENTS.forEach((type) => clock.addEventListener(type, sync));
      clockRef.current = clock;
    }
    return clockRef.current;
  }, []);

  useEffect(() => {
    retiredRef.current = false;
    return () => {
      retiredRef.current = true;
      clockRef.current?.dispose();
      clockRef.current = null;
    };
  }, []);

  useEffect(() => {
    rateRef.current = wpm / BASE_WPM;
    clockRef.current?.setRate(rateRef.current);
  }, [wpm]);

  const setDurationMs = useCallback((next: number) => {
    durationRef.current = next;
    setDurationMsState(next);
    clockRef.current?.setDurationMs(next);
  }, []);

  const play = useCallback(() => ensureClock()?.play(), [ensureClock]);

  const pause = useCallback(() => clockRef.current?.pause(), []);

  const toggle = useCallback(() => {
    const clock = ensureClock();
    if (clock === null) return;
    if (clock.paused) clock.play();
    else clock.pause();
  }, [ensureClock]);

  const seekToFraction = useCallback(
    (fraction: number) => {
      if (!Number.isFinite(fraction)) return;
      ensureClock()?.seek((fraction * durationRef.current) / 1000);
    },
    [ensureClock]
  );

  const stop = useCallback(() => {
    const clock = clockRef.current;
    if (clock === null) return;
    clock.pause();
    clock.seek(0);
  }, []);

  return {
    status,
    isPlaying: status === "playing",
    positionMs,
    durationMs,
    fraction: durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0,
    setDurationMs,
    play,
    pause,
    toggle,
    seekToFraction,
    stop,
    getClock: ensureClock,
  };
}
```

Why it is shaped this way:

- The clock is created on first use, not with `useRef(new PacerClock())`. The `PacerClock` constructor registers a `visibilitychange` listener on `document`, and an eager `useRef(...)` argument is evaluated on every render, so it would build and leak a clock per render. Created on demand, React's strict-mode "mount, clean up, mount again" sorts itself out: the cleanup disposes the first clock and clears the ref, and the next `getClock()` builds a fresh one.
- `retiredRef` is what makes `getClock()` return `null` after a real unmount. Without it, a late callback (a timer, a promise continuation) that calls `play()` would quietly build a new clock that nobody ever disposes. The mount effect sets the flag back to `false` so the strict-mode remount above can create a clock again.
- The state listeners are attached when the clock is created, not in an effect: a child hook's effect (`useReadAlong` asking for `getClock()`) can be the one that creates it, after this hook's own effects have already run.
- `status` and `positionMs` come from clock events instead of being set inside `play()` and `pause()`. `play()` is a no-op with an empty timeline, so setting state optimistically would claim "playing" for a clock that never started. `pause()` and the end of the timeline emit `timeupdate` after the clock has stopped (Task 10), so listening for `play` and `timeupdate` is enough.
- `durationRef` and `rateRef` carry the timeline length and the pace into a clock that does not exist yet. `Math.round` keeps `positionMs` a whole number of milliseconds (`currentTime` is floating-point seconds).
- `fraction` is clamped to 1 because `positionMs` is only refreshed by clock events: if the timeline gets shorter, the last known position can briefly be past the new end.

Run the Step 1 command again. Expected: PASS, 23 tests.

- [ ] **Step 3: Verify the task**

```bash
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check src/hooks/usePacer.ts src/hooks/__tests__/usePacer.test.tsx
```

Expected: `tsc -b` prints nothing; `pnpm lint` reports no new warnings (it already prints 4 older ones: `AuthContext.tsx`, `usePostsData.ts` exhaustive-deps, and `theme.tsx` twice); prettier accepts both new files (if it flags one, run `pnpm exec prettier --write` on that new file only).

- [ ] **Step 4: Commit (only if the user asked for commits)**

```bash
git add frontend/src/hooks/usePacer.ts frontend/src/hooks/__tests__/usePacer.test.tsx
git commit -m "feat(frontend): add usePacer to own and mirror the silent-reading clock" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 14: `useReadingProgress` — turn playback into reading progress

Both clocks from Task 10 (the audio element and the pacer) report a position. This task turns that position into reading progress and tells the server. It is split in two so the decisions can be tested without React: `ReadingProgressTracker` (plain TypeScript) decides how much has been read and when a report may go out, and `useReadingProgress` is the adapter that feeds it clock positions and page-visibility events and supplies the HTTP call.

**Files:**
- Create: `frontend/src/utils/readingProgressTracker.ts`
- Create: `frontend/src/utils/__tests__/readingProgressTracker.test.ts`
- Create: `frontend/src/hooks/useReadingProgress.ts`
- Create: `frontend/src/hooks/__tests__/useReadingProgress.test.tsx`

**Interfaces:**
- Consumes: `wholePercent` (Task 8); `api.put(path, body, { keepalive })` (Task 9) and `ApiError` from `services/api.ts`; `MediaClock` and `MediaClockEvent` (Task 10); the server's `PUT /posts/{id}/progress` (Task 6), which answers `{ postId, isRead, readProgress, readAt }` and turns an over-limit caller away with a 429 whose `details.retryAfter` is in seconds.
- Produces:
  - `ReadingProgressTracker` with `rebase(seconds)`, `advance(seconds, durationSeconds)`, `flush({ keepalive? })` and `reset(0 | 1)`, plus the constants `PROGRESS_FLUSH_INTERVAL_MS` (10 s) and `MAX_CREDIT_STEP_SECONDS` (5 s) and the types `ProgressReport`, `SendOutcome` and `SendProgress`.
  - `useReadingProgress(args): { reset(next: 0 | 1): void }`, where `args` is `{ postId, initialProgress, enabled, clockKey, getClock, getDurationSeconds, onUpdate }`.
  - The contract Task 17 has to meet when it calls the hook:
    - `enabled` is true only while there is something to track for this post: the page holds the data for `postId` itself (it does not clear `post` when `postId` changes, so check `post?.id === postId` before trusting `post.readProgress`), the article is not already read, and a clock exists that can play.
    - `initialProgress` is the server's `readProgress` for that post. It is read once, when tracking starts for the post.
    - `clockKey` changes whenever `getClock()` would return a different clock, for example `silentActive ? "silent" : "audio"`.
    - `getDurationSeconds()` is the length of the active clock's timeline in seconds (silent: `pacedDurationMs / 1000`; audio: `player.durationSeconds ?? 0`). A zero or unknown length credits nothing.
    - `onUpdate` copies each report the server accepted onto the page's post (`readProgress` and `isRead`). A manual read or unread toggle calls `reset(1)` or `reset(0)`.

These are new files, so they use the project's prettier style (2-space).

- [ ] **Step 1: Red — the tracker's rules**

Create `frontend/src/utils/__tests__/readingProgressTracker.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CREDIT_STEP_SECONDS,
  PROGRESS_FLUSH_INTERVAL_MS,
  ReadingProgressTracker,
} from "../readingProgressTracker";
import type { ProgressReport, SendOutcome } from "../readingProgressTracker";

interface SentRequest {
  progress: number;
  keepalive: boolean;
  respond: (outcome: SendOutcome) => Promise<void>;
  fail: (error: unknown) => Promise<void>;
}

// Lets the tracker's promise callbacks run before the test looks at the result.
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const saved = (readProgress: number, isRead = false): SendOutcome => ({
  kind: "saved",
  report: { readProgress, isRead },
});

/** A tracker whose clock and server are driven by the test. */
function setup(initialProgress = 0) {
  let time = 0;
  const requests: SentRequest[] = [];
  const updates: ProgressReport[] = [];
  const tracker = new ReadingProgressTracker({
    initialProgress,
    now: () => time,
    onUpdate: (report) => updates.push(report),
    send: (progress, options) =>
      new Promise<SendOutcome>((resolve, reject) => {
        requests.push({
          progress,
          keepalive: options.keepalive,
          respond: async (outcome) => {
            resolve(outcome);
            await nextTurn();
          },
          fail: async (error) => {
            reject(error);
            await nextTurn();
          },
        });
      }),
  });
  return {
    tracker,
    requests,
    updates,
    sent: () => requests.map((request) => request.progress),
    at: (ms: number) => {
      time = ms;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReadingProgressTracker crediting", () => {
  it("sends nothing while the position is under one percent", () => {
    const { tracker, requests } = setup();
    tracker.rebase(0);
    tracker.advance(0.9, 100);
    expect(requests).toHaveLength(0);
  });

  it("sends the first whole percent straight away", () => {
    const { tracker, requests, sent } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    expect(sent()).toEqual([0.01]);
    expect(requests[0].keepalive).toBe(false);
  });

  it("sends the exact fraction, not the rounded percent", () => {
    const { tracker, sent } = setup();
    tracker.rebase(0);
    tracker.advance(1, 3);
    expect(sent()).toEqual([1 / 3]);
  });

  it("credits the position, not the time spent", () => {
    const { tracker, sent } = setup();
    tracker.rebase(40);
    tracker.advance(41, 100);
    expect(sent()).toEqual([0.41]);
  });

  it("keeps the high-water mark when the reader moves back", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(40);
    tracker.advance(41, 100);
    await requests[0].fail(new Error("offline"));

    at(10_000);
    tracker.rebase(10);
    tracker.advance(11, 100);
    expect(sent()).toEqual([0.41, 0.41]);
  });

  it("credits a step of exactly five seconds", () => {
    const { tracker, sent } = setup();
    tracker.rebase(0);
    tracker.advance(5, 100);
    expect(sent()).toEqual([0.05]);
  });

  it("treats a step above five seconds as a jump and credits nothing", () => {
    const { tracker, requests } = setup();
    tracker.rebase(0);
    tracker.advance(5.001, 100);
    expect(requests).toHaveLength(0);
  });

  it("credits again from the new position after a jump", () => {
    const { tracker, sent } = setup();
    tracker.rebase(0);
    tracker.advance(60, 100);
    tracker.advance(61, 100);
    expect(sent()).toEqual([0.61]);
  });

  it("credits nothing for a zero or backwards step", () => {
    const { tracker, requests } = setup();
    tracker.rebase(70);
    tracker.advance(70, 100);
    tracker.advance(69, 100);
    expect(requests).toHaveLength(0);
  });

  it("treats the first update without a baseline as a rebase", () => {
    const { tracker, requests, sent } = setup();
    tracker.advance(3, 100);
    expect(requests).toHaveLength(0);

    tracker.advance(4, 100);
    expect(sent()).toEqual([0.04]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "credits nothing, and poisons nothing, for a duration of %s",
    (duration) => {
      const { tracker, requests, sent } = setup();
      tracker.rebase(10);
      tracker.advance(11, duration);
      expect(requests).toHaveLength(0);

      tracker.advance(12, 100);
      expect(sent()).toEqual([0.12]);
    }
  );

  it("clamps the credited fraction to one", () => {
    const { tracker, sent } = setup();
    tracker.rebase(98);
    tracker.advance(101, 100);
    expect(sent()).toEqual([1]);
  });

  it("treats a stored progress as already sent", () => {
    const { tracker, requests, sent } = setup(0.5);
    tracker.rebase(49);
    tracker.advance(50, 100);
    tracker.flush();
    expect(requests).toHaveLength(0);

    tracker.advance(51, 100);
    expect(sent()).toEqual([0.51]);
  });
});

describe("ReadingProgressTracker when it sends", () => {
  it("keeps requests at least ten seconds apart", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));

    at(9_999);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);

    at(10_000);
    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("sends a held-back rise on the next update, even one that credits nothing", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));

    at(5_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);

    at(10_000);
    tracker.advance(2, 100);
    expect(sent()).toEqual([0.01, 0.02]);
  });

  it("sends only when the whole percent has risen", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));

    at(10_000);
    tracker.advance(1.9, 100);
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["by default", undefined, false],
    ["when asked", { keepalive: true }, true],
  ])(
    "lets a forced flush skip the spacing and pass keepalive %s",
    async (_when, options, keepalive) => {
      const { tracker, requests, at } = setup();
      tracker.rebase(0);
      tracker.advance(1, 100);
      await requests[0].respond(saved(0.01));

      at(1_000);
      tracker.advance(2, 100);
      expect(requests).toHaveLength(1);

      tracker.flush(options);
      expect(requests).toHaveLength(2);
      expect(requests[1].progress).toBe(0.02);
      expect(requests[1].keepalive).toBe(keepalive);
    }
  );

  it("sends nothing on a forced flush when nothing is new", async () => {
    const { tracker, requests } = setup();
    tracker.flush();
    expect(requests).toHaveLength(0);

    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));
    tracker.flush();
    expect(requests).toHaveLength(1);
  });

  it("keeps one request in flight at a time", () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);

    at(10_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);
  });

  it("sends a forced flush made during a request once the request settles", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    at(1_000);
    tracker.advance(2, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);

    await requests[0].respond(saved(0.01));
    expect(sent()).toEqual([0.01, 0.02]);
    expect(requests[1].keepalive).toBe(false);
  });

  it("uses a queued flush up once it has been sent", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    at(1_000);
    tracker.advance(2, 100);
    tracker.flush();
    await requests[0].respond(saved(0.01));
    expect(requests).toHaveLength(2);

    tracker.advance(3, 100);
    await requests[1].respond(saved(0.02));
    expect(requests).toHaveLength(2);
  });

  it("drops a queued flush that turns out to have nothing new", async () => {
    const { tracker, requests } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    tracker.flush();

    await requests[0].respond(saved(0.01));
    expect(requests).toHaveLength(1);
  });

  it("does not queue a regular update behind a slow request", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    at(10_000);
    tracker.advance(2, 100);

    await requests[0].respond(saved(0.01));
    expect(requests).toHaveLength(1);

    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("reads the time from performance.now unless it is given a clock", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const sent: number[] = [];
    const tracker = new ReadingProgressTracker({
      initialProgress: 0,
      onUpdate: () => {},
      send: (progress) => {
        sent.push(progress);
        return Promise.resolve(saved(progress));
      },
    });
    tracker.rebase(0);
    tracker.advance(1, 100);
    await nextTurn();

    now.mockReturnValue(9_999);
    tracker.advance(2, 100);
    now.mockReturnValue(10_000);
    tracker.advance(3, 100);
    expect(sent).toEqual([0.01, 0.03]);
  });
});

describe("ReadingProgressTracker answers", () => {
  it("hands a saved report to onUpdate", async () => {
    const { tracker, requests, updates } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));
    expect(updates).toEqual([{ readProgress: 0.01, isRead: false }]);
  });

  it("stops sending once the server says the article is read, whatever progress it reports", async () => {
    const { tracker, requests, updates, at } = setup();
    tracker.rebase(94);
    tracker.advance(95, 100);
    await requests[0].respond(saved(0.95, true));
    expect(updates).toEqual([{ readProgress: 0.95, isRead: true }]);

    at(10_000);
    tracker.advance(96, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);
  });

  it("takes the server's progress as what is saved", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.5));

    at(10_000);
    tracker.rebase(19);
    tracker.advance(20, 100);
    expect(requests).toHaveLength(1);
  });

  it("retries a failed attempt only after the spacing", async () => {
    const { tracker, requests, updates, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond({ kind: "failed" });
    expect(updates).toHaveLength(0);

    at(1_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);

    at(10_000);
    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("counts a rejected send as a failure", async () => {
    const { tracker, requests, updates, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].fail(new Error("offline"));
    expect(updates).toHaveLength(0);

    at(10_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(2);
  });

  it("waits out a rate limit from the moment it was answered, forced flushes included", async () => {
    const { tracker, requests, sent, at } = setup();
    at(5_000);
    tracker.rebase(0);
    tracker.advance(1, 100);
    at(8_000);
    await requests[0].respond({ kind: "rate-limited", retryAfterSeconds: 30 });

    at(37_999);
    tracker.advance(2, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);

    at(38_000);
    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("stops for good when told to stop", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond({ kind: "stop" });

    at(10_000);
    tracker.advance(2, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);
  });
});

describe("ReadingProgressTracker reset", () => {
  it("starts over after reset(0)", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(49);
    tracker.advance(50, 100);
    await requests[0].respond(saved(0.5));

    tracker.reset(0);
    at(10_000);
    tracker.rebase(0);
    tracker.advance(1, 100);
    expect(sent()).toEqual([0.5, 0.01]);
  });

  it("stays quiet after reset(1) because the article is read", () => {
    const { tracker, requests, at } = setup();
    tracker.reset(1);

    at(10_000);
    tracker.rebase(10);
    tracker.advance(11, 100);
    tracker.flush();
    expect(requests).toHaveLength(0);
  });

  it("resumes after reset(0) clears a stop", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond({ kind: "stop" });

    tracker.reset(0);
    at(10_000);
    tracker.advance(2, 100);
    expect(sent()).toEqual([0.01, 0.02]);
  });

  it("ignores a saved answer to a request sent before the reset", async () => {
    const { tracker, requests, updates, sent, at } = setup();
    tracker.rebase(49);
    tracker.advance(50, 100);
    tracker.reset(0);
    await requests[0].respond(saved(1, true));
    expect(updates).toHaveLength(0);

    at(10_000);
    tracker.rebase(0);
    tracker.advance(1, 100);
    expect(sent()).toEqual([0.5, 0.01]);
  });

  it("honors a rate limit that answers a request sent before the reset", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    tracker.reset(0);
    await requests[0].respond({ kind: "rate-limited", retryAfterSeconds: 30 });

    at(29_999);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);

    at(30_000);
    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("honors a stop that answers a request sent before the reset", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    tracker.reset(0);
    await requests[0].respond({ kind: "stop" });

    at(10_000);
    tracker.advance(2, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);
  });

  it("keeps one request in flight across a reset", () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    tracker.reset(0);

    at(10_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);
  });

  it("keeps a rate limit across a reset", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond({ kind: "rate-limited", retryAfterSeconds: 30 });

    tracker.reset(0);
    at(10_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);
  });

  it("drops a queued flush", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(49);
    tracker.advance(50, 100);
    tracker.flush();
    tracker.reset(0);

    at(10_000);
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.5));
    expect(requests).toHaveLength(1);
  });
});

describe("ReadingProgressTracker constants", () => {
  it("spaces requests ten seconds apart and credits at most five seconds a step", () => {
    expect(PROGRESS_FLUSH_INTERVAL_MS).toBe(10_000);
    expect(MAX_CREDIT_STEP_SECONDS).toBe(5);
  });
});
```

The tracker never touches the real clock in these tests: `now` is injected (`at(ms)` moves it), and `send` is a promise the test settles by hand with `respond` or `fail`. The one exception is the `performance.now` test, which checks the default.

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/utils/__tests__/readingProgressTracker.test.ts
```

Expected: FAIL, the suite cannot load: `Failed to resolve import "../readingProgressTracker" from "src/utils/__tests__/readingProgressTracker.test.ts". Does the file exist?`

- [ ] **Step 2: Green — the tracker**

Create `frontend/src/utils/readingProgressTracker.ts`:

```ts
import { wholePercent } from "./readingProgress";

/** Regular updates go out at most this often. Forced flushes (pause, hide, leave) ignore it. */
export const PROGRESS_FLUSH_INTERVAL_MS = 10_000;

/** A clock step bigger than this is a seek or a stall, not reading, so it earns no credit. */
export const MAX_CREDIT_STEP_SECONDS = 5;

export interface ProgressReport {
  readProgress: number;
  isRead: boolean;
}

export type SendOutcome =
  | { kind: "saved"; report: ProgressReport }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "stop" }
  | { kind: "failed" };

export type SendProgress = (
  progress: number,
  options: { keepalive: boolean }
) => Promise<SendOutcome>;

export interface ReadingProgressTrackerOptions {
  /** What the server already holds for this reader, 0..1. */
  initialProgress: number;
  send: SendProgress;
  /** Called with every report the server accepted for the current state. */
  onUpdate: (report: ProgressReport) => void;
  /** Milliseconds on any monotonic clock. Defaults to performance.now. */
  now?: () => number;
}

/**
 * Decides how much of an article has been read and when to tell the server.
 * It knows nothing about React, audio elements or HTTP: the hook feeds it clock
 * positions and supplies `send`.
 */
export class ReadingProgressTracker {
  private highWater: number;
  private sentPercent: number;
  private lastTime: number | null = null;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private blockedUntil = 0;
  private inFlight = false;
  private queued = false;
  private halted = false;
  private generation = 0;
  private readonly send: SendProgress;
  private readonly onUpdate: (report: ProgressReport) => void;
  private readonly now: () => number;

  constructor(options: ReadingProgressTrackerOptions) {
    this.highWater = options.initialProgress;
    this.sentPercent = wholePercent(options.initialProgress);
    this.send = options.send;
    this.onUpdate = options.onUpdate;
    this.now = options.now ?? (() => performance.now());
  }

  /** Moves the baseline without crediting anything: play, a seek, or attaching to a running clock. */
  rebase(timeSeconds: number): void {
    this.lastTime = timeSeconds;
  }

  /** The clock ticked. Credits the position when the step since the last tick looks like reading. */
  advance(timeSeconds: number, durationSeconds: number): void {
    const step = this.lastTime === null ? 0 : timeSeconds - this.lastTime;
    this.lastTime = timeSeconds;
    if (step > 0 && step <= MAX_CREDIT_STEP_SECONDS && durationSeconds > 0) {
      this.highWater = Math.max(this.highWater, Math.min(1, timeSeconds / durationSeconds));
    }
    this.attempt(false, false);
  }

  /** Sends now if there is something new, ignoring the spacing. For pause, hide and leave. */
  flush(options: { keepalive?: boolean } = {}): void {
    this.attempt(true, options.keepalive ?? false);
  }

  /** The reader marked the article read (1) or unread (0) by hand. */
  reset(next: 0 | 1): void {
    this.generation += 1;
    this.highWater = next;
    this.sentPercent = wholePercent(next);
    this.halted = false;
    this.queued = false;
  }

  private attempt(forced: boolean, keepalive: boolean): void {
    if (this.halted) return;
    if (wholePercent(this.highWater) <= this.sentPercent) return;
    const now = this.now();
    if (now < this.blockedUntil) return;
    if (!forced && now - this.lastAttemptAt < PROGRESS_FLUSH_INTERVAL_MS) return;
    if (this.inFlight) {
      if (forced) this.queued = true;
      return;
    }

    this.inFlight = true;
    this.lastAttemptAt = now;
    const generation = this.generation;
    this.send(this.highWater, { keepalive }).then(
      (outcome) => this.settle(generation, outcome),
      () => this.settle(generation, { kind: "failed" })
    );
  }

  private settle(generation: number, outcome: SendOutcome): void {
    this.inFlight = false;
    if (outcome.kind === "rate-limited") {
      this.blockedUntil = this.now() + outcome.retryAfterSeconds * 1000;
    } else if (outcome.kind === "stop") {
      this.halted = true;
    } else if (outcome.kind === "saved" && generation === this.generation) {
      this.sentPercent = wholePercent(outcome.report.readProgress);
      if (outcome.report.isRead) this.halted = true;
      this.onUpdate(outcome.report);
    }
    // A failed attempt changes nothing: the next regular update retries after the spacing.

    if (this.queued) {
      this.queued = false;
      this.attempt(true, false);
    }
  }
}
```

Run the Step 1 command again. Expected: PASS, 45 tests.

Why it is shaped this way:

- It credits the clock's position, not elapsed time. `highWater` only ever moves up, to `position / duration`, so listening to a paragraph twice or dragging back and forth adds nothing, and one rule serves both the audio element and the pacer.
- A step above `MAX_CREDIT_STEP_SECONDS` between two updates is a seek or a stall, not reading: it earns no credit and only moves the baseline. `rebase` does the same for `play`, `seeking` and `seeked`, which is why dragging the slider to 90 % does not mark the article read. The first `advance` without any baseline is treated as a rebase too.
- A report goes out only when `wholePercent(highWater)` is above what the server holds, one request at a time, and regular ones at least `PROGRESS_FLUSH_INTERVAL_MS` apart. The spacing runs from the last attempt, not the last success, so a failing server is not retried faster than every 10 s. At most six requests a minute keeps a reader far inside the server's 60 mutations a minute.
- The exact fraction is sent, not the rounded percent, so the server's progress bar and its 0.95 threshold work on the real position.
- A forced `flush()` (pause, the end, tab hidden, leaving, unmount) skips the spacing so the last position is not lost. If a request is already in flight the flush is queued and sent when that request settles, with `keepalive: false`, because a request made while the page unloads would never settle anyway. A regular update is not queued: the next one tries again.
- `saved` sets `sentPercent` by plain assignment from the server's value, not with `max`, so the tracker heals if the server holds less than it believes. `isRead` halts tracking whatever percent comes back; the real server returns 1.0 for a read post, so the test uses a synthetic `saved(0.95, true)` to pin the tracker's own contract. A rate limit sets `blockedUntil` from the moment the answer arrived and holds back forced flushes too. `stop` halts for good. A failure changes nothing.
- `reset(next)` is for a manual mark as read or unread. It bumps `generation`, so the saved answer to a request sent before the reset is dropped (it would overwrite the new state), while a rate limit or a stop still applies: those describe the quota and the post or session, not the progress value. It leaves `inFlight` and `blockedUntil` alone, because the request is still on the wire and the quota is still spent. `reset(1)` needs no `halted` of its own: `highWater` and `sentPercent` are both 100, so nothing is ever above what is sent.
- `highWater` is seeded from the stored progress for clarity, but nothing can observe the seed (`sentPercent` already blocks anything not above it), so no test pins it.

- [ ] **Step 3: Red — the hook's behaviour**

The tests replace only `api.put` and keep the real `ApiError`, so the hook's `instanceof ApiError` check runs against the real class. `vi.useFakeTimers()` fakes `performance.now()`, which the tracker reads by default, so `vi.advanceTimersByTime` moves its 10-second spacing; `settle()` drains the promise callbacks that follow a `put`.

Create `frontend/src/hooks/__tests__/useReadingProgress.test.tsx`:

```tsx
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api, { ApiError } from "../../services/api";
import type { MediaClock, MediaClockEvent } from "../../utils/mediaClock";
import { useReadingProgress } from "../useReadingProgress";
import type { UseReadingProgressArgs } from "../useReadingProgress";

vi.mock("../../services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/api")>()),
  default: { put: vi.fn() },
}));

/** A media clock the test drives by hand. */
class FakeClock implements MediaClock {
  currentTime = 0;
  ended = false;
  paused = true;
  private readonly listeners = new Map<MediaClockEvent, Set<() => void>>();

  addEventListener(type: MediaClockEvent, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: MediaClockEvent, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type?: MediaClockEvent): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  emit(type: MediaClockEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  /** Plays on by `seconds` and reports it, the way a playing element does. */
  tick(seconds: number): void {
    this.currentTime += seconds;
    this.emit("timeupdate");
  }
}

const put = vi.mocked(api.put);

/** What the server answers for a saved progress. */
const reply = (progress: number) => ({
  postId: "p1",
  isRead: progress >= 0.95,
  readProgress: progress >= 0.95 ? 1 : progress,
  readAt: null,
});

// Lets the tracker's promise callbacks run.
const settle = () => vi.advanceTimersByTimeAsync(0);

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  put.mockReset();
  put.mockImplementation(async (_path, body) => reply((body as { progress: number }).progress));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
});

/** Mounts the hook on a fake clock, tracking post p1 from zero. */
function setup(overrides: Partial<UseReadingProgressArgs> = {}, clock = new FakeClock()) {
  const props: UseReadingProgressArgs = {
    postId: "p1",
    initialProgress: 0,
    enabled: true,
    clockKey: "audio",
    getClock: () => clock,
    getDurationSeconds: () => 100,
    onUpdate: vi.fn(),
    ...overrides,
  };
  const hook = renderHook((current: UseReadingProgressArgs) => useReadingProgress(current), {
    initialProps: props,
  });
  return { ...hook, clock, props };
}

const endpoint = (postId: string) => `/posts/${postId}/progress`;

describe("useReadingProgress tracking", () => {
  it("does nothing while it is disabled", () => {
    const { clock } = setup({ enabled: false });

    clock.tick(1);

    expect(clock.listenerCount()).toBe(0);
    expect(put).not.toHaveBeenCalled();
  });

  it("sends the first percent to the post's progress endpoint", () => {
    const { clock } = setup();

    clock.tick(1);

    expect(put).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.01 }, { keepalive: false });
  });

  it("hands the saved report to onUpdate", async () => {
    const onUpdate = vi.fn();
    const { clock } = setup({ onUpdate });

    clock.tick(1);
    await settle();

    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith({ readProgress: 0.01, isRead: false });
  });

  it("stops sending once the server says the article is read", async () => {
    const onUpdate = vi.fn();
    const { clock } = setup({ onUpdate });

    clock.currentTime = 95;
    clock.emit("seeked");
    clock.tick(1);
    await settle();
    expect(onUpdate).toHaveBeenCalledWith({ readProgress: 1, isRead: true });

    vi.advanceTimersByTime(10_000);
    clock.tick(1);
    clock.emit("pause");
    expect(put).toHaveBeenCalledOnce();
  });

  it("uses the latest callbacks without rebinding the clock", async () => {
    const { clock, rerender, props } = setup();
    const onUpdate = vi.fn();

    rerender({ ...props, getDurationSeconds: () => 50, onUpdate });
    expect(clock.listenerCount("timeupdate")).toBe(1);

    clock.tick(1);
    expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
    await settle();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("counts from where an already playing clock is", () => {
    const clock = new FakeClock();
    clock.currentTime = 50;
    setup({}, clock);

    clock.tick(1);

    expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.51 }, { keepalive: false });
  });

  it("takes the first tick of a clock that has not started from the beginning", () => {
    const { clock } = setup();

    clock.emit("timeupdate");

    expect(put).not.toHaveBeenCalled();
  });

  it("survives strict mode's extra mount without doubling up", () => {
    const clock = new FakeClock();
    renderHook(
      () =>
        useReadingProgress({
          postId: "p1",
          initialProgress: 0,
          enabled: true,
          clockKey: "audio",
          getClock: () => clock,
          getDurationSeconds: () => 100,
          onUpdate: vi.fn(),
        }),
      { wrapper: StrictMode }
    );
    expect(clock.listenerCount("timeupdate")).toBe(1);

    clock.tick(1);

    expect(put).toHaveBeenCalledOnce();
  });
});

describe("useReadingProgress baselines", () => {
  it.each<MediaClockEvent>(["play", "seeking", "seeked"])(
    "takes the clock's position as the new baseline on %s",
    (type) => {
      const { clock } = setup();
      clock.currentTime = 3;

      clock.emit(type);
      clock.emit("timeupdate");

      expect(put).not.toHaveBeenCalled();
    }
  );

  it.each<MediaClockEvent>(["play", "seeking", "seeked"])(
    "credits reading from where the clock is after %s",
    (type) => {
      const { clock } = setup();
      clock.currentTime = 60;

      clock.emit(type);
      clock.tick(1);

      expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.61 }, { keepalive: false });
    }
  );
});

describe("useReadingProgress flushing", () => {
  it.each<MediaClockEvent>(["pause", "ended"])(
    "sends what is new on %s, without waiting for the spacing",
    async (type) => {
      const { clock } = setup();
      clock.tick(1);
      await settle();
      clock.tick(1);
      clock.tick(1);
      expect(put).toHaveBeenCalledTimes(1);

      clock.emit(type);

      expect(put).toHaveBeenCalledTimes(2);
      expect(put).toHaveBeenLastCalledWith(
        endpoint("p1"),
        { progress: 0.03 },
        { keepalive: false }
      );
    }
  );

  it("sends what is new, with keepalive, when the tab is hidden", async () => {
    const { clock } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    setVisibility("hidden");

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: true });
  });

  it("sends nothing when the tab becomes visible again", async () => {
    const { clock } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    setVisibility("visible");

    expect(put).toHaveBeenCalledTimes(1);
  });

  it("sends what is new, with keepalive, when the page is being left", async () => {
    const { clock } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    window.dispatchEvent(new Event("pagehide"));

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: true });
  });

  it("sends what is new and lets go of the clock when it unmounts", async () => {
    const { clock, unmount } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    unmount();

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
    expect(clock.listenerCount()).toBe(0);
  });

  it("removes the page listeners it added", () => {
    const addToDocument = vi.spyOn(document, "addEventListener");
    const addToWindow = vi.spyOn(window, "addEventListener");
    const removeFromDocument = vi.spyOn(document, "removeEventListener");
    const removeFromWindow = vi.spyOn(window, "removeEventListener");
    const { unmount } = setup();
    const listenerFor = (spy: { mock: { calls: unknown[][] } }, type: string) =>
      spy.mock.calls.find((call) => call[0] === type)?.[1];
    const onVisibility = listenerFor(addToDocument, "visibilitychange");
    const onPageHide = listenerFor(addToWindow, "pagehide");
    expect(onVisibility).toBeTypeOf("function");
    expect(onPageHide).toBeTypeOf("function");

    unmount();

    expect(removeFromDocument).toHaveBeenCalledWith("visibilitychange", onVisibility);
    expect(removeFromWindow).toHaveBeenCalledWith("pagehide", onPageHide);
  });

  it("sends what is new when it is switched off", async () => {
    const { clock, rerender, props } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    rerender({ ...props, enabled: false });

    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
    expect(clock.listenerCount()).toBe(0);
  });
});

describe("useReadingProgress clocks", () => {
  it("moves to the new clock when the key changes, flushing the old one", async () => {
    const first = new FakeClock();
    const second = new FakeClock();
    second.currentTime = 10;
    let current = first;
    const { rerender, props } = setup({ getClock: () => current }, first);
    first.tick(1);
    await settle();
    first.tick(1);

    current = second;
    rerender({ ...props, getClock: () => current, clockKey: "silent" });

    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount("timeupdate")).toBe(1);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });

    await settle();
    vi.advanceTimersByTime(10_000);
    second.tick(1);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.11 }, { keepalive: false });
  });

  it("copes with there being no clock yet, and picks one up when the key changes", () => {
    const clock = new FakeClock();
    let current: FakeClock | null = null;
    const { rerender, props } = setup({ getClock: () => current });
    expect(() => setVisibility("hidden")).not.toThrow();

    current = clock;
    rerender({ ...props, getClock: () => current, clockKey: "silent" });
    clock.tick(1);

    expect(put).toHaveBeenCalledOnce();
  });
});

describe("useReadingProgress posts", () => {
  it("sends the old post to its own endpoint and starts the new one from its stored progress", async () => {
    const { clock, rerender, props } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    rerender({ ...props, postId: "p2", initialProgress: 0.5 });
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
    expect(put).toHaveBeenCalledTimes(2);

    clock.tick(1);
    vi.advanceTimersByTime(10_000);
    clock.currentTime = 50;
    clock.emit("seeked");
    clock.tick(1);

    expect(put).toHaveBeenCalledTimes(3);
    expect(put).toHaveBeenLastCalledWith(endpoint("p2"), { progress: 0.51 }, { keepalive: false });
  });

  it("ignores the answer for a post the page has moved on from", async () => {
    let answer: (value: unknown) => void = () => undefined;
    put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const onUpdate = vi.fn();
    const { clock, rerender, props } = setup({ onUpdate });
    clock.tick(1);

    rerender({ ...props, postId: "p2" });
    answer(reply(0.01));
    await settle();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("still sends a post's queued progress to that post after the page has moved on", async () => {
    let answer: (value: unknown) => void = () => undefined;
    put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const { clock, rerender, props } = setup();
    clock.tick(1);
    clock.tick(1);

    rerender({ ...props, postId: "p2" });
    answer(reply(0.01));
    await settle();

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
  });
});

describe("useReadingProgress reset", () => {
  it("forgets what it counted when the article is marked unread", async () => {
    const { clock, result } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);
    clock.tick(1);

    result.current.reset(0);
    clock.emit("pause");

    expect(put).toHaveBeenCalledTimes(1);
  });

  it("stops sending when the article is marked read", () => {
    const { clock, result } = setup();

    result.current.reset(1);
    clock.tick(1);
    clock.emit("pause");

    expect(put).not.toHaveBeenCalled();
  });

  it("is harmless before tracking has started", () => {
    const { result } = setup({ enabled: false });

    expect(() => result.current.reset(0)).not.toThrow();
  });

  it("keeps the same function across renders", () => {
    const { result, rerender, props } = setup();
    const first = result.current.reset;

    rerender({ ...props, clockKey: "silent" });

    expect(result.current.reset).toBe(first);
  });

  it("applies a reset that arrives while tracking is off", async () => {
    const { clock, result, rerender, props } = setup();
    clock.currentTime = 4;
    clock.emit("seeked");
    clock.tick(1);
    await settle();
    expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.05 }, { keepalive: false });

    rerender({ ...props, enabled: false });
    result.current.reset(0);
    rerender({ ...props, enabled: true });
    vi.advanceTimersByTime(10_000);
    clock.currentTime = 1;
    clock.emit("seeked");
    clock.tick(1);

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
  });

  it("keeps what it knows while it is switched off and on again", async () => {
    const { clock, rerender, props } = setup();
    clock.currentTime = 4;
    clock.emit("seeked");
    clock.tick(1);
    await settle();

    rerender({ ...props, enabled: false });
    rerender({ ...props, enabled: true });
    vi.advanceTimersByTime(10_000);
    clock.currentTime = 3;
    clock.emit("seeked");
    clock.tick(1);

    expect(put).toHaveBeenCalledOnce();
  });
});

describe("useReadingProgress when the server pushes back", () => {
  it("waits as long as the server asks after a 429", async () => {
    put.mockRejectedValueOnce(
      new ApiError(429, "RATE_LIMITED", "Too many requests", { retryAfter: 30 })
    );
    const { clock } = setup();
    clock.tick(1);
    await settle();

    vi.advanceTimersByTime(29_999);
    clock.tick(1);
    expect(put).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    clock.tick(1);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, 0, -5, "30", Number.NaN])(
    "waits a minute after a 429 that gives no usable wait (%s)",
    async (retryAfter) => {
      put.mockRejectedValueOnce(
        new ApiError(
          429,
          "RATE_LIMITED",
          "Too many requests",
          retryAfter === undefined ? undefined : { retryAfter }
        )
      );
      const { clock } = setup();
      clock.tick(1);
      await settle();

      vi.advanceTimersByTime(59_999);
      clock.tick(1);
      expect(put).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      clock.tick(1);
      expect(put).toHaveBeenCalledTimes(2);
    }
  );

  it.each([401, 403, 404])("gives up for good on a %s", async (status) => {
    put.mockRejectedValueOnce(new ApiError(status, "UNKNOWN_ERROR", "No"));
    const { clock } = setup();
    clock.tick(1);
    await settle();

    vi.advanceTimersByTime(60_000);
    clock.tick(1);
    clock.emit("pause");

    expect(put).toHaveBeenCalledOnce();
  });

  it.each([
    ["a server error", new ApiError(500, "UNKNOWN_ERROR", "Boom")],
    ["a network error", new TypeError("Failed to fetch")],
  ])("tries again after the spacing on %s", async (_name, error) => {
    put.mockRejectedValueOnce(error);
    const { clock } = setup();
    clock.tick(1);
    await settle();

    vi.advanceTimersByTime(9_999);
    clock.tick(1);
    expect(put).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    clock.tick(1);
    expect(put).toHaveBeenCalledTimes(2);
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/useReadingProgress.test.tsx
```

Expected: FAIL, the suite cannot load: `Failed to resolve import "../useReadingProgress" from "src/hooks/__tests__/useReadingProgress.test.tsx". Does the file exist?`

- [ ] **Step 4: Green — the hook**

Create `frontend/src/hooks/useReadingProgress.ts`:

```ts
import { useCallback, useEffect, useRef } from "react";
import api, { ApiError } from "../services/api";
import type { MediaClock, MediaClockEvent } from "../utils/mediaClock";
import { ReadingProgressTracker } from "../utils/readingProgressTracker";
import type { ProgressReport, SendOutcome } from "../utils/readingProgressTracker";

/** The wait after a 429 that does not say how long to wait. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

interface ProgressResponse {
  postId: string;
  isRead: boolean;
  readProgress: number;
  readAt: string | null;
}

/** Sends one progress update and sorts the answer into what the tracker needs to know. */
async function sendProgress(
  postId: string,
  progress: number,
  options: { keepalive: boolean }
): Promise<SendOutcome> {
  try {
    const saved = await api.put<ProgressResponse>(
      `/posts/${postId}/progress`,
      { progress },
      { keepalive: options.keepalive }
    );
    return { kind: "saved", report: { readProgress: saved.readProgress, isRead: saved.isRead } };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 429) {
        const retryAfter = error.details?.retryAfter;
        return {
          kind: "rate-limited",
          retryAfterSeconds:
            typeof retryAfter === "number" && retryAfter > 0
              ? retryAfter
              : DEFAULT_RETRY_AFTER_SECONDS,
        };
      }
      // The session ended, or the post is not this reader's to track: asking again will not help.
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        return { kind: "stop" };
      }
    }
    return { kind: "failed" };
  }
}

export interface UseReadingProgressArgs {
  postId: string;
  /** What the server holds for this reader and post. Read once, when tracking starts for the post. */
  initialProgress: number;
  /** Tracking runs only while this is true. */
  enabled: boolean;
  /** Must change whenever `getClock` would now return a different clock. */
  clockKey: string;
  getClock: () => MediaClock | null;
  getDurationSeconds: () => number;
  /** Called with every report the server accepted for the post being tracked. */
  onUpdate: (report: ProgressReport) => void;
}

export interface UseReadingProgressResult {
  /** The reader marked the article read (1) or unread (0) by hand. */
  reset: (next: 0 | 1) => void;
}

/**
 * Turns a media clock's playback into reading progress for one post and reports it to the server.
 * The counting and the timing live in ReadingProgressTracker; this hook wires it to a clock, to
 * page visibility and to the API.
 */
export function useReadingProgress(args: UseReadingProgressArgs): UseReadingProgressResult {
  const { postId, enabled, clockKey } = args;

  // Declared first, so it is fresh before the effect below reads it in the same commit.
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });

  const trackerRef = useRef<{ postId: string; tracker: ReadingProgressTracker } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let entry = trackerRef.current;
    if (!entry || entry.postId !== postId) {
      entry = {
        postId,
        tracker: new ReadingProgressTracker({
          initialProgress: latest.current.initialProgress,
          send: (progress, options) => sendProgress(postId, progress, options),
          onUpdate: (report) => {
            if (latest.current.postId === postId) latest.current.onUpdate(report);
          },
        }),
      };
      trackerRef.current = entry;
    }
    const { tracker } = entry;

    const clock = latest.current.getClock();
    const clockListeners: Array<[MediaClockEvent, () => void]> = [];
    if (clock) {
      tracker.rebase(clock.currentTime);
      const rebase = () => tracker.rebase(clock.currentTime);
      const advance = () => tracker.advance(clock.currentTime, latest.current.getDurationSeconds());
      const flush = () => tracker.flush();
      clockListeners.push(
        ["play", rebase],
        ["seeking", rebase],
        ["seeked", rebase],
        ["timeupdate", advance],
        ["pause", flush],
        ["ended", flush]
      );
      for (const [type, listener] of clockListeners) clock.addEventListener(type, listener);
    }

    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") tracker.flush({ keepalive: true });
    };
    const flushWhenLeaving = () => tracker.flush({ keepalive: true });
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flushWhenLeaving);

    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flushWhenLeaving);
      if (clock) {
        for (const [type, listener] of clockListeners) clock.removeEventListener(type, listener);
      }
      tracker.flush();
    };
  }, [enabled, postId, clockKey]);

  const reset = useCallback((next: 0 | 1) => {
    trackerRef.current?.tracker.reset(next);
  }, []);

  return { reset };
}
```

Run the Step 3 command again, then both suites together:

```bash
docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/useReadingProgress.test.tsx
docker compose exec -T frontend pnpm exec vitest run src/utils/__tests__/readingProgressTracker.test.ts src/hooks/__tests__/useReadingProgress.test.tsx
```

Expected: the first prints `Tests  44 passed (44)`; the second prints `Test Files  2 passed (2)` and `Tests  89 passed (89)`.

Why it is shaped this way:

- The callbacks and `initialProgress` are read through a `latest` ref that a no-deps effect refreshes, so the page can pass inline functions without the clock listeners being re-bound on every render. That effect is declared first, so the ref is already fresh when the main effect reads it in the same commit. What the ref cannot do is tell the effect that `getClock()` would now return a different clock, which is why `clockKey` is an explicit dependency (a pure re-bind signal; oxlint accepts it).
- The tracker lives in a ref keyed by `postId`, not inside the effect. Switching `enabled` off and on again keeps the high-water mark and the in-flight request instead of starting over from `initialProgress` and sending again. A new `postId` gets a new tracker, seeded with that post's stored progress. `send` is bound to the tracker's own `postId`, so one post's progress can never reach another post's endpoint.
- Every teardown flushes what is unsent: switching off, changing post, changing clock, unmounting. `visibilitychange` (only when the page became hidden) and `pagehide` flush with `keepalive: true`, the one case where the browser would otherwise cancel the request.
- Attaching to a clock rebases at its current position, so attaching to one that is already playing (switching from audio to silent reading in the middle of an article) is measured from where it is, not from nothing.
- `sendProgress` sorts the HTTP result into the tracker's four outcomes. The wait after a 429 is the server's `details.retryAfter` when it is a positive number, otherwise 60 s, which is what the `Retry-After` header carries. 401, 403 and 404 stop tracking: `api.ts` already raises the sign-in flow on a 401 by itself, so the hook only has to stop sending. It branches on `status`, not `code`, because the posts routes' flat error bodies parse as `UNKNOWN_ERROR`. Anything else, network errors included, is a plain failure that retries after the spacing.
- `onUpdate` is called only for the post the page is on now (`latest.current.postId === postId`): the answer to a request for the post the reader has just left must not be written onto the new post.
- The hook returns only `reset`. A live `progress` value would re-render the page about four times a second for nothing: the chip and the button show the server-confirmed `post.readProgress`, which arrives through `onUpdate`.

- [ ] **Step 5: Verify the task**

```bash
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check src/utils/readingProgressTracker.ts src/utils/__tests__/readingProgressTracker.test.ts src/hooks/useReadingProgress.ts src/hooks/__tests__/useReadingProgress.test.tsx
```

Expected: `tsc -b` prints nothing; `pnpm lint` reports no new warnings (it already prints 4 older ones: `AuthContext.tsx`, `usePostsData.ts` exhaustive-deps, and `theme.tsx` twice); prettier accepts all four new files (if it flags one, run `pnpm exec prettier --write` on that new file only).

- [ ] **Step 6: Commit (only if the user asked for commits)**

```bash
git add frontend/src/utils/readingProgressTracker.ts frontend/src/utils/__tests__/readingProgressTracker.test.ts frontend/src/hooks/useReadingProgress.ts frontend/src/hooks/__tests__/useReadingProgress.test.tsx
git commit -m "feat(frontend): track reading progress from the audio and pacer clocks" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 15: `FloatingAudioControls` can drive the reading pacer

Silent reading needs the same floating play and speed circles as audio once the inline controls scroll out of view, but its speed is a pace in words per minute (150 to 400), not a playback rate, and it makes no sound. Rather than add a second floating component, the existing one learns four optional props that default to today's audio behaviour, and its `player` type shrinks to the seven fields the controls actually read, so the page can hand it a small adapter over the pacer.

**Files:**
- Modify: `frontend/src/components/FloatingAudioControls.tsx`
- Modify: `frontend/src/components/__tests__/FloatingAudioControls.test.tsx`

**Interfaces:**
- Consumes: `PLAYBACK_SPEEDS` from `constants/audio` (unchanged; it stays the default menu) and `UseAudioPlayerResult` from `hooks/useAudioPlayer` (unchanged).
- Produces:
  - `FloatingAudioControlsProps.player` becomes `Pick<UseAudioPlayerResult, "isPlaying" | "status" | "toggle" | "playbackRate" | "setPlaybackRate" | "isMuted" | "toggleMute">`. The full audio player still fits it.
  - Four optional props: `speeds?: readonly number[]` (default `PLAYBACK_SPEEDS`), `formatSpeed?: (speed: number) => string` (default `` `${speed}x` ``), `speedLabel?: string` (default `"Playback speed"`) and `hideMute?: boolean` (default `false`).
  - The silent-reading wiring Task 17 uses: `player={{ isPlaying: pacer.isPlaying, status: pacer.status, toggle: pacer.toggle, playbackRate: wpm, setPlaybackRate: setWpm, isMuted: false, toggleMute: () => {} }}` together with `speeds={WPM_OPTIONS}`, ``formatSpeed={(value) => `${value}`}``, `speedLabel="Reading speed"` and `hideMute`.

Both files are 2-space and already pass prettier, so the edits below are written in that style.

- [ ] **Step 1: Red — the controls with a different speed scale**

In `frontend/src/components/__tests__/FloatingAudioControls.test.tsx` make five edits. The first four let the existing `Harness` and `renderOffscreen` helpers pass the new props through and accept the narrower `player`; the fifth appends the new tests.

1. Replace:

```tsx
import { FloatingAudioControls } from "../FloatingAudioControls";
import type { UseAudioPlayerResult } from "../../hooks/useAudioPlayer";
```

with:

```tsx
import { FloatingAudioControls } from "../FloatingAudioControls";
import type { FloatingAudioControlsProps } from "../FloatingAudioControls";
import type { UseAudioPlayerResult } from "../../hooks/useAudioPlayer";
```

2. Replace:

```tsx
function Harness({
  player,
  withFooter = true,
}: {
  player: UseAudioPlayerResult;
  withFooter?: boolean;
}) {
```

with:

```tsx
type SpeedScale = Pick<
  FloatingAudioControlsProps,
  "speeds" | "formatSpeed" | "speedLabel" | "hideMute"
>;

function Harness({
  player,
  withFooter = true,
  scale = {},
}: {
  player: FloatingAudioControlsProps["player"];
  withFooter?: boolean;
  scale?: SpeedScale;
}) {
```

3. Replace:

```tsx
        footerRef={withFooter ? footerRef : undefined}
      />
```

with:

```tsx
        footerRef={withFooter ? footerRef : undefined}
        {...scale}
      />
```

4. Replace:

```tsx
function renderOffscreen(player: UseAudioPlayerResult) {
  const view = render(<Harness player={player} />);
```

with:

```tsx
function renderOffscreen(player: FloatingAudioControlsProps["player"], scale: SpeedScale = {}) {
  const view = render(<Harness player={player} scale={scale} />);
```

5. Replace the end of the file (the last existing test and the closing of its `describe`):

```tsx
  it("closes the options on tap-away (touchend)", () => {
    open();
    fireEvent.touchEnd(document.body);
    expect(screen.queryByTestId("floating-speed-options")).toBeNull();
  });
});
```

with:

```tsx
  it("closes the options on tap-away (touchend)", () => {
    open();
    fireEvent.touchEnd(document.body);
    expect(screen.queryByTestId("floating-speed-options")).toBeNull();
  });
});

describe("FloatingAudioControls — a different speed scale", () => {
  const wpm: SpeedScale = {
    speeds: [150, 200, 250, 300, 400],
    formatSpeed: (value) => `${value}`,
    speedLabel: "Reading speed",
    hideMute: true,
  };

  /** What the page hands over for silent reading: only the fields the controls read. */
  function makePacerPlayer(
    overrides: Partial<FloatingAudioControlsProps["player"]> = {}
  ): FloatingAudioControlsProps["player"] {
    return {
      status: "playing",
      isPlaying: true,
      toggle: vi.fn(),
      playbackRate: 250,
      setPlaybackRate: vi.fn(),
      isMuted: false,
      toggleMute: vi.fn(),
      ...overrides,
    };
  }

  function open(player = makePacerPlayer()) {
    renderOffscreen(player, wpm);
    fireEvent.click(screen.getByTestId("floating-speed-button"));
    return player;
  }

  const optionButtons = () =>
    Array.from(screen.getByTestId("floating-speed-options").querySelectorAll("button"));

  it("needs only the fields it reads from a player", () => {
    const player = makePacerPlayer();
    renderOffscreen(player, wpm);

    fireEvent.click(screen.getByTestId("floating-play-button"));

    expect(player.toggle).toHaveBeenCalledTimes(1);
  });

  it("offers the speeds it is given, written by formatSpeed", () => {
    open();
    expect(optionButtons().map((button) => button.textContent)).toEqual([
      "150",
      "200",
      "250",
      "300",
      "400",
    ]);
  });

  it("shows the current speed the way formatSpeed writes it", () => {
    renderOffscreen(makePacerPlayer({ playbackRate: 300 }), wpm);
    expect(screen.getByTestId("floating-speed-button").textContent).toBe("300");
  });

  it("marks only the current speed as selected", () => {
    open(makePacerPlayer({ playbackRate: 200 }));
    expect(optionButtons().map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
      "false",
      "false",
    ]);
  });

  it("hands the chosen speed to setPlaybackRate and closes the options", () => {
    const player = open();
    fireEvent.click(screen.getByLabelText("Set speed 300"));
    expect(player.setPlaybackRate).toHaveBeenCalledWith(300);
    expect(screen.queryByTestId("floating-speed-options")).toBeNull();
  });

  it("names the speed control with speedLabel", () => {
    open();
    expect(screen.getByTestId("floating-speed-button").getAttribute("aria-label")).toBe(
      "Reading speed"
    );
    expect(screen.getByTestId("floating-speed-options").getAttribute("aria-label")).toBe(
      "Reading speed options"
    );
  });

  it("keeps the audio names when no speedLabel is given", () => {
    renderOffscreen(makePlayer());
    fireEvent.click(screen.getByTestId("floating-speed-button"));
    expect(screen.getByTestId("floating-speed-button").getAttribute("aria-label")).toBe(
      "Playback speed"
    );
    expect(screen.getByTestId("floating-speed-options").getAttribute("aria-label")).toBe(
      "Playback speed options"
    );
  });

  it("leaves out the mute button when hideMute is set", () => {
    renderOffscreen(makePacerPlayer(), wpm);
    expect(screen.queryByTestId("floating-mute-button")).toBeNull();
    expect(screen.queryByTestId("floating-play-button")).not.toBeNull();
  });

  it("shows the mute button by default", () => {
    renderOffscreen(makePlayer());
    expect(screen.queryByTestId("floating-mute-button")).not.toBeNull();
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/FloatingAudioControls.test.tsx
```

Expected: FAIL, `Tests  6 failed | 17 passed (23)`. The 6 failures are all in the new `describe`:

- `offers the speeds it is given, written by formatSpeed`: `AssertionError: expected [ '0.5x', '1x', '1.2x', '1.5x', …(3) ] to deeply equal [ '150', '200', '250', '300', '400' ]`
- `shows the current speed the way formatSpeed writes it`: `AssertionError: expected '300x' to be '300'`
- `marks only the current speed as selected`: `AssertionError: expected [ 'false', 'false', 'false', …(4) ] to deeply equal [ 'false', 'true', 'false', …(2) ]`
- `hands the chosen speed to setPlaybackRate and closes the options`: `TestingLibraryElementError: Unable to find a label with the text of: Set speed 300`
- `names the speed control with speedLabel`: `AssertionError: expected 'Playback speed' to be 'Reading speed'`
- `leaves out the mute button when hideMute is set`: `AssertionError: expected <button …(6)>…(1)</button> to be null`

The 14 tests that already existed pass, and so do three of the new ones: `needs only the fields it reads from a player` (a runtime check that the type change in Step 2 makes honest), `keeps the audio names when no speedLabel is given` and `shows the mute button by default`. Those two pin behaviour that has to stay exactly as it is.

Vitest does not type-check, so `pnpm exec tsc -b` is the other half of the red: it reports `error TS2344: Type '"formatSpeed" | "hideMute" | "speedLabel" | "speeds"' does not satisfy the constraint 'keyof FloatingAudioControlsProps'.` and, for the pacer-shaped player the new tests build, `error TS2322: Type '{ audioUrl?: string | null | undefined; … }' is not assignable to type 'UseAudioPlayerResult'.`

- [ ] **Step 2: Green — the component**

In `frontend/src/components/FloatingAudioControls.tsx` make eight edits, in order.

1. Replace the props:

```tsx
export interface FloatingAudioControlsProps {
  /** The same player object the inline AudioPlayer receives. */
  player: UseAudioPlayerResult;
  /** The inline player's container; observed for on-screen visibility. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The article footer actions row; hides the controls when it is in view. */
  footerRef?: RefObject<HTMLElement | null>;
  onSpeedMenuOpenChange?: (open: boolean) => void;
}
```

with:

```tsx
export interface FloatingAudioControlsProps {
  /**
   * What the inline controls drive: the audio player, or for silent reading an adapter over the
   * pacer. Only the fields the controls read are required.
   */
  player: Pick<
    UseAudioPlayerResult,
    | "isPlaying"
    | "status"
    | "toggle"
    | "playbackRate"
    | "setPlaybackRate"
    | "isMuted"
    | "toggleMute"
  >;
  /** The inline player's container; observed for on-screen visibility. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The article footer actions row; hides the controls when it is in view. */
  footerRef?: RefObject<HTMLElement | null>;
  onSpeedMenuOpenChange?: (open: boolean) => void;
  /** The speeds the menu offers. Defaults to the audio playback rates. */
  speeds?: readonly number[];
  /** How a speed reads on its button. Defaults to "1.5x". */
  formatSpeed?: (speed: number) => string;
  /** Names the speed control for assistive technology. Defaults to "Playback speed". */
  speedLabel?: string;
  /** Leaves the mute button out, for a surface that makes no sound. */
  hideMute?: boolean;
}

const formatRate = (speed: number) => `${speed}x`;
```

2. Replace the doc comment and the signature:

```tsx
/**
 * Floating play/resume + speed circles shown in the lower-right when the inline
 * audio player is scrolled off-screen and a clip is active. Drives the same
 * player element, so read-along and auto-scroll respond exactly as they do for
 * the inline controls.
 */
export function FloatingAudioControls({
  player,
  anchorRef,
  footerRef,
  onSpeedMenuOpenChange,
}: FloatingAudioControlsProps) {
```

with:

```tsx
/**
 * Floating play/resume + speed circles shown in the lower-right when the inline
 * controls are scrolled off-screen and a clip is active. Drives the same player
 * (or, for silent reading, the pacer), so read-along and auto-scroll respond
 * exactly as they do for the inline controls.
 */
export function FloatingAudioControls({
  player,
  anchorRef,
  footerRef,
  onSpeedMenuOpenChange,
  speeds = PLAYBACK_SPEEDS,
  formatSpeed = formatRate,
  speedLabel = "Playback speed",
  hideMute = false,
}: FloatingAudioControlsProps) {
```

3. Replace the group's label:

```tsx
            aria-label="Playback speed options"
```

with:

```tsx
            aria-label={`${speedLabel} options`}
```

4. Replace:

```tsx
            {PLAYBACK_SPEEDS.map((speed) => {
```

with:

```tsx
            {speeds.map((speed) => {
```

5. Replace the label of each option:

```tsx
                  aria-label={`Set speed ${speed}x`}
```

with:

```tsx
                  aria-label={`Set speed ${formatSpeed(speed)}`}
```

6. Replace the text of each option:

```tsx
                  {speed}x
                </Button>
```

with:

```tsx
                  {formatSpeed(speed)}
                </Button>
```

7. Replace the label of the speed button:

```tsx
          aria-label="Playback speed"
          aria-haspopup="true"
```

with:

```tsx
          aria-label={speedLabel}
          aria-haspopup="true"
```

8. Replace the text of the speed button and the mute button below it:

```tsx
          {player.playbackRate}x
        </Fab>
      </Box>
      <Fab
        size="small"
        color="default"
        aria-label={player.isMuted ? "Unmute audio" : "Mute audio"}
        aria-pressed={player.isMuted}
        data-testid="floating-mute-button"
        onClick={player.toggleMute}
        sx={{ width: 44, height: 44 }}
      >
        {player.isMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
      </Fab>
```

with:

```tsx
          {formatSpeed(player.playbackRate)}
        </Fab>
      </Box>
      {!hideMute && (
        <Fab
          size="small"
          color="default"
          aria-label={player.isMuted ? "Unmute audio" : "Mute audio"}
          aria-pressed={player.isMuted}
          data-testid="floating-mute-button"
          onClick={player.toggleMute}
          sx={{ width: 44, height: 44 }}
        >
          {player.isMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
        </Fab>
      )}
```

Run the Step 1 command again, with the only other consumer of the component beside it:

```bash
docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/FloatingAudioControls.test.tsx src/components/__tests__/AudioVolume.test.tsx
```

Expected: `Test Files  2 passed (2)` and `Tests  29 passed (29)`: the 23 of `FloatingAudioControls.test.tsx` and the 6 of `AudioVolume.test.tsx`, which hands the component the whole audio player and so proves that the narrower `player` type still accepts it.

Why it is shaped this way:

- `player` is a `Pick` of the seven fields the controls read, not the whole `UseAudioPlayerResult`. The pacer adapter in Task 17 then needs no stand-in audio fields (`audioUrl`, `wordTimings`, `getMediaElement`, …), and the real audio player is still accepted unchanged.
- The defaults reproduce today's audio surface to the character: the same seven speeds, `1.5x`, `Playback speed`, `Playback speed options`, `Set speed 2x` and a mute button. That is why the Playwright specs that click `floating-speed-button` and `Set speed 2x` and expect the text `2x` (`read-along.spec.ts`) need no change.
- `formatSpeed` is the one place a speed becomes text. It writes the speed button's text, each option's text and each option's accessible name, so a pace reads `300` everywhere it appears and a playback rate reads `2x` everywhere.
- `speedLabel` goes one step beyond the spec's list of new props (`speeds`, `formatSpeed`, `hideMute`). Without it a screen reader would announce silent reading's pace control as "Playback speed". With `speedLabel="Reading speed"` the button and the group ("Reading speed options") say what they change.
- `hideMute` leaves the mute button out of the tree instead of disabling it: reading silently makes no sound, so a button that can do nothing is only noise.
- When the controls show is untouched: a clip is active (`isPlaying`, or `status === "paused"`), the inline surface is off-screen and the footer is not in view. The pacer reports `"paused"` before its first play, so the page in Task 17 renders these controls only while silent reading is active.

- [ ] **Step 3: Verify the task**

```bash
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check src/components/FloatingAudioControls.tsx src/components/__tests__/FloatingAudioControls.test.tsx
```

Expected: `tsc -b` prints nothing (this is where the narrower `player` type is proven: the 7-field object in the new tests compiles, and so does the full audio player in `AudioVolume.test.tsx`); `pnpm lint` reports no new warnings (it already prints 4 older ones: `AuthContext.tsx`, `usePostsData.ts` exhaustive-deps, and `theme.tsx` twice); prettier accepts both files, which passed it before this task.

- [ ] **Step 4: Commit (only if the user asked for commits)**

```bash
git add frontend/src/components/FloatingAudioControls.tsx frontend/src/components/__tests__/FloatingAudioControls.test.tsx
git commit -m "feat(frontend): let FloatingAudioControls drive the reading pacer" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 16: Reading controls — `StartReadingButton`, `PacerControls`, a lockable highlight switch and a quiet idle `AudioPlayer`

The article page in Task 17 swaps between three reading surfaces, and this task builds what it needs. `StartReadingButton` is the one idle control: a split button whose label says where the reader is (`Start reading`, `Continue reading · 42%`, `Read again`) and whose arrow starts reading in either mode. `PacerControls` is silent reading's player (play or pause, a position slider, a pace menu and stop), on the same grid as `AudioPlayer` so the two swap in place. `ReadAlongToggles` learns to keep its highlight switch on and locked, because silent reading has nothing to show without the highlight. `AudioPlayer` stops drawing "Listen to article", which `StartReadingButton` replaces, and its error state offers a way out to silent reading.

The page does not use the new pieces until Task 17. Because `AudioPlayer` stops drawing its idle button here, the article page has no control to start reading in between, so do Tasks 16 and 17 back to back.

**Files:**
- Create: `frontend/src/components/StartReadingButton.tsx`
- Create: `frontend/src/components/PacerControls.tsx`
- Modify: `frontend/src/components/ReadAlongToggles.tsx`
- Modify: `frontend/src/components/AudioPlayer.tsx`
- Create: `frontend/src/components/__tests__/StartReadingButton.test.tsx`
- Create: `frontend/src/components/__tests__/PacerControls.test.tsx`
- Create: `frontend/src/components/__tests__/ReadAlongToggles.test.tsx`
- Modify: `frontend/src/components/__tests__/AudioPlayer.test.tsx`

**Interfaces:**
- Consumes: `ReadingMode` from `hooks/useReadAlongPreferences` (Task 12), `displayPercent` and `wholePercent` from `utils/readingProgress` (Task 8) and `WPM_OPTIONS` from `constants/audio` (Task 12).
- Produces:
  - `StartReadingButton({ progress, isRead, mode, onStart })`: `progress` is 0 to 1, `mode` is the remembered `ReadingMode` and `onStart(mode)` receives the mode to start in. Test ids `start-reading-button` (main button), `start-reading-menu` (arrow), `read-with-sound` and `read-silently` (menu items).
  - `PacerControls({ isPlaying, fraction, wpm, onToggle, onSeek, onWpmChange, onStop, onSpeedMenuOpenChange? })`: `fraction` is 0 to 1 and `onSeek(fraction)` takes the same scale. `onSpeedMenuOpenChange(open)` is the same optional hook `AudioPlayer` has, so the page can hold auto-scroll while the pace menu is open. Test ids `pacer-controls`, `pacer-play-button`, `pacer-position`, `pacer-percent`, `pacer-speed-button` and `pacer-stop-button`.
  - `ReadAlongToggles` gains `highlightLocked?: boolean` (default `false`).
  - `AudioPlayer` renders nothing while idle and gains `onReadSilently?: () => void`. When it is given, the error state shows a `Read silently` button (test id `audio-read-silently`).

The five new files are 2-space and follow the project's prettier style. `AudioPlayer.tsx` and `ReadAlongToggles.tsx` are 2-space too but not strictly prettier-formatted (they have long lines), so they change only through the replacements below, written in the style around them. Never run prettier over them or over `AudioPlayer.test.tsx`.

- [ ] **Step 1: Red — the controls and their contracts**

Create three new test files, then change `AudioPlayer.test.tsx`: its idle tests stop describing a button and its error state gains the way out.

Create `frontend/src/components/__tests__/StartReadingButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartReadingButton } from "../StartReadingButton";
import type { ReadingMode } from "../../hooks/useReadAlongPreferences";

function setup(props: { progress?: number; isRead?: boolean; mode?: ReadingMode } = {}) {
  const onStart = vi.fn();
  render(
    <StartReadingButton progress={0} isRead={false} mode="silent" onStart={onStart} {...props} />
  );
  return { onStart };
}

const mainButton = () => screen.getByTestId("start-reading-button");
const menuButton = () => screen.getByTestId("start-reading-menu");

describe("StartReadingButton", () => {
  describe("main label", () => {
    it("invites the user to start an article they have not started", () => {
      setup({ progress: 0 });
      expect(mainButton()).toHaveAccessibleName("Start reading");
    });

    it("offers to continue an article in progress, with the whole percent", () => {
      setup({ progress: 0.42 });
      expect(mainButton()).toHaveAccessibleName("Continue reading · 42%");
    });

    it("rounds the percent down", () => {
      setup({ progress: 0.429 });
      expect(mainButton()).toHaveAccessibleName("Continue reading · 42%");
    });

    it("never shows 0% for an article that was barely started", () => {
      setup({ progress: 0.004 });
      expect(mainButton()).toHaveAccessibleName("Continue reading · 1%");
    });

    it("offers to read a finished article again", () => {
      setup({ progress: 1, isRead: true });
      expect(mainButton()).toHaveAccessibleName("Read again");
    });

    it("offers to read again when the article was marked read with partial progress", () => {
      setup({ progress: 0.3, isRead: true });
      expect(mainButton()).toHaveAccessibleName("Read again");
    });
  });

  describe("starting", () => {
    it.each<ReadingMode>(["silent", "sound"])(
      "starts in the remembered %s mode from the main button",
      async (mode) => {
        const { onStart } = setup({ mode });
        await userEvent.click(mainButton());
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onStart).toHaveBeenCalledWith(mode);
      }
    );

    it("opens the menu from the arrow without starting anything", async () => {
      const { onStart } = setup();
      await userEvent.click(menuButton());
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(onStart).not.toHaveBeenCalled();
    });

    it.each([
      { chosen: "sound", name: "Read with sound", remembered: "silent" },
      { chosen: "silent", name: "Read silently", remembered: "sound" },
    ] as const)(
      "starts $chosen from the menu whatever mode is remembered",
      async ({ chosen, name, remembered }) => {
        const { onStart } = setup({ mode: remembered });
        await userEvent.click(menuButton());
        await userEvent.click(screen.getByRole("menuitemradio", { name }));
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onStart).toHaveBeenCalledWith(chosen);
      }
    );

    it("closes the menu once a mode is chosen", async () => {
      setup();
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole("menuitemradio", { name: "Read with sound" }));
      expect(menuButton()).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    });

    it("closes the menu on Escape without starting anything", async () => {
      const { onStart } = setup();
      await userEvent.click(menuButton());
      await userEvent.keyboard("{Escape}");
      expect(menuButton()).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe("menu", () => {
    it.each([
      { mode: "silent", remembered: "Read silently", other: "Read with sound" },
      { mode: "sound", remembered: "Read with sound", other: "Read silently" },
    ] as const)("marks $mode as the remembered mode", async ({ mode, remembered, other }) => {
      setup({ mode });
      await userEvent.click(menuButton());
      expect(screen.getByRole("menuitemradio", { name: remembered })).toBeChecked();
      expect(screen.getByRole("menuitemradio", { name: other })).not.toBeChecked();
    });

    it("exposes the arrow as a menu button", async () => {
      setup();
      const arrow = screen.getByRole("button", { name: "Choose how to read" });
      expect(arrow).toBe(menuButton());
      expect(arrow).toHaveAttribute("aria-haspopup", "menu");
      expect(arrow).toHaveAttribute("aria-expanded", "false");
      expect(arrow).not.toHaveAttribute("aria-controls");

      await userEvent.click(arrow);
      expect(arrow).toHaveAttribute("aria-expanded", "true");
      expect(arrow).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
      expect(screen.getByRole("menu")).toHaveAccessibleName("Reading mode");
    });
  });
});
```

Create `frontend/src/components/__tests__/PacerControls.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { PacerControls } from "../PacerControls";
import { WPM_OPTIONS } from "../../constants/audio";

function setup(props: Partial<ComponentProps<typeof PacerControls>> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    onWpmChange: vi.fn(),
    onStop: vi.fn(),
  };
  const view = render(
    <PacerControls isPlaying={false} fraction={0} wpm={250} {...handlers} {...props} />
  );
  return { ...handlers, unmount: view.unmount };
}

const slider = () => screen.getByRole("slider", { name: "Reading position" });
const speedButton = () => screen.getByTestId("pacer-speed-button");

describe("PacerControls", () => {
  describe("play and pause", () => {
    it("offers Play while paused and toggles on click", async () => {
      const { onToggle } = setup({ isPlaying: false });
      expect(screen.getByTestId("pacer-controls")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Play" });
      expect(button).toBe(screen.getByTestId("pacer-play-button"));

      await userEvent.click(button);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("offers Pause while playing and toggles on click", async () => {
      const { onToggle } = setup({ isPlaying: true });
      expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Pause" }));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe("position", () => {
    it.each([
      { fraction: 0, percent: 0 },
      { fraction: 0.426, percent: 42 },
      { fraction: 0.57, percent: 57 },
      { fraction: 0.999, percent: 99 },
      { fraction: 1, percent: 100 },
    ])("shows a position of $fraction as $percent percent", ({ fraction, percent }) => {
      setup({ fraction });
      expect(slider()).toHaveValue(String(percent));
      expect(slider()).toHaveAttribute("aria-valuetext", `${percent} percent`);
      expect(screen.getByTestId("pacer-percent").textContent).toBe(`${percent}%`);
    });

    it("spans the whole article", () => {
      setup();
      expect(slider()).toHaveAttribute("aria-valuemin", "0");
      expect(slider()).toHaveAttribute("aria-valuemax", "100");
    });

    it("seeks to the fraction the slider is moved to", () => {
      const { onSeek } = setup({ fraction: 0.1 });
      fireEvent.change(slider(), { target: { value: "40" } });
      expect(onSeek).toHaveBeenCalledTimes(1);
      expect(onSeek).toHaveBeenCalledWith(0.4);
    });

    it("moves one percent for each arrow key", async () => {
      const { onSeek } = setup({ fraction: 0.42 });
      slider().focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(onSeek).toHaveBeenCalledWith(0.43);
    });

    it("marks the slider's root for end-to-end tests", () => {
      setup();
      expect(screen.getByTestId("pacer-position")).toBeInTheDocument();
    });
  });

  describe("reading speed", () => {
    it("shows the pace on a button named Reading speed", () => {
      setup({ wpm: 300 });
      expect(speedButton()).toHaveTextContent("300 wpm");
      expect(speedButton()).toHaveAccessibleName("Reading speed");
    });

    it("exposes the button as a menu button", async () => {
      setup();
      expect(speedButton()).toHaveAttribute("aria-haspopup", "menu");
      expect(speedButton()).toHaveAttribute("aria-expanded", "false");
      expect(speedButton()).not.toHaveAttribute("aria-controls");

      await userEvent.click(speedButton());
      expect(speedButton()).toHaveAttribute("aria-expanded", "true");
      expect(speedButton()).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
      expect(screen.getByRole("menu")).toHaveAccessibleName("Reading speed options");
    });

    it("offers every pace and marks the current one", async () => {
      setup({ wpm: 300 });
      await userEvent.click(speedButton());

      const items = screen.getAllByRole("menuitemradio");
      expect(items.map((item) => item.textContent)).toEqual(
        WPM_OPTIONS.map((wpm) => `${wpm} words per minute`)
      );
      expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(
        WPM_OPTIONS.map((wpm) => String(wpm === 300))
      );
    });

    it("changes the pace and closes the menu", async () => {
      const { onWpmChange } = setup({ wpm: 250 });
      await userEvent.click(speedButton());
      await userEvent.click(screen.getByRole("menuitemradio", { name: "400 words per minute" }));

      expect(onWpmChange).toHaveBeenCalledTimes(1);
      expect(onWpmChange).toHaveBeenCalledWith(400);
      expect(speedButton()).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    });

    it("closes the menu on Escape without changing the pace", async () => {
      const { onWpmChange } = setup();
      await userEvent.click(speedButton());
      await userEvent.keyboard("{Escape}");

      expect(speedButton()).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
      expect(onWpmChange).not.toHaveBeenCalled();
    });

    it("reports when the menu opens and closes, so auto-scroll can wait", async () => {
      const onSpeedMenuOpenChange = vi.fn();
      setup({ onSpeedMenuOpenChange });
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(false);

      await userEvent.click(speedButton());
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(true);

      await userEvent.keyboard("{Escape}");
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(false);
    });

    it("reports the menu closed when the controls go away while it is open", async () => {
      const onSpeedMenuOpenChange = vi.fn();
      const { unmount } = setup({ onSpeedMenuOpenChange });
      await userEvent.click(speedButton());
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(true);

      unmount();
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(false);
    });
  });

  describe("stop", () => {
    it("stops reading", async () => {
      const { onStop, onToggle } = setup({ isPlaying: true });
      const button = screen.getByRole("button", { name: "Stop reading" });
      expect(button).toBe(screen.getByTestId("pacer-stop-button"));

      await userEvent.click(button);
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});
```

Create `frontend/src/components/__tests__/ReadAlongToggles.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { ReadAlongToggles } from "../ReadAlongToggles";

function setup(props: Partial<ComponentProps<typeof ReadAlongToggles>> = {}) {
  const handlers = {
    onHighlightChange: vi.fn(),
    onAutoScrollChange: vi.fn(),
    onHighlightModeChange: vi.fn(),
  };
  render(
    <ReadAlongToggles
      highlight={false}
      autoScroll={true}
      highlightMode="word"
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

const highlightSwitch = () => screen.getByRole("switch", { name: "Highlight while playing" });
const autoScrollSwitch = () => screen.getByRole("switch", { name: "Auto-scroll while playing" });

describe("ReadAlongToggles", () => {
  describe("highlight switch", () => {
    it("shows an off preference as off", () => {
      setup({ highlight: false });
      expect(highlightSwitch()).not.toBeChecked();
    });

    it("shows an on preference as on", () => {
      setup({ highlight: true });
      expect(highlightSwitch()).toBeChecked();
    });

    it("reports a change", async () => {
      const { onHighlightChange } = setup({ highlight: false });
      await userEvent.click(highlightSwitch());
      expect(onHighlightChange).toHaveBeenCalledTimes(1);
      expect(onHighlightChange).toHaveBeenCalledWith(true);
    });

    it("is enabled, with no note, when it is not locked", () => {
      setup({ highlightLocked: false });
      expect(highlightSwitch()).toBeEnabled();
      expect(highlightSwitch()).not.toHaveAttribute("aria-describedby");
      expect(screen.queryByText(/stays on/)).not.toBeInTheDocument();
    });
  });

  describe("when the highlight is locked on", () => {
    it("is on and cannot be changed, whatever the saved preference", () => {
      setup({ highlight: false, highlightLocked: true });
      expect(highlightSwitch()).toBeChecked();
      expect(highlightSwitch()).toBeDisabled();
    });

    it("explains why", () => {
      setup({ highlightLocked: true });
      const note = "Highlighting stays on while you read silently.";
      expect(screen.getByText(note)).toBeInTheDocument();
      expect(highlightSwitch()).toHaveAccessibleDescription(note);
    });

    it("leaves the auto-scroll switch usable", async () => {
      const { onAutoScrollChange } = setup({ autoScroll: true, highlightLocked: true });
      expect(autoScrollSwitch()).toBeEnabled();
      await userEvent.click(autoScrollSwitch());
      expect(onAutoScrollChange).toHaveBeenCalledWith(false);
    });
  });
});
```

In `frontend/src/components/__tests__/AudioPlayer.test.tsx` make four edits. The first three drop what no longer exists (the listen button) and the fourth adds the new error-state tests.

1. Replace the three tests of the idle state:

```tsx
  describe("idle state", () => {
    it("should display listen button in idle state", () => {
      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByTestId("listen-button")).toBeInTheDocument();
    });

    it("should display listen button with accessible label", () => {
      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByLabelText("Listen to article")).toBeInTheDocument();
    });

    it("should call generateAudio when listen button is clicked", async () => {
      const generateAudio = vi.fn();
      setMockState({ generateAudio });

      render(<AudioPlayer player={mockPlayer} />);
      await userEvent.click(screen.getByTestId("listen-button"));
      expect(generateAudio).toHaveBeenCalled();
    });
  });
```

with:

```tsx
  describe("idle state", () => {
    it("renders nothing while idle", () => {
      const { container } = render(<AudioPlayer player={mockPlayer} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
```

2. Replace the loading test:

```tsx
    it("should not display listen or play buttons while loading", () => {
      setMockState({ status: "loading" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.queryByTestId("listen-button")).not.toBeInTheDocument();
      expect(screen.queryByTestId("play-pause-button")).not.toBeInTheDocument();
    });
```

with:

```tsx
    it("should not display play buttons while loading", () => {
      setMockState({ status: "loading" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.queryByTestId("play-pause-button")).not.toBeInTheDocument();
    });
```

3. Replace the generating test:

```tsx
    it("should not display listen or play buttons while generating", () => {
      setMockState({ status: "generating" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.queryByTestId("listen-button")).not.toBeInTheDocument();
      expect(screen.queryByTestId("play-pause-button")).not.toBeInTheDocument();
    });
```

with:

```tsx
    it("should not display play buttons while generating", () => {
      setMockState({ status: "generating" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.queryByTestId("play-pause-button")).not.toBeInTheDocument();
    });
```

4. Replace the retry test (the last test of the error state):

```tsx
    it("should call generateAudio when retry is clicked", async () => {
      const generateAudio = vi.fn();
      setMockState({ status: "error", error: "Failed", generateAudio });

      render(<AudioPlayer player={mockPlayer} />);
      await userEvent.click(screen.getByLabelText("Retry audio generation"));
      expect(generateAudio).toHaveBeenCalled();
    });
```

with:

```tsx
    it("should call generateAudio when retry is clicked", async () => {
      const generateAudio = vi.fn();
      setMockState({ status: "error", error: "Failed", generateAudio });

      render(<AudioPlayer player={mockPlayer} />);
      await userEvent.click(screen.getByLabelText("Retry audio generation"));
      expect(generateAudio).toHaveBeenCalled();
    });

    it("should offer to read silently instead when a handler is given", async () => {
      const onReadSilently = vi.fn();
      const generateAudio = vi.fn();
      setMockState({ status: "error", error: "Failed", generateAudio });

      render(<AudioPlayer player={mockPlayer} onReadSilently={onReadSilently} />);
      const button = screen.getByRole("button", { name: "Read silently" });
      expect(button).toBe(screen.getByTestId("audio-read-silently"));

      await userEvent.click(button);
      expect(onReadSilently).toHaveBeenCalledTimes(1);
      expect(generateAudio).not.toHaveBeenCalled();
    });

    it("should not offer to read silently without a handler", () => {
      setMockState({ status: "error", error: "Failed" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.queryByRole("button", { name: "Read silently" })).not.toBeInTheDocument();
    });
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/StartReadingButton.test.tsx src/components/__tests__/PacerControls.test.tsx src/components/__tests__/ReadAlongToggles.test.tsx src/components/__tests__/AudioPlayer.test.tsx
```

Expected: FAIL, `Test Files  4 failed (4)` and `Tests  4 failed | 26 passed (30)`. The two new component suites cannot load (`Failed to resolve import "../PacerControls" from "src/components/__tests__/PacerControls.test.tsx". Does the file exist?`, and the same for `"../StartReadingButton"`), so none of their tests run. The four failing tests are:

- `AudioPlayer > idle state > renders nothing while idle`: `Error: expect(element).toBeEmptyDOMElement()`
- `AudioPlayer > error state > should offer to read silently instead when a handler is given`: `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Read silently"`
- `ReadAlongToggles > when the highlight is locked on > is on and cannot be changed, whatever the saved preference`: `Error: expect(element).toBeChecked()`
- `ReadAlongToggles > when the highlight is locked on > explains why`: `TestingLibraryElementError: Unable to find an element with the text: Highlighting stays on while you read silently..`

The other 26 pass already: 21 `AudioPlayer` tests and 5 `ReadAlongToggles` tests that describe what the switches do today (an unknown `highlightLocked` prop is simply ignored for now).

Vitest does not type-check, so `pnpm exec tsc -b` is the other half of the red. It reports `error TS2307: Cannot find module '../PacerControls'` and `'../StartReadingButton'`, `error TS2322` for `onReadSilently` (not in `AudioPlayerProps`) and `error TS2561` for `highlightLocked` (not in `Partial<ReadAlongTogglesProps>`).

- [ ] **Step 2: Green — the two components, the lock and the quiet `AudioPlayer`**

Create `frontend/src/components/StartReadingButton.tsx`:

```tsx
import { useId, useState } from "react";
import { Button, ButtonGroup, Menu, MenuItem } from "@mui/material";
import PlayIcon from "@mui/icons-material/PlayArrow";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import type { ReadingMode } from "../hooks/useReadAlongPreferences";
import { displayPercent } from "../utils/readingProgress";

interface StartReadingButtonProps {
  /** How far through the article the reader is, from 0 to 1. */
  progress: number;
  isRead: boolean;
  /** The remembered mode: what the main button starts and which menu item is marked. */
  mode: ReadingMode;
  /** Called with the mode to start in. The parent also remembers it as the new default. */
  onStart: (mode: ReadingMode) => void;
}

function mainLabel(progress: number, isRead: boolean): string {
  if (isRead) return "Read again";
  if (progress > 0) return `Continue reading · ${displayPercent(progress)}%`;
  return "Start reading";
}

/**
 * The idle reading surface, a split button. The main button starts reading in the remembered
 * mode and its label says where the reader is; the arrow opens a menu to start in either mode.
 */
export function StartReadingButton({ progress, isRead, mode, onStart }: StartReadingButtonProps) {
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);

  const choose = (chosen: ReadingMode) => {
    setAnchor(null);
    onStart(chosen);
  };

  return (
    <>
      <ButtonGroup variant="outlined" size="small">
        <Button
          onClick={() => onStart(mode)}
          startIcon={<PlayIcon />}
          data-testid="start-reading-button"
        >
          {mainLabel(progress, isRead)}
        </Button>
        <Button
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label="Choose how to read"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          data-testid="start-reading-menu"
        >
          <ArrowDropDownIcon />
        </Button>
      </ButtonGroup>
      <Menu
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { id: menuId, "aria-label": "Reading mode" } }}
      >
        <MenuItem
          role="menuitemradio"
          selected={mode === "sound"}
          onClick={() => choose("sound")}
          data-testid="read-with-sound"
        >
          Read with sound
        </MenuItem>
        <MenuItem
          role="menuitemradio"
          selected={mode === "silent"}
          onClick={() => choose("silent")}
          data-testid="read-silently"
        >
          Read silently
        </MenuItem>
      </Menu>
    </>
  );
}

export default StartReadingButton;
```

Create `frontend/src/components/PacerControls.tsx`:

```tsx
import { useEffect, useId, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Slider,
  Tooltip,
  Typography,
} from "@mui/material";
import PlayIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import StopIcon from "@mui/icons-material/Stop";
import { WPM_OPTIONS } from "../constants/audio";
import { wholePercent } from "../utils/readingProgress";

interface PacerControlsProps {
  isPlaying: boolean;
  /** How far through the article the pacer is, from 0 to 1. */
  fraction: number;
  /** Reading pace in words per minute. */
  wpm: number;
  onToggle: () => void;
  /** Moves the pacer to a fraction of the article, from 0 to 1. */
  onSeek: (fraction: number) => void;
  onWpmChange: (wpm: number) => void;
  onStop: () => void;
  /** Reports whether the pace menu is open, so the page can hold auto-scroll while it is. */
  onSpeedMenuOpenChange?: (open: boolean) => void;
}

/**
 * Controls for silent reading, where the pacer stands in for the audio clock. It uses the same
 * grid as `AudioPlayer`, with a reading position instead of a waveform and a pace in words per
 * minute instead of a playback rate.
 */
export function PacerControls({
  isPlaying,
  fraction,
  wpm,
  onToggle,
  onSeek,
  onWpmChange,
  onStop,
  onSpeedMenuOpenChange,
}: PacerControlsProps) {
  const menuId = useId();
  const [paceAnchor, setPaceAnchor] = useState<HTMLElement | null>(null);
  const paceOpen = Boolean(paceAnchor);
  const percent = wholePercent(fraction);

  useEffect(() => {
    onSpeedMenuOpenChange?.(paceOpen);
    return () => onSpeedMenuOpenChange?.(false);
  }, [paceOpen, onSpeedMenuOpenChange]);

  return (
    <Box
      data-testid="pacer-controls"
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "44px minmax(0, 1fr) auto 44px",
          sm: "44px minmax(80px, 1fr) auto auto 44px",
        },
        alignItems: "center",
        gap: 1,
        width: "100%",
      }}
    >
      <IconButton
        onClick={onToggle}
        aria-label={isPlaying ? "Pause" : "Play"}
        color="primary"
        data-testid="pacer-play-button"
        sx={{ width: 44, height: 44 }}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </IconButton>

      <Box sx={{ minWidth: 0, px: 1, gridColumn: { xs: "2 / -1", sm: "auto" } }}>
        <Slider
          aria-label="Reading position"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(_, value) => {
            if (typeof value === "number") onSeek(value / 100);
          }}
          getAriaValueText={(value) => `${value} percent`}
          data-testid="pacer-position"
        />
      </Box>

      <Typography
        variant="caption"
        data-testid="pacer-percent"
        sx={{ color: "text.secondary", minWidth: 45, gridColumn: { xs: "1 / 3", sm: "auto" } }}
      >
        {percent}%
      </Typography>

      <Tooltip title="Reading speed">
        <Button
          size="small"
          onClick={(e) => setPaceAnchor(e.currentTarget)}
          aria-label="Reading speed"
          aria-haspopup="menu"
          aria-expanded={paceOpen}
          aria-controls={paceOpen ? menuId : undefined}
          data-testid="pacer-speed-button"
          sx={{ color: "text.secondary", whiteSpace: "nowrap" }}
        >
          {wpm} wpm
        </Button>
      </Tooltip>
      <Menu
        anchorEl={paceAnchor}
        open={paceOpen}
        onClose={() => setPaceAnchor(null)}
        slotProps={{ list: { id: menuId, "aria-label": "Reading speed options" } }}
      >
        {WPM_OPTIONS.map((option) => (
          <MenuItem
            key={option}
            role="menuitemradio"
            selected={option === wpm}
            onClick={() => {
              onWpmChange(option);
              setPaceAnchor(null);
            }}
          >
            {option} words per minute
          </MenuItem>
        ))}
      </Menu>

      <Tooltip title="Stop reading">
        <IconButton
          onClick={onStop}
          aria-label="Stop reading"
          color="primary"
          data-testid="pacer-stop-button"
          sx={{ width: 44, height: 44 }}
        >
          <StopIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default PacerControls;
```

In `frontend/src/components/ReadAlongToggles.tsx` make five edits, in order.

1. Replace the import, so the component can name its note:

```tsx
import { Box, FormControlLabel, Switch, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
```

with:

```tsx
import { useId } from "react";
import { Box, FormControlLabel, Switch, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
```

2. Replace the last prop:

```tsx
  onHighlightModeChange: (value: HighlightMode) => void;
```

with:

```tsx
  onHighlightModeChange: (value: HighlightMode) => void;
  /** Keeps the highlight switch on and unchangeable, as while reading silently. */
  highlightLocked?: boolean;
```

3. Replace the end of the signature and the first line of the body:

```tsx
  onHighlightModeChange,
}: ReadAlongTogglesProps) {
  const continuousSupported = supportsContinuousHighlight();
```

with:

```tsx
  onHighlightModeChange,
  highlightLocked = false,
}: ReadAlongTogglesProps) {
  const lockedNoteId = useId();
  const continuousSupported = supportsContinuousHighlight();
```

4. Replace the highlight switch's props:

```tsx
            checked={highlight}
            onChange={(e) => onHighlightChange(e.target.checked)}
            size="small"
            slotProps={{ input: { "aria-label": "Highlight while playing" } }}
```

with:

```tsx
            checked={highlight || highlightLocked}
            disabled={highlightLocked}
            onChange={(e) => onHighlightChange(e.target.checked)}
            size="small"
            slotProps={{
              input: {
                "aria-label": "Highlight while playing",
                "aria-describedby": highlightLocked ? lockedNoteId : undefined,
              },
            }}
```

5. Replace the end of the "newer browser" caption, so the note for the lock follows it:

```tsx
          Continuous highlighting needs a newer browser. Using word by word.
        </Typography>
      )}
    </Box>
```

with:

```tsx
          Continuous highlighting needs a newer browser. Using word by word.
        </Typography>
      )}
      {highlightLocked && (
        <Typography id={lockedNoteId} variant="caption" color="text.secondary" sx={{ width: "100%" }}>
          Highlighting stays on while you read silently.
        </Typography>
      )}
    </Box>
```

In `frontend/src/components/AudioPlayer.tsx` make six edits, in order.

1. Replace the last prop:

```tsx
  onSpeedMenuOpenChange?: (open: boolean) => void;
}
```

with:

```tsx
  onSpeedMenuOpenChange?: (open: boolean) => void;
  /** When given, the error state offers a way out to silent reading. */
  onReadSilently?: () => void;
}
```

2. Replace the end of the component's doc comment:

```tsx
 * `player` prop (the parent owns `useAudioPlayer`). Supports:
 * - Lazy audio generation on first listen
 * - Play/pause toggle
 * - Progress bar with current time
 * - Error handling with retry
 */
```

with:

```tsx
 * `player` prop (the parent owns `useAudioPlayer`). Renders nothing while idle,
 * because `StartReadingButton` owns the idle state. Supports:
 * - Play/pause toggle
 * - Progress bar with current time
 * - Error handling with retry, and a way out to silent reading
 */
```

3. Replace the end of the signature:

```tsx
  onSpeedMenuOpenChange,
}: AudioPlayerProps) {
```

with:

```tsx
  onSpeedMenuOpenChange,
  onReadSilently,
}: AudioPlayerProps) {
```

4. Replace the listen handler, which nothing calls any more, together with the line that follows it:

```tsx
  const handleListenClick = () => {
    generateAudio();
  };

  const handleRetryClick = () => {
```

with:

```tsx
  const handleRetryClick = () => {
```

5. Replace the idle branch:

```tsx
  // Idle state - show listen button
  if (effectiveStatus === "idle" || (!effectiveUrl && status === "idle")) {
    return (
      <Button
        onClick={handleListenClick}
        aria-label="Listen to article"
        color="primary"
        variant="outlined"
        size="small"
        startIcon={<PlayIcon />}
        data-testid="listen-button"
      >
        Listen to article
      </Button>
    );
  }
```

with:

```tsx
  // Idle state - nothing to show; StartReadingButton owns it
  if (effectiveStatus === "idle" || (!effectiveUrl && status === "idle")) {
    return null;
  }
```

6. Replace the end of the error state:

```tsx
            <RetryIcon />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }
```

with:

```tsx
            <RetryIcon />
          </IconButton>
        </Tooltip>
        {onReadSilently && (
          <Button
            onClick={onReadSilently}
            size="small"
            variant="outlined"
            data-testid="audio-read-silently"
          >
            Read silently
          </Button>
        )}
      </Box>
    );
  }
```

Run the Step 1 command again:

```bash
docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/StartReadingButton.test.tsx src/components/__tests__/PacerControls.test.tsx src/components/__tests__/ReadAlongToggles.test.tsx src/components/__tests__/AudioPlayer.test.tsx
```

Expected: PASS, `Test Files  4 passed (4)` and `Tests  65 passed (65)`: 16 for `StartReadingButton`, 19 for `PacerControls`, 7 for `ReadAlongToggles` and 23 for `AudioPlayer` (the same 23 as before, with three idle tests replaced by one and two error-state tests added).

Why it is shaped this way:

- The main button has no `aria-label` and no tooltip, so its accessible name is its visible text (`Continue reading · 42%`). Someone who drives the page by voice says what they see (WCAG 2.5.3, Label in Name). The arrow has no visible text, so it is named `Choose how to read`.
- `Read again` is decided by `isRead` alone, before any progress is looked at, so a read article never offers `Continue reading` even if its stored progress is below 1.
- The percent comes from `displayPercent`, the helper the card's caption uses (Task 8), so a barely started article reads `1%`, never `0%`, and the two places agree. `PacerControls` uses `wholePercent` instead, because there `0%` is honest: the pacer really is at the start. That number is the pacer's position, which the reader can move freely, not the article's reading progress (the high-water mark that Task 14 reports).
- Both menus use `role="menuitemradio"` so that the marked item (the remembered mode, the current pace) reaches assistive technology as `aria-checked`, which MUI derives from `selected` for that role. A `role="menu"` needs an accessible name, so the lists are labelled `Reading mode` and `Reading speed options` through `slotProps.list`.
- `aria-controls` is set only while a menu is open: a closed MUI menu is not in the DOM, and an idref to a missing element is an invalid reference. The highlight switch's `aria-describedby` follows the same rule and points at the note only while the note is rendered.
- `PacerControls` is built from the same pieces as `AudioPlayer`'s player: 44 px buttons, a flexible middle track, a readout and a pace button, and on phones the slider keeps the first row beside the play button while the percent, the pace and stop wrap to a second. jsdom has no layout engine, so no unit test can see this; Task 18's Playwright spec checks that the controls fit a narrow viewport.
- The slider shows no value bubble: the percent beside it already says the same number, so a bubble would only be a second copy.
- `PacerControls` reports its pace menu the way `AudioPlayer` does (`onSpeedMenuOpenChange`, with a cleanup that reports `false`), so Task 17 can pause auto-scroll while the menu is open. Without it the page would keep scrolling underneath a menu the reader is choosing from. The cleanup matters as much as the report: stopping silent reading while the menu is open unmounts the controls, and the page must not be left believing a menu is still open.
- The pace button's accessible name is `Reading speed` while its visible text is `300 wpm`. That follows the audio player (`Playback speed` over `1.5x`) and the approved spec; the menu items spell the unit out (`300 words per minute`). If the label-in-name rule is ever applied to this button, change both buttons together.
- `highlightLocked` shows the switch on (`highlight || highlightLocked`) and disables it without touching the saved preference, so leaving silent reading gives the reader back whatever they had chosen. Silent reading has no audio, so the highlight is its only sign of position; that is why it cannot be switched off.
- The locked test asserts `toBeDisabled()` instead of clicking: `user-event` refuses to click an element MUI marks `pointer-events: none`, so a "clicking does nothing" test cannot be written (it would throw).
- `AudioPlayer` keeps its loading, generating, error and player states; only the idle one moved out, and `handleListenClick` went with it. `Read silently` sits in the error state because sound can fail (text-to-speech may be switched off or down) and the reader should not dead-end there. It has its own test id so end-to-end tests can tell it apart from the other `Read silently` controls the page offers.
- Three things are deliberately not asserted: the play and pause glyph in `PacerControls` (presentational), the explicit `aria-label`s on the pace and stop buttons (MUI's `Tooltip` gives a child without a label the same name, so they are redundant; they stay so the name does not depend on the wrapper), and the grid (see above).

- [ ] **Step 3: Verify the task**

```bash
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check src/components/StartReadingButton.tsx src/components/PacerControls.tsx src/components/__tests__/StartReadingButton.test.tsx src/components/__tests__/PacerControls.test.tsx src/components/__tests__/ReadAlongToggles.test.tsx
docker compose exec -T frontend pnpm test
```

Expected: `tsc -b` prints nothing; `pnpm lint` reports no new warnings (it already prints 4 older ones: `AuthContext.tsx`, `usePostsData.ts` exhaustive-deps, and `theme.tsx` twice); prettier accepts the five new files (if it flags one, run `pnpm exec prettier --write` on that new file only, and never on `AudioPlayer.tsx`, `ReadAlongToggles.tsx` or `AudioPlayer.test.tsx`); the whole Vitest suite passes, including `AudioVolume.test.tsx`, which renders the real `AudioPlayer` once a clip is ready.

- [ ] **Step 4: Commit (only if the user asked for commits)**

```bash
git add frontend/src/components/StartReadingButton.tsx frontend/src/components/PacerControls.tsx frontend/src/components/ReadAlongToggles.tsx frontend/src/components/AudioPlayer.tsx frontend/src/components/__tests__/StartReadingButton.test.tsx frontend/src/components/__tests__/PacerControls.test.tsx frontend/src/components/__tests__/ReadAlongToggles.test.tsx frontend/src/components/__tests__/AudioPlayer.test.tsx
git commit -m "feat(frontend): add StartReadingButton and PacerControls, lock the highlight while reading silently" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 17: The article page — start reading, silent pacing, saved progress and the switch between them

Everything Part B built comes together on the article page. `StartReadingButton` replaces the idle `Listen to article` button. Silent reading runs on the pacer and on the same highlight engine as the audio. Whichever clock is driving the article (the pacer or the audio element) also feeds `useReadingProgress`, so progress is saved the same way in both modes. A link under the controls moves the reader between sound and silent at the same place, the floating controls drive whichever of the two is on, and the state chip says `In progress · N%`. `useAudioPlayer.play()` also changes in one small way: the page now starts audio after an asynchronous load, outside the click that asked for it, and a browser may refuse that, so the player must fall back to `paused` instead of claiming to play.

Do Tasks 16 and 17 back to back. Task 16 removed the idle `Listen to article` button, and until this task puts `StartReadingButton` on the page there is no control that starts reading or listening.

**Files:**
- Modify: `frontend/src/pages/posts/PostDetailPage.tsx`
- Modify: `frontend/src/hooks/useAudioPlayer.ts`
- Create: `frontend/src/pages/posts/__tests__/PostDetailPage.reading.test.tsx`
- Create: `frontend/src/hooks/__tests__/useAudioPlayer.autoplay.test.tsx`

**Interfaces:**
- Consumes, all built earlier in Part B:
  - `useReadAlong({ …, paced })` and its `pacedDurationMs` result (Task 11).
  - `readingMode`, `setReadingMode`, `wpm` and `setWpm` from `useReadAlongPreferences()` (Task 12), and `WPM_OPTIONS` from `constants/audio`.
  - `usePacer(wpm)` (Task 13).
  - `useReadingProgress({ … })` and its `reset(progress)` (Task 14).
  - `FloatingAudioControls`' `speeds`, `formatSpeed`, `speedLabel` and `hideMute` props (Task 15).
  - `StartReadingButton`, `PacerControls`, `ReadAlongToggles`' `highlightLocked` and `AudioPlayer`'s `onReadSilently` (Task 16).
  - `displayPercent` (Task 8), and the `readProgress` the API now returns with a post (Tasks 6 and 8).
- Produces: no new exports. `PostDetailPage` gains the behaviour its tests describe, plus two test ids: `read-state-chip` (the Read, Unread or In progress chip) and `read-mode-switch` (the `Read silently` / `Listen instead` link). `useAudioPlayer.play()` sets the status to `playing` at once and goes back to `paused` if the browser refuses.

`PostDetailPage.tsx` and `useAudioPlayer.ts` are 2-space and pass prettier today; the replacements below are written to keep them passing. The two new test files are 2-space too.

- [ ] **Step 1: Red — the page's reading behaviour, and a player that survives a refused `play()`**

Two new test files. The page test mounts the real `PostDetailPage` with its real hooks and components. It fakes only the network (`api.get` and `api.put`), the `Audio` element and time, and it covers the whole flow from the reader's side: starting in either mode, switching between them, saving progress, leaving the article and the floating controls. The hook test is small: a browser may refuse `audio.play()` when no click started it directly, and the page starts audio after an asynchronous load.

The page test runs on fake timers, so it flushes with `await act(async () => { await vi.advanceTimersByTimeAsync(ms); })` and uses `fireEvent`: `waitFor` and `user-event` can hang under fake timers. The article is a one-word title plus 100 five-letter words, which silent reading paces at 240 ms a word at the base speed, so the figures in the tests are exact (24.24 s for the whole article, a little over 240 ms for each whole percent).

Create `frontend/src/hooks/__tests__/useAudioPlayer.autoplay.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAudioPlayer } from "../useAudioPlayer";

const { mockApi } = vi.hoisted(() => ({ mockApi: { get: vi.fn() } }));
vi.mock("../../services/api", async (original) => ({
  ...(await original<typeof import("../../services/api")>()),
  default: mockApi,
  api: mockApi,
}));

// What the next audio.play() hands back: a promise that settles, or nothing to wait on.
let playResult: () => Promise<void> | undefined;
const refused = () => Promise.reject(new DOMException("Not allowed", "NotAllowedError"));

class FakeAudio extends EventTarget {
  src: string;
  preload = "";
  playbackRate = 1;
  volume = 1;
  muted = false;
  paused = true;
  currentTime = 0;
  constructor(src: string) {
    super();
    this.src = src;
  }
  play() {
    this.paused = false;
    return playResult();
  }
  pause() {
    this.paused = true;
  }
}

async function readyPlayer() {
  mockApi.get.mockResolvedValue({ status: "ready", url: "/api/audio/p1.mp3", durationSeconds: 10 });
  const hook = renderHook(() => useAudioPlayer("p1"));
  await act(async () => {
    await hook.result.current.generateAudio();
  });
  return hook;
}

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  playResult = () => Promise.resolve();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// The reading flow starts audio after an async load, outside the click that asked for it, and a
// browser may refuse that. The player must not claim to be playing when nothing is.
describe("useAudioPlayer play()", () => {
  it("plays a loaded clip", async () => {
    const { result } = await readyPlayer();
    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
    expect(result.current.getMediaElement()?.paused).toBe(false);
  });

  it("plays when play() gives nothing to wait on", async () => {
    playResult = () => undefined;
    const { result } = await readyPlayer();
    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
  });

  it("resumes a paused clip", async () => {
    const { result } = await readyPlayer();
    act(() => result.current.play());
    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
    expect(result.current.getMediaElement()?.paused).toBe(false);
  });

  it("falls back to paused when the browser refuses a loaded clip", async () => {
    playResult = refused;
    const { result } = await readyPlayer();
    act(() => result.current.play());
    await waitFor(() => expect(result.current.status).toBe("paused"));
  });

  it("falls back to paused when the browser refuses to resume a clip", async () => {
    const { result } = await readyPlayer();
    act(() => result.current.play());
    act(() => result.current.pause());
    playResult = refused;
    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
    await waitFor(() => expect(result.current.status).toBe("paused"));
  });

  it("does nothing before the audio has loaded", () => {
    const { result } = renderHook(() => useAudioPlayer("p1"));
    act(() => result.current.play());
    expect(result.current.status).toBe("idle");
  });
});
```

Create `frontend/src/pages/posts/__tests__/PostDetailPage.reading.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { PostDetailPage } from "../PostDetailPage";
import { ApiError } from "../../../services/api";

const { mockApi } = vi.hoisted(() => ({ mockApi: { get: vi.fn(), put: vi.fn() } }));
vi.mock("../../../services/api", async (original) => ({
  ...(await original<typeof import("../../../services/api")>()),
  default: mockApi,
  api: mockApi,
}));

// A one-word title and a body of 100 five-letter words. Silent reading gives each such word
// 240 ms at the base pace, so the article takes 101 x 240 ms and the figures below are exact.
const READ_MS = 101 * 240;
const BODY = `<p>${Array.from({ length: 100 }, () => "alpha").join(" ")}</p>`;
const READY_AUDIO = { status: "ready", url: "/api/audio/p1.mp3", durationSeconds: 100 };
// The same 101 words with timings, one every 900 ms: the clip says word n during [900n, 900n + 800].
const TIMED_AUDIO = {
  ...READY_AUDIO,
  wordTimings: Array.from({ length: 101 }, (_, n) => ({
    text: n === 0 ? "Hello" : "alpha",
    startMs: n * 900,
    durationMs: 800,
  })),
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    feedId: "f1",
    feedTitle: "Feed",
    feedIconUrl: null,
    title: "Hello",
    content: BODY,
    summary: null,
    author: null,
    link: "https://example.com/p1",
    publishedAt: "2026-01-01T00:00:00Z",
    isRead: false,
    readProgress: 0,
    hasAudio: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src: string;
  preload = "";
  playbackRate = 1;
  volume = 1;
  muted = false;
  paused = true;
  #time = 0;
  constructor(src: string) {
    super();
    this.src = src;
    FakeAudio.instances.push(this);
  }
  get currentTime() {
    return this.#time;
  }
  set currentTime(seconds: number) {
    this.#time = seconds;
    this.dispatchEvent(new Event("seeking"));
    this.dispatchEvent(new Event("seeked"));
  }
  play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  /** Moves the playhead and reports it, as a playing element does. */
  advanceTo(seconds: number) {
    this.#time = seconds;
    this.dispatchEvent(new Event("timeupdate"));
  }
  /** Plays the clip out, as an element does when it reaches its end. */
  finish() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
    this.dispatchEvent(new Event("ended"));
  }
}

interface Backend {
  posts: Record<string, Record<string, unknown>>;
  audio: () => Promise<unknown>;
  saveProgress: (postId: string, progress: number) => Promise<unknown>;
}

/** Answers the page's requests like the server: the post, its audio, and saved progress. */
function serve(overrides: Partial<Backend> = {}) {
  const backend: Backend = {
    audio: async () => READY_AUDIO,
    saveProgress: async (postId, progress) => ({
      postId,
      isRead: progress >= 0.95,
      readProgress: progress,
      readAt: null,
    }),
    ...overrides,
    posts: { p1: detail(), p2: detail({ id: "p2", title: "Other" }), ...overrides.posts },
  };
  mockApi.get.mockImplementation(async (path: string) => {
    if (/^\/posts\/[^/]+\/audio$/.test(path)) return backend.audio();
    const post = /^\/posts\/([^/]+)$/.exec(path);
    if (post && backend.posts[post[1]]) return backend.posts[post[1]];
    throw new ApiError(404, "NOT_FOUND", "Post not found");
  });
  mockApi.put.mockImplementation(async (path: string, body: { progress?: number }) => {
    const saved = /^\/posts\/([^/]+)\/progress$/.exec(path);
    return saved ? backend.saveProgress(saved[1], body.progress ?? 0) : {};
  });
}

type ProgressCall = [path: string, body: { progress: number }, options: { keepalive: boolean }];
const progressCalls = () =>
  (mockApi.put.mock.calls as unknown[][]).filter(
    ([path]) => typeof path === "string" && path.endsWith("/progress")
  ) as ProgressCall[];
const lastSent = () => progressCalls().at(-1)?.[1].progress;
const audioRequests = () =>
  mockApi.get.mock.calls.filter(([path]) => String(path).endsWith("/audio")).length;

const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button data-testid="go-p2" onClick={() => navigate("/posts/p2")}>
        Next
      </button>
      <PostDetailPage />
    </>
  );
}

async function openPage() {
  render(
    <MemoryRouter initialEntries={["/posts/p1"]}>
      <Routes>
        <Route path="/posts/:id" element={<Harness />} />
      </Routes>
    </MemoryRouter>
  );
  await flush();
}

const chip = () => screen.getByTestId("read-state-chip");
const percentRead = () =>
  Number.parseInt(screen.getByTestId("pacer-percent").textContent ?? "", 10);
const words = () => document.querySelectorAll(".ra-word");
const spokenWord = () => {
  const spoken = document.querySelectorAll(".ra-active");
  expect(spoken).toHaveLength(1);
  return Number(spoken[0].getAttribute("data-ra-index"));
};

function start() {
  fireEvent.click(screen.getByTestId("start-reading-button"));
}

function startWithSound() {
  fireEvent.click(screen.getByTestId("start-reading-menu"));
  fireEvent.click(screen.getByTestId("read-with-sound"));
}

/** Opens the article and plays its clip, whose timings say one word after another. */
async function playTimedClip() {
  serve({ audio: async () => TIMED_AUDIO });
  await openPage();
  startWithSound();
  await flush();
  return FakeAudio.instances[0];
}

const viewportCallbacks: IntersectionObserverCallback[] = [];

function stubIntersectionObserver() {
  viewportCallbacks.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        viewportCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
}

/** Reports everything the page observes (the inline controls, the footer) as out of view. */
function leaveViewport() {
  act(() => {
    for (const callback of viewportCallbacks) {
      callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    }
  });
}

let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("Audio", FakeAudio);
  FakeAudio.instances = [];
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("the reading surface", () => {
  it("offers Start reading on an unread article", async () => {
    await openPage();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Start reading");
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(screen.queryByTestId("play-pause-button")).toBeNull();
    expect(screen.queryByTestId("read-mode-switch")).toBeNull();
    expect(chip()).toHaveTextContent(/^Unread$/);
  });

  it("offers no reading controls when there is nothing to read", async () => {
    serve({ posts: { p1: detail({ content: '<a href="https://example.com/c">Comments</a>' }) } });
    await openPage();
    expect(screen.getByTestId("post-title")).toBeInTheDocument();
    expect(screen.queryByTestId("start-reading-button")).toBeNull();
    expect(screen.queryByTestId("read-along-toggles")).toBeNull();
  });

  it("starts silent reading in place, with every word wrapped for highlighting", async () => {
    await openPage();
    start();
    await flush(2_000);
    expect(screen.queryByTestId("start-reading-button")).toBeNull();
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Pause");
    expect(percentRead()).toBeGreaterThanOrEqual(7);
    expect(percentRead()).toBeLessThanOrEqual(9);
    expect(words()).toHaveLength(101);
  });

  it("continues a partly read article where the reader left off", async () => {
    serve({ posts: { p1: detail({ readProgress: 0.42 }) } });
    await openPage();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Continue reading · 42%");
    expect(chip()).toHaveTextContent("In progress · 42%");
    start();
    await flush();
    expect(percentRead()).toBe(42);
    await flush(1_000);
    expect(percentRead()).toBeGreaterThan(42);
  });

  it("reads a finished article again from the top without saving anything", async () => {
    serve({ posts: { p1: detail({ isRead: true, readProgress: 1 }) } });
    await openPage();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Read again");
    expect(chip()).toHaveTextContent(/^Read$/);
    start();
    await flush();
    expect(percentRead()).toBe(0);
    await flush(3_000);
    expect(percentRead()).toBeGreaterThan(0);
    expect(progressCalls()).toHaveLength(0);
  });

  it("remembers the mode the reader started in", async () => {
    localStorage.setItem("readAlong.readingMode", "sound");
    await openPage();
    fireEvent.click(screen.getByTestId("start-reading-menu"));
    fireEvent.click(screen.getByTestId("read-silently"));
    await flush();
    expect(screen.getByTestId("pacer-controls")).toBeInTheDocument();
    expect(localStorage.getItem("readAlong.readingMode")).toBe("silent");
  });
});

describe("reading with sound", () => {
  it("waits for the audio, then plays it from the top", async () => {
    const audio = deferred<unknown>();
    serve({ audio: () => audio.promise });
    await openPage();
    startWithSound();
    await flush();
    expect(screen.getByText("Loading audio…")).toBeInTheDocument();
    expect(FakeAudio.instances).toHaveLength(0);
    await act(async () => {
      audio.resolve(READY_AUDIO);
    });
    await flush();
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(screen.getByTestId("play-pause-button")).toHaveAccessibleName("Pause");
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(localStorage.getItem("readAlong.readingMode")).toBe("sound");
  });

  it("resumes the audio at the stored place", async () => {
    localStorage.setItem("readAlong.readingMode", "sound");
    serve({ posts: { p1: detail({ readProgress: 0.5 }) } });
    await openPage();
    start();
    await flush();
    expect(FakeAudio.instances[0].currentTime).toBe(50);
    expect(FakeAudio.instances[0].paused).toBe(false);
  });

  it("plays a finished article again from the top", async () => {
    localStorage.setItem("readAlong.readingMode", "sound");
    serve({ posts: { p1: detail({ isRead: true, readProgress: 1 }) } });
    await openPage();
    start();
    await flush();
    expect(FakeAudio.instances[0].currentTime).toBe(0);
    expect(FakeAudio.instances[0].paused).toBe(false);
  });

  it("offers silent reading when the audio cannot be made", async () => {
    serve({
      audio: () =>
        Promise.reject(new ApiError(403, "EXTERNAL_PROCESSING_DISABLED", "Audio is disabled.")),
    });
    await openPage();
    startWithSound();
    await flush();
    expect(screen.getByTestId("audio-read-silently")).toBeInTheDocument();
    expect(screen.queryByTestId("read-mode-switch")).toBeNull();
    fireEvent.click(screen.getByTestId("audio-read-silently"));
    await flush(1_000);
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Pause");
    expect(percentRead()).toBeGreaterThan(0);
  });

  it("plays once Retry gets the audio the start was waiting for", async () => {
    let attempts = 0;
    serve({
      audio: async () => {
        attempts += 1;
        if (attempts === 1) throw new ApiError(500, "SERVER_ERROR", "Try again.");
        return READY_AUDIO;
      },
    });
    await openPage();
    startWithSound();
    await flush();
    expect(FakeAudio.instances).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry audio generation" }));
    await flush();
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(screen.getByTestId("play-pause-button")).toHaveAccessibleName("Pause");
  });

  it("reports listening progress from the audio clock", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => FakeAudio.instances[0].advanceTo(4));
    await flush();
    expect(lastSent()).toBeCloseTo(0.04, 5);
    expect(chip()).toHaveTextContent("In progress · 4%");
  });

  it("does not play a clip again once it has played to the end", async () => {
    await openPage();
    startWithSound();
    await flush();
    const media = FakeAudio.instances[0];
    expect(media.paused).toBe(false);
    act(() => media.finish());
    await flush();
    expect(media.paused).toBe(true);
    expect(screen.getByTestId("play-pause-button")).toHaveAccessibleName("Play");
  });
});

describe("switching between sound and silent", () => {
  it("goes from a playing clip to silent reading at the same place", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    const media = FakeAudio.instances[0];
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => media.advanceTo(30));
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(media.paused).toBe(true);
    expect(screen.getByTestId("read-mode-switch")).toHaveTextContent("Listen instead");
    expect(percentRead()).toBe(30);
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Pause");
    expect(localStorage.getItem("readAlong.readingMode")).toBe("silent");
  });

  it("goes from a clip nobody played to silent reading at the stored place", async () => {
    serve({ posts: { p1: detail({ hasAudio: true, readProgress: 0.3 }) } });
    await openPage();
    expect(screen.getByTestId("read-mode-switch")).toHaveTextContent("Read silently");
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(percentRead()).toBe(30);
  });

  it("goes from silent reading to the clip at the same place", async () => {
    await openPage();
    start();
    await flush(6_000);
    const left = percentRead();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    const media = FakeAudio.instances[0];
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(media.paused).toBe(false);
    expect(Math.floor(media.currentTime)).toBe(left);
    expect(screen.getByTestId("play-pause-button")).toHaveAccessibleName("Pause");
    expect(localStorage.getItem("readAlong.readingMode")).toBe("sound");
  });

  it("goes back to a loaded clip without loading it again", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush(6_000);
    const left = percentRead();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audioRequests()).toBe(1);
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(Math.floor(FakeAudio.instances[0].currentTime)).toBe(left);
  });

  it("listens from the place the reader chose, even when that is the very start", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    const media = FakeAudio.instances[0];
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => media.advanceTo(30));
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    fireEvent.change(screen.getByRole("slider", { name: "Reading position" }), {
      target: { value: "0" },
    });
    await flush();
    expect(percentRead()).toBe(0);
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(media.currentTime).toBe(0);
    expect(media.paused).toBe(false);
  });

  it("asks for the audio again when the reader comes back to it after a failure", async () => {
    let healthy = false;
    serve({
      audio: async () => {
        if (!healthy) throw new ApiError(500, "SERVER_ERROR", "Try again.");
        return READY_AUDIO;
      },
    });
    await openPage();
    startWithSound();
    await flush();
    fireEvent.click(screen.getByTestId("audio-read-silently"));
    await flush(6_000);
    const left = percentRead();
    healthy = true;
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(audioRequests()).toBe(2);
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(Math.floor(FakeAudio.instances[0].currentTime)).toBe(left);
  });

  it("waits for a clip that is still loading when the reader goes back to it", async () => {
    const audio = deferred<unknown>();
    serve({ audio: () => audio.promise });
    await openPage();
    startWithSound();
    await flush();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush(6_000);
    const left = percentRead();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(audioRequests()).toBe(1);
    await act(async () => {
      audio.resolve(READY_AUDIO);
    });
    await flush();
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(Math.floor(FakeAudio.instances[0].currentTime)).toBe(left);
  });
});

describe("silent reading controls", () => {
  it("pauses, resumes, seeks and changes the pace", async () => {
    await openPage();
    start();
    await flush(1_000);
    fireEvent.click(screen.getByTestId("pacer-play-button"));
    await flush();
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Play");
    const held = percentRead();
    await flush(3_000);
    expect(percentRead()).toBe(held);

    fireEvent.change(screen.getByRole("slider", { name: "Reading position" }), {
      target: { value: "40" },
    });
    await flush();
    expect(percentRead()).toBe(40);

    fireEvent.click(screen.getByTestId("pacer-speed-button"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "300 words per minute" }));
    expect(localStorage.getItem("readAlong.wpm")).toBe("300");
    expect(screen.getByTestId("pacer-speed-button")).toHaveTextContent("300 wpm");

    fireEvent.click(screen.getByTestId("pacer-play-button"));
    await flush(5_000);
    // Five seconds at 300 wpm cover six seconds of the 24.24 s article, so 40% becomes about 65%.
    expect(percentRead()).toBeGreaterThanOrEqual(63);
    expect(percentRead()).toBeLessThanOrEqual(66);
  });

  it("stops and remembers the place", async () => {
    await openPage();
    start();
    await flush(6_000);
    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    const saved = lastSent()!;
    expect(saved).toBeGreaterThan(0.2);
    expect(saved).toBeLessThan(0.3);
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent(
      `Continue reading · ${Math.floor(saved * 100)}%`
    );
  });

  it("starts another session after stopping", async () => {
    await openPage();
    start();
    await flush(6_000);
    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    const resumeAt = Math.floor(lastSent()! * 100);
    start();
    await flush();
    expect(percentRead()).toBe(resumeAt);
    await flush(1_000);
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Pause");
    expect(percentRead()).toBeGreaterThan(resumeAt);
  });

  it("saves the place the reader had reached at the moment of stopping", async () => {
    await openPage();
    start();
    // The pacer reports its place about every 250 ms, so the last report is behind by now.
    await flush(2_740);
    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    expect(lastSent()).toBeGreaterThan(0.11);
  });

  it("leaves nothing running once the reader stops", async () => {
    await openPage();
    const idle = vi.getTimerCount();
    start();
    await flush(1_000);
    expect(vi.getTimerCount()).toBeGreaterThan(idle);
    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush(1_000);
    expect(vi.getTimerCount()).toBe(idle);
  });
});

describe("highlighting and auto-scroll", () => {
  const highlightSwitch = () => screen.getByRole("switch", { name: "Highlight while playing" });

  it("marks the word being read as the pacer moves on", async () => {
    await openPage();
    start();
    await flush(2_000);
    expect(spokenWord()).toBe(8);
    await flush(2_000);
    expect(spokenWord()).toBe(16);
  });

  it("keeps highlighting on while the reader reads silently", async () => {
    localStorage.setItem("readAlong.highlight", "false");
    await openPage();
    expect(highlightSwitch()).not.toBeChecked();
    expect(highlightSwitch()).toBeEnabled();
    expect(words()).toHaveLength(0);

    start();
    await flush();
    expect(highlightSwitch()).toBeChecked();
    expect(highlightSwitch()).toBeDisabled();
    expect(screen.getByText("Highlighting stays on while you read silently.")).toBeInTheDocument();
    expect(words().length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    expect(highlightSwitch()).not.toBeChecked();
    expect(highlightSwitch()).toBeEnabled();
    expect(words()).toHaveLength(0);
    expect(localStorage.getItem("readAlong.highlight")).toBe("false");
  });

  it("holds auto-scroll while the pace menu is open", async () => {
    await openPage();
    start();
    await flush(1_000);
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("pacer-speed-button"));
    await flush();
    scrollIntoView.mockClear();
    await flush(2_000);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "250 words per minute" }));
    await flush(2_000);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("highlighting with sound", () => {
  it("marks the word being spoken as the clip plays", async () => {
    const media = await playTimedClip();
    act(() => media.advanceTo(9.5));
    await flush(100);
    expect(spokenWord()).toBe(10);
    act(() => media.advanceTo(18.2));
    await flush(100);
    expect(spokenWord()).toBe(20);
  });

  it("holds auto-scroll while the speed menu of the audio player is open", async () => {
    const media = await playTimedClip();
    act(() => media.advanceTo(2));
    await flush(100);
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("speed-button"));
    await flush();
    scrollIntoView.mockClear();
    act(() => media.advanceTo(9.5));
    await flush(100);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: "1.5x" }));
    act(() => media.advanceTo(18.2));
    await flush(100);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("saving progress", () => {
  it("saves silent reading and shows it as in progress", async () => {
    await openPage();
    start();
    await flush(500);
    expect(progressCalls()).toHaveLength(1);
    expect(progressCalls()[0][0]).toBe("/posts/p1/progress");
    expect(progressCalls()[0][2]).toEqual({ keepalive: false });

    await flush(11_000);
    expect(progressCalls()).toHaveLength(2);
    const shown = Math.floor(lastSent()! * 100);
    expect(shown).toBeGreaterThan(30);
    expect(chip()).toHaveTextContent(`In progress · ${shown}%`);
  });

  it("marks the article Read when the reader gets to the end", async () => {
    await openPage();
    start();
    await flush(READ_MS + 1_000);
    expect(lastSent()).toBeGreaterThanOrEqual(0.95);
    expect(chip()).toHaveTextContent(/^Read$/);
    expect(screen.getByTestId("read-state-toggle")).toHaveAttribute("data-is-read", "true");
    const saves = progressCalls().length;
    await flush(30_000);
    expect(progressCalls()).toHaveLength(saves);
  });

  it("stops saving once the reader marks the article read", async () => {
    await openPage();
    start();
    await flush(3_000);
    const saves = progressCalls().length;
    expect(saves).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("read-state-toggle"));
    await flush();
    expect(mockApi.put).toHaveBeenCalledWith("/posts/p1/read-state", { isRead: true });
    expect(chip()).toHaveTextContent(/^Read$/);
    await flush(30_000);
    expect(progressCalls()).toHaveLength(saves);

    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Read again");
  });

  it("ignores a save that lands after the reader marked the article read", async () => {
    const slow = deferred<unknown>();
    serve({ saveProgress: () => slow.promise });
    await openPage();
    start();
    await flush(500);
    expect(progressCalls()).toHaveLength(1);

    fireEvent.click(screen.getByTestId("read-state-toggle"));
    await flush();
    expect(chip()).toHaveTextContent(/^Read$/);
    await act(async () => {
      slow.resolve({ postId: "p1", isRead: false, readProgress: 0.01, readAt: null });
    });
    await flush();
    expect(chip()).toHaveTextContent(/^Read$/);
  });

  it("saves nothing when a finished article is read through again", async () => {
    // Anything from 95% counts as read, so a finished article need not be stored as 100%.
    serve({ posts: { p1: detail({ isRead: true, readProgress: 0.96 }) } });
    await openPage();
    start();
    await flush(READ_MS + 1_000);
    expect(progressCalls()).toHaveLength(0);
    expect(chip()).toHaveTextContent(/^Read$/);
  });

  it("starts a read article over when the reader marks it unread", async () => {
    serve({ posts: { p1: detail({ isRead: true, readProgress: 1 }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("read-state-toggle"));
    await flush();
    expect(mockApi.put).toHaveBeenCalledWith("/posts/p1/read-state", { isRead: false });
    expect(chip()).toHaveTextContent(/^Unread$/);
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Start reading");

    start();
    await flush(1_000);
    expect(progressCalls().length).toBeGreaterThan(0);
  });

  it("saves nothing while the clip replays ground the reader already covered", async () => {
    serve({ posts: { p1: detail({ hasAudio: true, readProgress: 0.4 }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("play-pause-button"));
    const media = FakeAudio.instances[0];
    for (let seconds = 4; seconds <= 40; seconds += 4) {
      act(() => media.advanceTo(seconds));
      await flush(1_000);
    }
    expect(progressCalls()).toHaveLength(0);
    expect(chip()).toHaveTextContent("In progress · 40%");

    act(() => media.advanceTo(44));
    await flush();
    expect(lastSent()).toBeCloseTo(0.44, 5);
  });

  it("keeps saving when the reader switches between sound and silent", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    const media = FakeAudio.instances[0];
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => media.advanceTo(4));
    await flush();
    expect(lastSent()).toBeCloseTo(0.04, 5);

    // Eleven seconds of silent reading add 11 of the article's 24.24 seconds to the 4% already read.
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush(11_000);
    expect(lastSent()).toBeGreaterThan(0.43);
    expect(lastSent()).toBeLessThan(0.47);

    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush(10_000);
    const resumedAt = media.currentTime;
    act(() => media.advanceTo(resumedAt + 4));
    await flush();
    expect(lastSent()).toBeCloseTo((resumedAt + 4) / 100, 5);
  });
});

describe("leaving the article", () => {
  it("saves the place and starts the next article idle", async () => {
    await openPage();
    start();
    await flush(3_000);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    const last = progressCalls().at(-1)!;
    expect(last[0]).toBe("/posts/p1/progress");
    expect(last[1].progress).toBeGreaterThan(0.1);
    expect(screen.getByTestId("post-title")).toHaveTextContent("Other");
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Start reading");
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(chip()).toHaveTextContent(/^Unread$/);
  });

  it("saves the place the reader had reached at the moment of leaving", async () => {
    await openPage();
    start();
    // The pacer reports its place about every 250 ms, so the last report is behind by now.
    await flush(2_740);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    expect(lastSent()).toBeGreaterThan(0.11);
  });

  it("ignores a late save for the article the reader left", async () => {
    const slow = deferred<unknown>();
    serve({
      saveProgress: (postId, progress) =>
        postId === "p1"
          ? slow.promise
          : Promise.resolve({ postId, isRead: false, readProgress: progress, readAt: null }),
    });
    await openPage();
    start();
    await flush(500);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    await act(async () => {
      slow.resolve({ postId: "p1", isRead: true, readProgress: 1, readAt: "2026-01-02T00:00:00Z" });
    });
    await flush();
    expect(screen.getByTestId("post-title")).toHaveTextContent("Other");
    expect(chip()).toHaveTextContent(/^Unread$/);
  });

  it("saves the place when the page closes", async () => {
    await openPage();
    start();
    await flush(3_000);
    const saves = progressCalls().length;
    cleanup();
    expect(progressCalls().length).toBeGreaterThan(saves);
    expect(lastSent()).toBeGreaterThan(0.1);
  });

  it("tracks the next article from its own start, not from the last one's place", async () => {
    serve({ posts: { p1: detail({ readProgress: 0.6 }) } });
    await openPage();
    start();
    await flush(500);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    start();
    await flush(2_000);
    const saved = progressCalls().filter(([path]) => path === "/posts/p2/progress");
    expect(saved.length).toBeGreaterThan(0);
    expect(saved[0][1].progress).toBeLessThan(0.1);
  });

  it("does not play the next article's clip for a start that was made on this one", async () => {
    let attempts = 0;
    serve({
      audio: async () => {
        attempts += 1;
        if (attempts === 1) throw new ApiError(500, "SERVER_ERROR", "Try again.");
        return READY_AUDIO;
      },
    });
    await openPage();
    startWithSound();
    await flush();
    expect(FakeAudio.instances).toHaveLength(0);

    // The player keeps its status when the article changes, so the failure is offered again here.
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Retry audio generation" }));
    await flush();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].paused).toBe(true);
  });

  it("leaves nothing running when the reader moves on while reading", async () => {
    await openPage();
    const idle = vi.getTimerCount();
    start();
    await flush(1_000);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush(1_000);
    expect(vi.getTimerCount()).toBe(idle);
  });
});

describe("floating controls", () => {
  beforeEach(() => {
    stubIntersectionObserver();
  });

  it("show the pace for silent reading and drive the pacer", async () => {
    await openPage();
    start();
    await flush(500);
    leaveViewport();
    expect(screen.getByTestId("floating-audio-controls")).toBeInTheDocument();
    expect(screen.queryByTestId("floating-mute-button")).toBeNull();
    expect(screen.getByTestId("floating-speed-button")).toHaveAccessibleName("Reading speed");
    expect(screen.getByTestId("floating-speed-button")).toHaveTextContent("250");

    fireEvent.click(screen.getByTestId("floating-speed-button"));
    fireEvent.click(screen.getByRole("button", { name: "Set speed 300" }));
    expect(localStorage.getItem("readAlong.wpm")).toBe("300");
    expect(screen.getByTestId("floating-speed-button")).toHaveTextContent("300");

    fireEvent.click(screen.getByTestId("floating-play-button"));
    expect(screen.getByTestId("floating-play-button")).toHaveAccessibleName("Play");
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Play");
  });

  it("hold auto-scroll while their pace options are open", async () => {
    await openPage();
    start();
    await flush(500);
    leaveViewport();
    fireEvent.click(screen.getByTestId("floating-speed-button"));
    await flush();
    scrollIntoView.mockClear();
    await flush(2_000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("hold auto-scroll while their speed options for the clip are open", async () => {
    const media = await playTimedClip();
    leaveViewport();
    act(() => media.advanceTo(2));
    await flush(100);
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("floating-speed-button"));
    await flush();
    scrollIntoView.mockClear();
    act(() => media.advanceTo(9.5));
    await flush(100);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Set speed 1.5x" }));
    act(() => media.advanceTo(18.2));
    await flush(100);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("are the audio controls, and only those, after the reader switches to sound", async () => {
    await openPage();
    start();
    await flush(1_000);
    leaveViewport();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    leaveViewport();
    expect(screen.getAllByTestId("floating-audio-controls")).toHaveLength(1);
    expect(screen.getByTestId("floating-speed-button")).toHaveAccessibleName("Playback speed");
    expect(screen.getByTestId("floating-mute-button")).toBeInTheDocument();
  });

  it("are the pace controls alone while the reader reads silently with a clip loaded", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => FakeAudio.instances[0].advanceTo(10));
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    leaveViewport();
    expect(screen.getAllByTestId("floating-audio-controls")).toHaveLength(1);
    expect(screen.getByTestId("floating-speed-button")).toHaveAccessibleName("Reading speed");
  });
});
```

Run:

```bash
docker compose exec -T frontend pnpm exec vitest run src/pages/posts/__tests__/PostDetailPage.reading.test.tsx src/hooks/__tests__/useAudioPlayer.autoplay.test.tsx
```

Expected: FAIL, `Test Files  2 failed (2)` and `Tests  51 failed | 5 passed (56)`. The five that pass pin down behaviour that must not change: four in `useAudioPlayer.autoplay.test.tsx` (it plays a loaded clip, plays when `play()` gives nothing to wait on, resumes a paused clip and does nothing before the audio has loaded) and, in `PostDetailPage.reading.test.tsx`, `offers no reading controls when there is nothing to read`. The page tests fail for the right reasons: the page has no `start-reading-button`, `start-reading-menu`, `read-mode-switch` or `read-state-chip`, and it saves no progress (`expected undefined to be close to 0.04`). The two `falls back to paused` tests fail with `expected 'playing' to be 'paused'`, and Vitest also reports `Errors  2 errors`: two `NotAllowedError: Not allowed` unhandled rejections, because today's `play()` ignores the promise that `audio.play()` returns, so a refusal goes unhandled.

- [ ] **Step 2: Green — wire the page, and let `play()` survive a refusal**

In `frontend/src/pages/posts/PostDetailPage.tsx` (2-space) make nine edits, in order. Each "old" text is unique in the file as it stands before the edit.

1. Replace the imports:

```tsx
import { AudioPlayer } from "../../components/AudioPlayer";
import { FloatingAudioControls } from "../../components/FloatingAudioControls";
import { ReadAlongToggles } from "../../components/ReadAlongToggles";
import { useAudioPlayer } from "../../hooks/useAudioPlayer";
import { useReadAlong } from "../../hooks/useReadAlong";
import { useReadAlongPreferences } from "../../hooks/useReadAlongPreferences";
import { hasReadableContent } from "../../utils/readableContent";
```

with:

```tsx
import { AudioPlayer } from "../../components/AudioPlayer";
import { FloatingAudioControls } from "../../components/FloatingAudioControls";
import { PacerControls } from "../../components/PacerControls";
import { ReadAlongToggles } from "../../components/ReadAlongToggles";
import { StartReadingButton } from "../../components/StartReadingButton";
import { WPM_OPTIONS } from "../../constants/audio";
import { useAudioPlayer, type AudioStatus } from "../../hooks/useAudioPlayer";
import { usePacer } from "../../hooks/usePacer";
import { useReadAlong } from "../../hooks/useReadAlong";
import { useReadAlongPreferences, type ReadingMode } from "../../hooks/useReadAlongPreferences";
import { useReadingProgress } from "../../hooks/useReadingProgress";
import { displayPercent } from "../../utils/readingProgress";
import { hasReadableContent } from "../../utils/readableContent";
```

2. Replace the end of `PostDetailResponse`, so the page knows the stored progress, and add the page's own declarations below it:

```tsx
  isRead: boolean;
  hasAudio: boolean;
}
```

with:

```tsx
  isRead: boolean;
  readProgress: number;
  hasAudio: boolean;
}

interface PendingStart {
  mode: ReadingMode;
  fraction: number;
}

// The statuses in which the audio element exists, so its clock means something.
const TRACKED_AUDIO_STATUSES: readonly AudioStatus[] = ["ready", "playing", "paused"];

const formatWpm = (value: number) => `${value}`;
```

3. Replace the `useReadAlong` call. It now chooses the clock, owns the pacer and the start request, and starts the reading that the request asked for:

```tsx
  useReadAlong({
    timings: player.wordTimings,
    getMediaElement: player.getMediaElement,
    isPlaying: player.isPlaying,
    titleRef,
    contentRef,
    highlightEnabled: readAlongPrefs.highlight,
    highlightMode: readAlongPrefs.highlightMode,
    autoScrollEnabled: readAlongPrefs.autoScroll && !inlineSpeedOpen && !floatingSpeedOpen,
    contentVersion: allowPublisherImages,
  });
```

with:

```tsx
  // Silent reading is paced by a timer instead of the audio clock. A start request waits in
  // pendingStart until what it needs exists: the paced timeline, or the loaded clip. The slot
  // holds one request, and a newer one replaces it.
  const pacer = usePacer(readAlongPrefs.wpm);
  const [silentActive, setSilentActive] = useState(false);
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  const {
    getClock: getPacerClock,
    setDurationMs,
    seekToFraction,
    play: playPacer,
    stop: stopPacer,
  } = pacer;
  const {
    status: audioStatus,
    durationSeconds: audioDuration,
    getMediaElement: getAudioClock,
    seek: seekAudio,
    play: playAudio,
  } = player;
  const getClock = useCallback(
    () => (silentActive ? getPacerClock() : getAudioClock()),
    [silentActive, getPacerClock, getAudioClock]
  );

  const { pacedDurationMs } = useReadAlong({
    timings: player.wordTimings,
    getMediaElement: getClock,
    isPlaying: silentActive ? pacer.isPlaying : player.isPlaying,
    titleRef,
    contentRef,
    highlightEnabled: readAlongPrefs.highlight || silentActive,
    highlightMode: readAlongPrefs.highlightMode,
    autoScrollEnabled: readAlongPrefs.autoScroll && !inlineSpeedOpen && !floatingSpeedOpen,
    contentVersion: allowPublisherImages,
    paced: silentActive,
  });

  // The paced timeline exists only once the words are wrapped. Size the pacer from it, and
  // only then let a waiting silent start run.
  useEffect(() => {
    setDurationMs(pacedDurationMs);
  }, [pacedDurationMs, setDurationMs]);

  useEffect(() => {
    if (pendingStart?.mode !== "silent" || pacedDurationMs <= 0) return;
    seekToFraction(pendingStart.fraction);
    playPacer();
    setPendingStart(null);
  }, [pendingStart, pacedDurationMs, seekToFraction, playPacer]);

  useEffect(() => {
    if (pendingStart?.mode !== "sound" || audioStatus !== "ready") return;
    setPendingStart(null);
    if (audioDuration) seekAudio(pendingStart.fraction * audioDuration);
    playAudio();
  }, [pendingStart, audioStatus, audioDuration, seekAudio, playAudio]);

  // Moving to another article ends the reading session.
  useEffect(
    () => () => {
      stopPacer();
      setSilentActive(false);
      setPendingStart(null);
    },
    [postId, stopPacer]
  );
```

4. Replace the comment above the preload effect, which still talks about the button that Task 16 removed:

```tsx
  // If the post already has generated audio, load it right away so the player
  // shows the controls instead of the "Listen to article" button. Runs once
  // per post when audio availability is known; generateAudio only fetches the
  // existing file (it does not re-synthesize).
```

with:

```tsx
  // If the post already has generated audio, load it right away so the player
  // shows its controls instead of the start button. Runs once per post when
  // audio availability is known; generateAudio only fetches the existing file
  // (it does not re-synthesize).
```

5. Replace the read-state handler, and put the progress hook above it. The hook follows whichever clock is driving the article, and the handler now keeps the tracker in step with the reader's choice:

```tsx
  // Handle read state toggle
  const handleToggleReadState = useCallback(async (id: string, isRead: boolean) => {
    await api.put(`/posts/${id}/read-state`, { isRead });
    setPost((prev) => (prev ? { ...prev, isRead } : null));
  }, []);
```

with:

```tsx
  // Progress follows whichever clock is driving the article: the pacer while
  // reading silently, the audio element otherwise.
  const trackedPost = post?.id === postId ? post : null;
  const { reset: resetProgress } = useReadingProgress({
    postId: postId ?? "",
    initialProgress: trackedPost?.readProgress ?? 0,
    enabled:
      trackedPost !== null &&
      !trackedPost.isRead &&
      (silentActive || TRACKED_AUDIO_STATUSES.includes(audioStatus)),
    clockKey: silentActive ? "silent" : "audio",
    getClock,
    getDurationSeconds: () => (silentActive ? pacedDurationMs / 1000 : (audioDuration ?? 0)),
    onUpdate: (report) =>
      setPost((prev) =>
        prev ? { ...prev, readProgress: report.readProgress, isRead: report.isRead } : prev
      ),
  });

  // Handle read state toggle. The reader's choice wins over any save still in flight.
  const handleToggleReadState = useCallback(
    async (id: string, isRead: boolean) => {
      await api.put(`/posts/${id}/read-state`, { isRead });
      setPost((prev) => (prev ? { ...prev, isRead, readProgress: isRead ? 1 : 0 } : null));
      resetProgress(isRead ? 1 : 0);
    },
    [resetProgress]
  );
```

6. Replace the line that decides whether the article is readable, and add the handlers that start, stop and switch reading below it. They sit after the early returns, so they may use `post`:

```tsx
  const readable = hasReadableContent(post.content || post.summary);

  return (
```

with:

```tsx
  const readable = hasReadableContent(post.content || post.summary);

  // A finished article starts over; any other starts where the reader left off.
  const storedFraction = post.isRead ? 0 : post.readProgress;

  const startSilent = (fraction: number) => {
    setPendingStart({ mode: "silent", fraction });
    setSilentActive(true);
  };

  const startSound = (fraction: number) => {
    if (audioStatus === "ready" || audioStatus === "paused") {
      if (audioDuration) seekAudio(fraction * audioDuration);
      playAudio();
      return;
    }
    setPendingStart({ mode: "sound", fraction });
    // The player ignores this while a load is already under way.
    void player.generateAudio();
  };

  const handleStart = (mode: ReadingMode) => {
    readAlongPrefs.setReadingMode(mode);
    if (mode === "silent") startSilent(storedFraction);
    else startSound(storedFraction);
  };

  const stopSilent = () => {
    stopPacer();
    setSilentActive(false);
  };

  // Each switch carries the reader's place over to the other clock.
  const switchToSilent = () => {
    const place =
      player.currentTime > 0 && audioDuration ? player.currentTime / audioDuration : storedFraction;
    player.pause();
    readAlongPrefs.setReadingMode("silent");
    startSilent(place);
  };

  const switchToSound = () => {
    const place = pacer.fraction;
    stopSilent();
    readAlongPrefs.setReadingMode("sound");
    startSound(place);
  };

  // The pacer speaks the audio controls' language so the floating bar can drive either.
  const silentPlayer = {
    isPlaying: pacer.isPlaying,
    status: pacer.status,
    toggle: pacer.toggle,
    playbackRate: readAlongPrefs.wpm,
    setPlaybackRate: readAlongPrefs.setWpm,
    isMuted: false,
    toggleMute: () => {},
  };

  return (
```

7. Replace the start of the state chip, so it shows the progress:

```tsx
          <Chip
            label={post.isRead ? "Read" : "Unread"}
            size="small"
```

with:

```tsx
          <Chip
            data-testid="read-state-chip"
            label={
              post.isRead
                ? "Read"
                : post.readProgress > 0
                  ? `In progress · ${displayPercent(post.readProgress)}%`
                  : "Unread"
            }
            size="small"
```

8. Replace the audio player block. The box now holds the pacer, the start button or the player, and the link that switches between sound and silent:

```tsx
        {/* Audio player */}
        {readable && (
          <Box sx={{ my: 2 }} ref={playerRef}>
            <AudioPlayer player={player} onSpeedMenuOpenChange={setInlineSpeedOpen} />
            <ReadAlongToggles
              highlight={readAlongPrefs.highlight}
              onHighlightChange={readAlongPrefs.setHighlight}
              autoScroll={readAlongPrefs.autoScroll}
              onAutoScrollChange={readAlongPrefs.setAutoScroll}
              highlightMode={readAlongPrefs.highlightMode}
              onHighlightModeChange={readAlongPrefs.setHighlightMode}
            />
          </Box>
        )}
```

with:

```tsx
        {/* Reading controls: the pacer, the start button or the audio player */}
        {readable && (
          <Box sx={{ my: 2 }} ref={playerRef}>
            {silentActive ? (
              <PacerControls
                isPlaying={pacer.isPlaying}
                fraction={pacer.fraction}
                wpm={readAlongPrefs.wpm}
                onToggle={pacer.toggle}
                onSeek={seekToFraction}
                onWpmChange={readAlongPrefs.setWpm}
                onStop={stopSilent}
                onSpeedMenuOpenChange={setInlineSpeedOpen}
              />
            ) : audioStatus === "idle" ? (
              <StartReadingButton
                progress={post.readProgress}
                isRead={post.isRead}
                mode={readAlongPrefs.readingMode}
                onStart={handleStart}
              />
            ) : (
              <AudioPlayer
                player={player}
                onSpeedMenuOpenChange={setInlineSpeedOpen}
                onReadSilently={switchToSilent}
              />
            )}
            <ReadAlongToggles
              highlight={readAlongPrefs.highlight}
              onHighlightChange={readAlongPrefs.setHighlight}
              autoScroll={readAlongPrefs.autoScroll}
              onAutoScrollChange={readAlongPrefs.setAutoScroll}
              highlightMode={readAlongPrefs.highlightMode}
              onHighlightModeChange={readAlongPrefs.setHighlightMode}
              highlightLocked={silentActive}
            />
            {(silentActive || (audioStatus !== "idle" && audioStatus !== "error")) && (
              <Box sx={{ mt: 0.5 }}>
                <Button
                  size="small"
                  onClick={silentActive ? switchToSound : switchToSilent}
                  data-testid="read-mode-switch"
                >
                  {silentActive ? "Listen instead" : "Read silently"}
                </Button>
              </Box>
            )}
          </Box>
        )}
```

9. Replace the floating controls. One bar drives whichever of the two is on:

```tsx
      {readable && (
        <FloatingAudioControls
          player={player}
          anchorRef={playerRef}
          footerRef={footerRef}
          onSpeedMenuOpenChange={setFloatingSpeedOpen}
        />
      )}
```

with:

```tsx
      {readable && silentActive && (
        <FloatingAudioControls
          player={silentPlayer}
          anchorRef={playerRef}
          footerRef={footerRef}
          onSpeedMenuOpenChange={setFloatingSpeedOpen}
          speeds={WPM_OPTIONS}
          formatSpeed={formatWpm}
          speedLabel="Reading speed"
          hideMute
        />
      )}
      {readable && !silentActive && (
        <FloatingAudioControls
          player={player}
          anchorRef={playerRef}
          footerRef={footerRef}
          onSpeedMenuOpenChange={setFloatingSpeedOpen}
        />
      )}
```

In `frontend/src/hooks/useAudioPlayer.ts` replace `play`:

```ts
  const play = useCallback(() => {
    if (audioRef.current && status === "ready") {
      audioRef.current.play();
      setStatus("playing");
    } else if (audioRef.current && status === "paused") {
      audioRef.current.play();
      setStatus("playing");
    }
  }, [status]);
```

with:

```ts
  const play = useCallback(() => {
    if (audioRef.current && (status === "ready" || status === "paused")) {
      // A browser may refuse audio that no click started directly (autoplay policy).
      Promise.resolve(audioRef.current.play()).catch(() => setStatus("paused"));
      setStatus("playing");
    }
  }, [status]);
```

Run the Step 1 command again:

```bash
docker compose exec -T frontend pnpm exec vitest run src/pages/posts/__tests__/PostDetailPage.reading.test.tsx src/hooks/__tests__/useAudioPlayer.autoplay.test.tsx
```

Expected: PASS, `Test Files  2 passed (2)` and `Tests  56 passed (56)`: 50 for the page (6 for the reading surface, 7 for reading with sound, 7 for switching, 5 for the silent controls, 3 for highlighting and auto-scroll, 2 for highlighting with sound, 8 for saving progress, 7 for leaving the article and 5 for the floating controls) and 6 for the player. No unhandled rejection is reported.

Why it is shaped this way:

- **One slot for the start request.** A start has to wait for something. Silent reading waits for the paced timeline, which exists only on the render after `silentActive` turns on and the words are wrapped (`pacedDurationMs` goes from 0 to above 0). Sound waits for the clip, which may still be loading. `pendingStart` holds one request, `{ mode, fraction }`, and a newer request replaces an older one, so the reader's last choice wins. Each of the two effects clears the slot before it acts, so a request runs once. `pacedDurationMs` is above zero only while silent reading is on, so a silent request cannot fire for a reader who has gone back to sound, and the silent effect needs no check of its own for that.
- **A failed load keeps the request.** If the clip cannot be made, the sound request stays in the slot, so `Retry` on the player plays the clip from the chosen place when it arrives. If the reader picks silent reading instead, that request replaces the sound one and the clip is never played behind their back.
- **Leaving ends the session.** The cleanup keyed on `postId` stops the pacer, turns silent mode off and empties the slot. `stop()` pauses before it rewinds, and the pause is what makes the tracker save the place, so what the reader had reached is saved before the article is dropped. The app has no link from one article straight to another, so this guards a case routing does not produce today; the tests simulate it with a `go-p2` button. `useAudioPlayer` keeps its status across a route change. That is existing behaviour and this task leaves it alone, so the page's cleanup deals with its own state only.
- **`trackedPost`.** The fetch effect does not clear `post` when the route's id changes, so the first render after navigating still holds the previous article under the new id. Progress is tracked only for a post whose id matches the route. Without that, the old article's stored place would seed the tracker of the new one.
- **The clock follows the mode.** `getClock` hands the highlight engine and the progress tracker the pacer's clock while silent reading is on and the audio element otherwise, and `clockKey` makes the tracker subscribe again when that changes. The tracker counts fractions of the article, not seconds, so a place earned on one clock still counts on the other. Silent reading measures the article by the paced timeline (`pacedDurationMs / 1000`), which is what the pacer plays; sound measures it by the clip's duration.
- **Three audio statuses.** `ready`, `playing` and `paused` are the statuses in which the audio element exists. The tracker stays subscribed while the clip is paused because a browser fires one last `timeupdate` after `pause()`, and that event carries the exact place where the reader stopped. The test double does not fire it, so no test pins this choice.
- **The reader's choice wins.** Marking the article read or unread also resets the tracker (to 1 or to 0) and sets `readProgress` to match, so a save that is still on its way cannot bring back what the reader just undid, and an article marked unread starts again from zero.
- **Switching carries the place across.** `switchToSilent` takes the clip's place as a fraction of its duration, unless the clip was never played (its time is 0). Then it uses the stored place, so a reader who loaded a clip and never pressed play continues where the last session ended. `switchToSound` takes the pacer's fraction, and `startSound` seeks whenever the clip's duration is known, even to 0: a reader who dragged the pacer back to the start hears the clip from the start. A clip that is already loaded is not fetched again.
- **A finished article starts over.** `storedFraction` is 0 when `isRead` is true. `Read again` reads from the top and saves nothing, because the tracker is off for an article that is read, so it stays Read.
- **A start button only before any audio exists.** The button shows while `audioStatus` is `idle`. A post whose clip already exists is preloaded by the page, so it goes straight to the player: its Play button plays the clip from the top, and `Read silently` continues in place. The start button's resume-where-you-left-off is for an article that has no clip yet. Stopping silent reading on such a post returns to the player, not to the start button.
- **The highlight stays on while reading silently.** `highlightEnabled` is `highlight || silentActive`, because silent reading has no sound and the highlight is its only sign of position. The switch is locked (Task 16) rather than overwritten, so the reader's saved choice comes back when they leave silent reading.
- **Auto-scroll steps aside for a menu.** The pace menu, the clip's speed menu and the floating bar's options each report when they are open, and auto-scroll is off while any of them is, so the page does not scroll under a menu the reader is choosing from.
- **One bar for both modes.** `silentPlayer` is the pacer shaped like the player the floating bar already understands, with the pace in place of the speed (`speeds`, `formatSpeed` and `speedLabel`), so there is one bar and not two. `isMuted` and `toggleMute` are placeholders the bar never shows (`hideMute`). The two branches keep the `readable` guard the single bar had.
- **`play()` and the autoplay policy.** `play()` marks the player `playing` at once, so the controls answer the click, and goes back to `paused` if the browser refuses; the reader can then press Play, which is a click the browser accepts. `Promise.resolve` lets it take the `undefined` that some test doubles return. The old code ignored the promise, so a refusal became an unhandled rejection and the player claimed to play in silence. The page needs this now because it starts the clip after an asynchronous load, outside the click that asked for it.

- [ ] **Step 3: Verify the task**

```bash
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check src/pages/posts/PostDetailPage.tsx src/hooks/useAudioPlayer.ts src/pages/posts/__tests__/PostDetailPage.reading.test.tsx src/hooks/__tests__/useAudioPlayer.autoplay.test.tsx
docker compose exec -T frontend pnpm test
```

Expected: `tsc -b` prints nothing; `pnpm lint` reports no new warnings (it already prints 4 older ones: `AuthContext.tsx`, `usePostsData.ts` exhaustive-deps, and `theme.tsx` twice); prettier accepts the four files (`PostDetailPage.tsx` and `useAudioPlayer.ts` pass it before this task, so a complaint there means an edit drifted from the text above: fix the edit by hand, and never reformat the whole file; if it flags one of the two new test files, run `pnpm exec prettier --write` on that file only; on a checkout with CRLF line endings, add `--end-of-line auto` to the check); the whole Vitest suite passes, including `PostDetailPage.loading.test.tsx`, which renders the real page, and `useAudioPlayer.privacy.test.tsx` and `AudioVolume.test.tsx`, which use the real player.

- [ ] **Step 4: Commit (only if the user asked for commits)**

```bash
git add frontend/src/pages/posts/PostDetailPage.tsx frontend/src/hooks/useAudioPlayer.ts frontend/src/pages/posts/__tests__/PostDetailPage.reading.test.tsx frontend/src/hooks/__tests__/useAudioPlayer.autoplay.test.tsx
git commit -m "feat(frontend): start reading from the article page, with silent pacing and saved progress" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 18: Playwright — the Start reading flow and reading progress

Tasks 8-17 changed what a reader sees and does, and so far only Vitest has looked at it. Three of the Playwright specs still describe the old flow: they look for the `Listen to article` button (`listen-button`), which Task 16 removed, so they fail now. This task brings them up to date and adds a `startListening` helper to the shared fixtures. It also adds `reading-progress.spec.ts`, which runs the whole feature in a real browser against a small stateful stand-in for the posts API: opening an article is not reading it, a silent read takes an article from Unread through In progress to Read, the In progress filter lists the right articles, and the new controls fit a phone. Every API call in these specs is mocked with `page.route()`, so no backend is needed.

Do this task after Task 17. The specs drive the real article page, and it is only complete then.

**Files:**
- Modify: `frontend/playwright/fixtures.ts`
- Modify: `frontend/playwright/audio.spec.ts`
- Modify: `frontend/playwright/post-detail.spec.ts`
- Modify: `frontend/playwright/read-along.spec.ts`
- Create: `frontend/playwright/reading-progress.spec.ts`

**Interfaces:**
- Consumes, all built earlier in Part B:
  - The test ids `start-reading-button`, `start-reading-menu`, `read-with-sound`, `audio-read-silently`, `pacer-controls`, `pacer-play-button`, `pacer-percent`, `pacer-speed-button`, `pacer-stop-button` and `read-state-chip` (Tasks 16 and 17).
  - On the list (Task 8): the `Opened` caption on a card, the `N%` caption with its `Reading progress` bar, the `In progress` button in the sidebar's `read state filter` group, the `?read=in_progress` URL, and the `Nothing in progress yet` message in `posts-empty`.
  - `PUT /api/posts/{id}/progress` (Task 6) and the `readAlong.wpm` preference (Task 12).
- Produces: `startListening(page)`, exported from `fixtures.ts`. `makePost` also returns `readProgress: 0` and `isSeen: false`, the two fields the API now returns with every post. No app code changes.

`fixtures.ts`, `audio.spec.ts`, `post-detail.spec.ts` and the new spec are 2-space, and the first three pass prettier today. `read-along.spec.ts` mixes indentation and `posts.spec.ts` is 4-space; neither passes prettier today, so the edits to `read-along.spec.ts` are surgical and nothing is reformatted. `posts.spec.ts` needs no edit at all: its read-state assertions still hold with the four-option filter.

- [ ] **Step 1: Red — the old specs against the new page**

Nothing in the specs has changed yet. Run the three that mention the removed button, plus `posts.spec.ts`, which should be unaffected:

```bash
docker compose exec -T frontend sh -lc 'npx playwright test playwright/audio.spec.ts playwright/post-detail.spec.ts playwright/posts.spec.ts --reporter=line'
```

Expected: FAIL with `5 failed` and `21 passed`. All five failures are in `audio.spec.ts` and are waits for `getByTestId('listen-button')`: four `locator.click` calls that run into the 30 s test timeout, and the first test's `Expected: visible`. The one `audio.spec.ts` test that passes (`auto-loads the player when the post already has audio`) only asserts that the old button is absent. `post-detail.spec.ts` passes for the same reason, which Step 2 fixes.

Then the slow one:

```bash
docker compose exec -T frontend sh -lc 'npx playwright test playwright/read-along.spec.ts --reporter=line'
```

Expected: FAIL with `19 failed` and `2 passed`. Every failure is a `locator.click` on `listen-button` that times out. The two that pass (`persist across a reload` and `toggles are keyboard-operable with state exposed`) never start playback. This file sets `retries: 2`, so each failing test waits out its 30 s timeout three times; allow several minutes.

- [ ] **Step 2: Green — the helper, the old specs brought up to date, and the new spec**

Four existing files change a little, then the new spec is created. Nothing under `src/` changes in this task.

In `frontend/playwright/fixtures.ts` (2-space) make two edits, in order.

1. Give the post fixture the two fields the API now returns with every post. Replace:

```ts
    isRead: false,
    hasAudio: false,
    hasContent: true,
    ...overrides,
```

with:

```ts
    isRead: false,
    readProgress: 0,
    isSeen: false,
    hasAudio: false,
    hasContent: true,
    ...overrides,
```

2. Add the helper in a section of its own, just before the custom fixtures. Replace:

```ts
// ── Custom fixtures ────────────────────────────────────────────────────
```

with:

```ts
// ── Reading helpers ────────────────────────────────────────────────────

/**
 * Start reading with sound from the post detail page: open the split button's
 * menu and pick "Read with sound". The clip autoplays once it is ready.
 */
export async function startListening(page: Page) {
  await page.getByTestId("start-reading-menu").click();
  await page.getByTestId("read-with-sound").click();
}

// ── Custom fixtures ────────────────────────────────────────────────────
```

In `frontend/playwright/audio.spec.ts` (2-space) make ten edits, in order. Each "old" text is unique in the file as it stands before the edit.

1. Describe the new flow in the header. Replace:

```ts
 * The player starts idle and generates on demand when the user clicks
 * "Listen". A post that already has audio (hasAudio) auto-loads its
 * controls on open, without a click.
```

with:

```ts
 * The page starts with a "Start reading" button and generates audio on demand
 * when the reader picks "Read with sound". A post that already has audio
 * (hasAudio) auto-loads its controls on open, without a click.
```

2. Import the helper. Replace:

```ts
import { test, expect, mockApi, makePostDetail } from "./fixtures";
```

with:

```ts
import { test, expect, mockApi, makePostDetail, startListening } from "./fixtures";
```

3. The first test now looks for the start reading button. Replace:

```ts
  test("displays listen button on post detail page", async ({ authedPage: page }) => {
    await setupAudioPage(page);
    // AudioPlayer starts in idle state → shows listen button immediately (no API call)

    await page.goto(`/posts/${postWithAudio.id}`);
    await expect(page.getByTestId("listen-button")).toBeVisible();
```

with:

```ts
  test("displays the start reading button on post detail page", async ({ authedPage: page }) => {
    await setupAudioPage(page);
    // The page starts idle → shows the start reading button immediately (no API call)

    await page.goto(`/posts/${postWithAudio.id}`);
    await expect(page.getByTestId("start-reading-button")).toBeVisible();
```

4. A comment that still names the old button. Replace:

```ts
    // After clicking Listen, the hook calls GET /posts/{id}/audio.
```

with:

```ts
    // After choosing Read with sound, the hook calls GET /posts/{id}/audio.
```

5. The "generating" test asks for sound through the helper. Replace:

```ts
    await page.getByTestId("listen-button").click();

    await expect(page.getByText(/generating/i)).toBeVisible({ timeout: 5000 });
```

with:

```ts
    await startListening(page);

    await expect(page.getByText(/generating/i)).toBeVisible({ timeout: 5000 });
```

6. The "player is ready" test does the same. Replace:

```ts
    await page.getByTestId("listen-button").click();

    await expect(page.getByTestId("play-pause-button")).toBeVisible({ timeout: 5000 });
```

with:

```ts
    await startListening(page);

    await expect(page.getByTestId("play-pause-button")).toBeVisible({ timeout: 5000 });
```

7. And the duration test. Replace:

```ts
    await page.getByTestId("listen-button").click();

    // Should show duration formatted as 2:05
```

with:

```ts
    await startListening(page);

    // Should show duration formatted as 2:05
```

8. The error test uses the helper too, and also checks that the error state offers reading silently next to `Retry`. Replace:

```ts
    await page.getByTestId("listen-button").click();

    // Should show error state with retry button
    await expect(page.getByText(/failed|error/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
```

with:

```ts
    await startListening(page);

    // Should show error state with retry button
    await expect(page.getByText(/failed|error/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
    await expect(page.getByTestId("audio-read-silently")).toBeVisible();
```

9. Add a test that a failed clip does not strand the reader, and update the comment of the test that follows it. Replace:

```ts
  test("auto-loads the player when the post already has audio", async ({ authedPage: page }) => {
    // A post flagged hasAudio should surface the controls immediately, without
    // the user clicking "Listen to article".
```

with:

```ts
  test("offers reading silently when audio generation fails", async ({ authedPage: page }) => {
    await setupAudioPage(page);

    await page.route(`**/api/posts/${postWithAudio.id}/audio`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "TTS_ERROR", message: "TTS service unavailable" },
        }),
      })
    );

    await page.goto(`/posts/${postWithAudio.id}`);
    await startListening(page);

    // A failed clip must not strand the reader: reading silently still works.
    await page.getByTestId("audio-read-silently").click();

    await expect(page.getByTestId("pacer-controls")).toBeVisible();
    await expect(page.getByTestId("audio-read-silently")).toHaveCount(0);
  });

  test("auto-loads the player when the post already has audio", async ({ authedPage: page }) => {
    // A post flagged hasAudio should surface the controls immediately, without
    // the reader choosing "Read with sound".
```

10. The last test asserts that the start reading button never shows. Replace:

```ts
    // Controls appear automatically; the "Listen to article" button never shows.
    await expect(page.getByTestId("play-pause-button")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("listen-button")).toHaveCount(0);
```

with:

```ts
    // Controls appear automatically; the start reading button never shows.
    await expect(page.getByTestId("play-pause-button")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("start-reading-button")).toHaveCount(0);
```

In `frontend/playwright/post-detail.spec.ts` (2-space) make one edit. The existing assertion has been passing only because the id it looks for no longer exists; this makes it check what it says.

1. Replace:

```ts
    // No audio affordances for a post with no readable content.
    await expect(page.getByTestId("listen-button")).toHaveCount(0);
```

with:

```ts
    // No reading or audio affordances for a post with no readable content.
    await expect(page.getByTestId("start-reading-button")).toHaveCount(0);
```

In `frontend/playwright/read-along.spec.ts` (mixed indentation, so surgical edits only) make four edits, in order. This file does not use `startListening`; the first "Why" bullet after the new spec explains why.

1. Explain the seeds in the header. Replace:

```
 * and the highlighter advances from media time.
 */
```

with:

```
 * and the highlighter advances from media time.
 *
 * The seeded posts are flagged hasAudio, so the clip preloads (paused) when a
 * post opens and the player appears without choosing "Read with sound", which
 * would autoplay.
 */
```

2. Flag the three seed posts (`post`, `longPost` and `floatingPost`) as already narrated. Replace every `  hasAudio: false,` with `  hasAudio: true,`. There are exactly three, each directly after `isRead: true,`.

3. Add a helper that waits for the preloaded player. Replace:

```ts
async function startPlayback(page: Page) {
```

with:

```ts
/** Waits for the preloaded clip's player (the seeds are flagged hasAudio). */
async function waitForPlayer(page: Page) {
  await expect(page.getByTestId("play-pause-button")).toBeVisible();
}

async function startPlayback(page: Page) {
```

4. Replace every `await page.getByTestId("listen-button").click();` with `await waitForPlayer(page);`, keeping each line's indentation. There are ten: in `startPlayback`, the muted-media test, the 320/1280 px test, `startLongPlayback`, the mobile inline speed menu test, the muted playback test, the highlight-off test, the auto-scroll-off test, the fallback test and the floating-controls test. Afterwards the file has no `listen-button` left and ten `waitForPlayer(page)` calls.

The new spec keeps the posts API's state in a `Map`, so what the page saves is what it reads back, the way the real server behaves. It has one helper, `setupProgressApi`, which returns the list of progress reports the page sent. Seven tests use it:

- open is not read, and the `Opened` caption;
- a silent read at the fastest pace, from Unread to In progress to Read, through the card, the chip and the Continue button;
- the In progress filter, and how it relates to the Unread filter;
- its empty state, on a `?read=in_progress` deep link;
- that the filter is still applied after opening an article and going back;
- the four filter buttons on one row of the narrow sidebar;
- the pacer controls on a 320 px viewport.

Create `frontend/playwright/reading-progress.spec.ts`:

```ts
/**
 * E2E tests for reading progress: opening an article is not reading it.
 *
 * The posts API is stateful here and mirrors the server: opening a post marks
 * it seen, a progress report only ever raises `readProgress`, and 95% completes
 * the post. The silent pacer runs at its fastest pace (400 wpm) so a whole read
 * takes a few seconds.
 */

import type { Page, Route } from "@playwright/test";
import { test, expect, setupReaderApi, makePost, makeFeed } from "./fixtures";

// ── Seed data ──────────────────────────────────────────────────────────

const feed = makeFeed([], { id: "feed-progress", title: "Progress Feed" });

const READ_COMPLETION_THRESHOLD = 0.95;

const CONTENT =
  "<p>Opening an article is not the same as reading it. This one is long enough for the " +
  "silent pacer to need several seconds, so a reader can stop part of the way through, " +
  "leave, come back and then finish it.</p>";

interface PostState {
  id: string;
  title: string;
  isRead: boolean;
  readProgress: number;
  isSeen: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** A stateful stand-in for the posts API. `reports` records every progress PUT. */
async function setupProgressApi(
  page: Page,
  seeds: Array<Pick<PostState, "id" | "title"> & Partial<PostState>>
) {
  const states = new Map<string, PostState>(
    seeds.map((seed) => [seed.id, { isRead: false, readProgress: 0, isSeen: false, ...seed }])
  );
  const reports: Array<{ id: string; progress: number }> = [];

  const summary = (state: PostState) => makePost(feed.id, { ...state, feedTitle: feed.title });
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  await setupReaderApi(page, { feeds: [feed] });
  // Registered after setupReaderApi, so it sees post requests first and hands
  // anything it does not own (the unread counts) back to the static mocks.
  await page.route("**/api/posts**", (route) => {
    const request = route.request();
    const method = request.method();
    const { pathname, searchParams } = new URL(request.url());
    const path = pathname.replace(/^.*\/api\/posts/, "");

    if (method === "GET" && path === "") {
      const filter = searchParams.get("readState");
      const listed = [...states.values()].filter((state) => {
        if (filter === "unread") return !state.isRead;
        if (filter === "in_progress") return !state.isRead && state.readProgress > 0;
        if (filter === "read") return state.isRead;
        return true;
      });
      return json(route, { posts: listed.map(summary), hasMore: false, nextCursor: null });
    }

    const state = states.get(path.split("/")[1]);
    if (!state) return route.fallback();

    if (method === "GET" && path === `/${state.id}`) {
      state.isSeen = true;
      return json(route, { ...summary(state), content: CONTENT });
    }

    if (method === "PUT" && path === `/${state.id}/progress`) {
      const { progress } = request.postDataJSON() as { progress: number };
      reports.push({ id: state.id, progress });
      if (!state.isRead) {
        state.readProgress = Math.max(state.readProgress, progress);
        if (state.readProgress >= READ_COMPLETION_THRESHOLD) {
          state.isRead = true;
          state.readProgress = 1;
        }
      }
      return json(route, {
        postId: state.id,
        isRead: state.isRead,
        readProgress: state.readProgress,
        readAt: state.isRead ? new Date().toISOString() : null,
      });
    }

    return route.fallback();
  });

  return { reports };
}

async function readAtFastestPace(page: Page) {
  await page.addInitScript(() => localStorage.setItem("readAlong.wpm", "400"));
}

/** The reading position the pacer shows, as a whole percent. */
async function pacerPercent(page: Page) {
  const text = await page.getByTestId("pacer-percent").textContent();
  return Number.parseInt(text ?? "0", 10);
}

/** The whole percent in the detail page's "In progress · N%" chip. */
async function chipPercent(page: Page) {
  const text = await page.getByTestId("read-state-chip").textContent();
  return Number(/(\d+)%/.exec(text ?? "")?.[1] ?? 0);
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe("Reading progress", () => {
  test("opening an article marks it opened, not read", async ({ authedPage: page }) => {
    const { reports } = await setupProgressApi(page, [{ id: "fresh", title: "Fresh Article" }]);
    await page.goto("/posts");

    const card = page.getByTestId("post-card-fresh");
    await expect(card.getByText("Opened", { exact: true })).toHaveCount(0);

    await card.click();
    await expect(page.getByTestId("read-state-chip")).toHaveText("Unread");
    await page.getByTestId("back-button").first().click();

    await expect(card.getByText("Opened", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Mark as read", exact: true })).toBeVisible();
    expect(reports).toEqual([]);
  });

  test("a silent read moves an article from unread to in progress to read", async ({
    authedPage: page,
  }) => {
    await readAtFastestPace(page);
    await setupProgressApi(page, [{ id: "silent", title: "Silent Article" }]);
    await page.goto("/posts");

    const card = page.getByTestId("post-card-silent");
    await card.click();

    // Read part of the way, then stop.
    await page.getByTestId("start-reading-button").click();
    await expect.poll(() => pacerPercent(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(30);
    await page.getByTestId("pacer-stop-button").click();

    // The chip shows what the server was told: started, but not finished.
    await expect(page.getByTestId("read-state-chip")).toHaveText(/^In progress · \d+%$/);
    await expect.poll(() => chipPercent(page)).toBeGreaterThanOrEqual(30);
    const reached = await chipPercent(page);
    expect(reached).toBeLessThan(95);

    // The list shows the same progress.
    await page.getByTestId("back-button").first().click();
    await expect(card.getByText(`${reached}%`, { exact: true })).toBeVisible();
    await expect(card.getByRole("progressbar", { name: "Reading progress" })).toBeVisible();

    // Reopening offers to continue, and does so from the saved position.
    await card.click();
    const start = page.getByTestId("start-reading-button");
    await expect(start).toHaveText(`Continue reading · ${reached}%`);
    await start.click();
    await expect.poll(() => pacerPercent(page)).toBeGreaterThanOrEqual(reached);

    // Finishing the article completes it.
    await expect(page.getByTestId("read-state-chip")).toHaveText("Read", { timeout: 20_000 });
    await page.getByTestId("back-button").first().click();
    await expect(card.getByRole("button", { name: "Mark as unread", exact: true })).toBeVisible();
    await expect(card.getByRole("progressbar")).toHaveCount(0);
  });

  test("the In progress filter lists only articles that were started", async ({
    authedPage: page,
  }) => {
    await setupProgressApi(page, [
      { id: "fresh", title: "Fresh Article" },
      { id: "half", title: "Half Read Article", readProgress: 0.4 },
      { id: "done", title: "Finished Article", isRead: true, readProgress: 1 },
    ]);
    await page.goto("/posts");

    const sidebar = page.getByTestId("feed-sidebar");
    await sidebar.getByRole("button", { name: "In progress", exact: true }).click();

    await expect(page).toHaveURL(/read=in_progress/);
    await expect(page.getByTestId("post-card-half")).toBeVisible();
    await expect(page.getByTestId("post-card-fresh")).toHaveCount(0);
    await expect(page.getByTestId("post-card-done")).toHaveCount(0);
    await expect(
      page.getByTestId("post-card-half").getByText("40%", { exact: true })
    ).toBeVisible();

    // An article being read is still unread, so the Unread filter keeps it.
    await sidebar.getByRole("button", { name: "Unread", exact: true }).click();
    await expect(page).toHaveURL(/read=unread/);
    await expect(page.getByTestId("post-card-half")).toBeVisible();
    await expect(page.getByTestId("post-card-fresh")).toBeVisible();
    await expect(page.getByTestId("post-card-done")).toHaveCount(0);
  });

  test("the In progress filter explains when nothing was started", async ({ authedPage: page }) => {
    await setupProgressApi(page, [{ id: "fresh", title: "Fresh Article" }]);
    await page.goto("/posts?read=in_progress");

    await expect(page.getByTestId("posts-empty")).toContainText("Nothing in progress yet");
  });

  test("the In progress filter is still applied after opening an article and coming back", async ({
    authedPage: page,
  }) => {
    await setupProgressApi(page, [
      { id: "fresh", title: "Fresh Article" },
      { id: "half", title: "Half Read Article", readProgress: 0.4 },
    ]);
    await page.goto("/posts");

    const sidebar = page.getByTestId("feed-sidebar");
    await sidebar.getByRole("button", { name: "In progress", exact: true }).click();
    await expect(page.getByTestId("post-card-half")).toBeVisible();

    await page.getByTestId("post-card-half").click();
    await expect(page.getByTestId("read-state-chip")).toHaveText(/^In progress/);
    await page.getByTestId("back-button").first().click();

    await expect(page).toHaveURL(/read=in_progress/);
    await expect(page.getByTestId("post-card-half")).toBeVisible();
    await expect(page.getByTestId("post-card-fresh")).toHaveCount(0);
  });

  test("the four read-state filters share one row of the sidebar", async ({ authedPage: page }) => {
    await setupProgressApi(page, []);
    await page.goto("/posts");

    const sidebar = page.getByTestId("feed-sidebar");
    const filters = sidebar.getByRole("group", { name: "read state filter" });
    const boxes = await Promise.all(
      ["All", "Unread", "In progress", "Read"].map((name) =>
        filters.getByRole("button", { name, exact: true }).boundingBox()
      )
    );
    const sidebarBox = await sidebar.boundingBox();

    expect(new Set(boxes.map((box) => Math.round(box!.y))).size).toBe(1);
    expect(new Set(boxes.map((box) => Math.round(box!.height))).size).toBe(1);
    for (const box of boxes) {
      expect(box!.x + box!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width);
    }
  });

  test("the pacer controls fit a phone-sized viewport", async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await setupProgressApi(page, [{ id: "narrow", title: "Narrow Article" }]);
    await page.goto("/posts/narrow");

    await page.getByTestId("start-reading-button").click();
    await expect(page.getByTestId("pacer-controls")).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320
    );
    for (const testId of [
      "pacer-controls",
      "pacer-play-button",
      "pacer-speed-button",
      "pacer-stop-button",
    ]) {
      const box = await page.getByTestId(testId).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
  });
});
```

Run the five specs together:

```bash
docker compose exec -T frontend sh -lc 'npx playwright test playwright/audio.spec.ts playwright/post-detail.spec.ts playwright/posts.spec.ts playwright/reading-progress.spec.ts playwright/read-along.spec.ts --reporter=line'
```

Expected: PASS, `55 passed` in about a minute: 7 in `audio.spec.ts`, 9 in `post-detail.spec.ts`, 11 in `posts.spec.ts`, 7 in `reading-progress.spec.ts` and 21 in `read-along.spec.ts`.

The new spec passes on its first run. That is expected: it characterises behaviour that Tasks 8-17 built test-first at unit level, and its job is to show the pieces work together in a browser. Step 3 shows that it can fail.

Why it is shaped this way:

- **`read-along.spec.ts` flags its posts `hasAudio` and does not use `startListening`.** This departs from the design, which asked for the helper everywhere. "Read with sound" now generates the clip and also starts playing it, so the old sequence (open the post, ask for the clip, press Play) would start playback and then pause it. A post flagged `hasAudio` is preloaded by the page, paused, so its player appears with no choice to make and the existing Play clicks work as before. `waitForPlayer` only waits for that player. `audio.spec.ts` does use `startListening`, because its tests are about the request that "Read with sound" makes on demand, and the helper takes the two clicks a reader makes, so those tests exercise the menu too.
- **A failed clip must not strand the reader.** `audio.spec.ts` checks both ends of it: the error state offers `Read silently` next to `Retry`, and choosing it brings up the pacer controls and takes the offer away.
- **The posts API stand-in follows the server's rules.** Opening a post marks it seen, a progress report only ever raises the stored progress, 95% completes the post, and the list honours `readState`. So the page's own requests decide what a filtered list shows, and a scenario can follow one article through a whole read. It is registered after `setupReaderApi`, so it sees the post requests first, and what it does not own (the unread counts) goes back to the static mocks with `route.fallback()`.
- **No exact percentages.** How far the pacer gets depends on timing, so the scenarios assert relations: at least 30% before stopping, below 95% after stopping, and `Continue reading` resumes at or above the saved place. They use `expect.poll`, so a slow machine only waits longer. The figure the chip shows (`reached`) is what the card and the Continue button must repeat. The pace is set to 400 words a minute, the fastest option, before the page loads, so a whole read takes seconds.
- **Order matters in the back-navigation test.** `half` has to be visible before `fresh` is asserted absent. Otherwise "absent" holds trivially while the list is still loading. The article page has several `back-button` elements, so the tests click the first.
- **Why the deep link and the way back are scenarios.** They are what found the first-load race that Task 8 fixes: a list filtered to In progress that is replaced by the unfiltered one. Step 3 shows what they catch.
- **Layout is checked in a browser, because jsdom has none.** The sidebar scenario asserts that the four filter buttons share a row (same top, same height) and stay inside the sidebar's right edge. The phone scenario asserts that a 320 px page does not scroll sideways and that the pacer's container and its three buttons lie inside the viewport. These are the design's narrow-width requirements.

- [ ] **Step 3: Prove that the filter scenarios guard the Task 8 wiring**

The new spec passed on its first run, so take away the edit that the two filter scenarios exist for. In `frontend/src/pages/posts/ReaderPage.tsx` remove the argument Task 8 added to the `usePostsData` call. Replace:

```tsx
  } = usePostsData(categoryId ?? undefined, feedId ?? undefined, readState);
```

with:

```tsx
  } = usePostsData(categoryId ?? undefined, feedId ?? undefined);
```

Run the new spec:

```bash
docker compose exec -T frontend sh -lc 'npx playwright test playwright/reading-progress.spec.ts --reporter=line'
```

Expected: FAIL with `2 failed` and `5 passed`. `the In progress filter explains when nothing was started` fails because `posts-empty` never appears: the list loads unfiltered and the filtered request that follows is dropped. `the In progress filter is still applied after opening an article and coming back` fails because `post-card-fresh` is on the page (`Expected: 0`, `Received: 1`).

Put `, readState` back, so the file matches Task 8 again, and run the same command. Expected: `7 passed`.

- [ ] **Step 4: Verify the task**

```bash
docker compose exec -T frontend sh -lc 'npx playwright test playwright/audio.spec.ts playwright/post-detail.spec.ts playwright/posts.spec.ts playwright/reading-progress.spec.ts playwright/read-along.spec.ts --reporter=line'
docker compose exec -T frontend sh -lc 'npx playwright test playwright/reading-progress.spec.ts --repeat-each=5 --reporter=line'
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check playwright/fixtures.ts playwright/audio.spec.ts playwright/post-detail.spec.ts playwright/reading-progress.spec.ts
```

Expected: the five specs give `55 passed`; the new spec run five times gives `35 passed`, which shows that its timing is stable; `pnpm lint` reports no new warnings (it already prints 4 older ones, all under `src/`, and it lints `playwright/` too); prettier accepts the four files (the first three pass it before this task, so a complaint there means an edit drifted from the text above: fix the edit by hand and never reformat the whole file; if it flags the new spec, run `pnpm exec prettier --write playwright/reading-progress.spec.ts`; on a checkout with CRLF line endings, add `--end-of-line auto` to the check). `read-along.spec.ts` and `posts.spec.ts` are left out of the prettier check because neither passes it today, and they must not be reformatted. `tsc -b` is not part of this task's checks: its `include` is `src`, so it never looks at `playwright/`, and Playwright transpiles the specs without type-checking them.

- [ ] **Step 5: Commit (only if the user asked for commits)**

```bash
git add frontend/playwright/fixtures.ts frontend/playwright/audio.spec.ts frontend/playwright/post-detail.spec.ts frontend/playwright/read-along.spec.ts frontend/playwright/reading-progress.spec.ts
git commit -m "test(e2e): cover reading progress and the Start reading flow" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

# Part C — Docs and final verification

The code is finished after Task 18. What is left is the written record (documents that still say "opening a post marks it read") and one last check of the whole change.

## Task 19: Docs — supersede "opening marks a post read" and document reading progress

After Task 6, opening a post no longer marks it read, but seven documents still say it does, and the OpenAPI contract knows nothing about the new endpoint or the new fields. This task amends them. It has no test-first step: its test is a search for the stale wording. Step 1 runs it before any edit (it must find the wording) and Step 9 runs it after the last one (it must find only what is meant to stay).

Amend only what the new behaviour makes wrong, and add what is new. Keep history intact: a superseded requirement is struck through, not deleted (FR-034 and FR-035 in the same file show the style), and a clarification keeps its original question and answer with a "superseded" note under it. Edit one file at a time, in the order below. Every "old" text is unique in its file as it stands before that edit; if one does not match, the file has drifted, so stop and look at it rather than adjusting the old text. Keep each file's existing line endings.

**Files:**
- Modify: `specs/001-rss-feed-reader/spec.md`
- Modify: `specs/001-rss-feed-reader/data-model.md`
- Modify: `specs/001-rss-feed-reader/tasks.md`
- Modify: `specs/001-rss-feed-reader/contracts/openapi.yaml`
- Modify: `specs/003-read-along-highlight/quickstart.md`
- Modify: `README.md`
- Modify: `my-feeds-threat-model.md`

**Interfaces:**
- Consumes: the behaviour built in Tasks 1-18, stated here exactly as the code does it.
  - `GET /api/posts/{id}` records that the post was opened and returns the real `isRead` and `readProgress` with `isSeen: true`; it does not mark the post read.
  - `PUT /api/posts/{id}/progress` takes `{"progress": 0..1}` and answers `{postId, isRead, readProgress, readAt}`. A bad number is a 400 with the nested `{"error": {"code": "VALIDATION_ERROR", "message": ...}}` body, checked before the post is looked up. A missing post and a post the user does not own are the same flat 404. A 429 carries `Retry-After` and the nested body with `code: RATE_LIMITED`.
  - The read-state `PUT` answers what it always did (`postId`, `isRead`, `readAt`); marking read sets the stored progress to 1 and marking unread sets it to 0.
  - The migration (`b8e4a1c7d903`) removes duplicate `(user_id, post_id)` rows, backfills read rows to progress 1 with `opened_at = read_at`, and adds the unique constraint.
- Produces: no code. The documents above describe the new behaviour; nothing in them says that opening a post marks it read except the two places kept on purpose as history.

- [ ] **Step 1: Red — find the wording that is now false**

```bash
git grep -n -i -E "auto-marks? read|automatically mark posts as read|auto-mark-read|Auto-track" -- README.md my-feeds-threat-model.md specs
git grep -n "Listen to article" -- specs README.md
```

Expected: the first command prints 8 lines: `README.md:10`, `my-feeds-threat-model.md:255`, `specs/001-rss-feed-reader/data-model.md:184`, `specs/001-rss-feed-reader/spec.md` at lines 150, 179 and 208, and `specs/001-rss-feed-reader/tasks.md` at lines 186 and 204. The second prints one line, `specs/003-read-along-highlight/quickstart.md:60`: the walkthrough tells the reader to wait for a button that Task 16 removed.

- [ ] **Step 2: Amend the 001 feature spec**

In `specs/001-rss-feed-reader/spec.md` make three edits, in order.

1. FR-029 is superseded, FR-031 gains the new filter values, and two requirements are added after them. Replace:

```md
- **FR-029**: System MUST automatically mark posts as read when opened
- **FR-030**: Users MUST be able to manually toggle read/unread state on any post
- **FR-031**: Users MUST be able to filter the posts view by read state (all, unread only)
```

with:

```md
- ~~**FR-029**: System MUST automatically mark posts as read when opened~~ - SUPERSEDED by FR-040 and FR-041 (opening a post no longer marks it read)
- **FR-030**: Users MUST be able to manually toggle read/unread state on any post
- **FR-031**: Users MUST be able to filter the posts view by read state (all, unread, in progress, read; unread includes posts that are in progress)
- **FR-040**: Opening a post MUST NOT mark it read; the system MUST remember that the user opened it, and an opened post that was not read MUST still count as unread
- **FR-041**: System MUST track reading progress from the read-along position while the user reads a post with Start reading (by audio or at a silent timed pace): progress MUST only move forward, a post reaching 95% MUST become read, marking a post read MUST set its progress to 100%, and marking it unread MUST reset it to 0%
```

2. The Post entity describes the new state. Replace:

```md
- **Post**: Individual article/entry from a feed; has title, content, author, publication date, link, and per-user read state (auto-tracked on open, manually toggleable)
```

with:

```md
- **Post**: Individual article/entry from a feed; has title, content, author, publication date, link, per-user reading state (unread, in progress with a percentage, or read; tracked from read-along playback and manually toggleable), and whether the user has opened it
```

3. The 2026-02-03 clarification stays as it was recorded, with a note under it. Replace:

```md
- Q: Should users be able to mark posts as read/unread, and should the system track read state automatically? → A: Auto-track read state when post is opened, with manual toggle available
```

with:

```md
- Q: Should users be able to mark posts as read/unread, and should the system track read state automatically? → A: Auto-track read state when post is opened, with manual toggle available
  - Superseded 2026-11-02: opening a post no longer marks it read; reading progress is tracked instead (FR-040, FR-041). See `docs/superpowers/specs/2026-11-02-reading-progress-design.md`
```

- [ ] **Step 3: Amend the data model**

In `specs/001-rss-feed-reader/data-model.md` make five edits, in order. Two of them also correct the older description of this table, because the new unique constraint and columns sit right on top of it: the section called `user_id` and `post_id` a composite primary key, but the table has its own `id` primary key and, until this change, no uniqueness at all. The box is drawn character by character; every row of it is 17 columns wide.

1. The entity-relationship box gains the three new rows and the `id` row. Replace:

```text
       │         ┌─────────────┐
       └─────────│  UserPost   │ (Read State)
           N:M   ├─────────────┤
                 │ user_id(FK) │
                 │ post_id(FK) │
                 │ is_read     │
                 │ read_at     │
                 └─────────────┘
```

with:

```text
       │         ┌───────────────┐
       └─────────│   UserPost    │ (Read State)
           N:M   ├───────────────┤
                 │ id (PK)       │
                 │ user_id(FK)   │
                 │ post_id(FK)   │
                 │ is_read       │
                 │ read_at       │
                 │ opened_at     │
                 │ read_progress │
                 └───────────────┘
```

2. The field table. The heading above it, `### UserPost (Read State Junction)`, stays as it is so that links to it keep working. Replace:

```md
**Description**: Tracks per-user read state for posts.

| Field     | Type      | Constraints                      | Description         |
| --------- | --------- | -------------------------------- | ------------------- |
| `user_id` | UUID      | PK, FK → User, ON DELETE CASCADE | User                |
| `post_id` | UUID      | PK, FK → Post, ON DELETE CASCADE | Post                |
| `is_read` | BOOLEAN   | NOT NULL, DEFAULT FALSE          | Read status         |
| `read_at` | TIMESTAMP | NULL                             | When marked as read |
```

with:

```md
**Description**: Tracks per-user read state and reading progress for posts.

| Field           | Type      | Constraints                       | Description                         |
| --------------- | --------- | --------------------------------- | ----------------------------------- |
| `id`            | UUID      | PK                                | Unique identifier                   |
| `user_id`       | UUID      | FK → User, ON DELETE CASCADE      | User                                |
| `post_id`       | UUID      | FK → Post, ON DELETE CASCADE      | Post                                |
| `is_read`       | BOOLEAN   | NOT NULL, DEFAULT FALSE           | Read status                         |
| `read_at`       | TIMESTAMP | NULL                              | When marked as read                 |
| `opened_at`     | TIMESTAMP | NULL                              | When the user first opened the post |
| `read_progress` | FLOAT     | NOT NULL, DEFAULT 0, CHECK 0 to 1 | Furthest point read, from 0 to 1    |
```

3. The rules, the indexes and the note. Replace:

```md
**Validation Rules**:
- Composite PK on (`user_id`, `post_id`)
- `read_at` should be set when `is_read` = TRUE

**Indexes**:
- `idx_userpost_user_unread` on (`user_id`, `is_read`) WHERE `is_read` = FALSE - Unread filter

**Note**: UserPost records are created on-demand when a user opens a post (auto-mark read) or toggles read state.
```

with:

```md
**Validation Rules**:
- UNIQUE on (`user_id`, `post_id`), so a progress write can insert or update the row in one statement
- `read_progress` stays within 0 to 1 (`ck_user_posts_read_progress_range`) and only moves forward
- A read post has `is_read` = TRUE, `read_progress` = 1 and `read_at` set
- Reaching 95% (`READ_COMPLETION_THRESHOLD`) makes a post read; marking it read sets progress to 1; marking it unread sets progress to 0 and clears `read_at`, but keeps `opened_at`
- Unread means not read and no progress; in progress means not read and progress above 0; opened (`opened_at` set) is independent of the state

**Indexes**:
- `idx_userpost_user_unread` on (`user_id`, `is_read`) WHERE `is_read` = FALSE - Unread filter
- `uq_user_posts_user_id_post_id` UNIQUE on (`user_id`, `post_id`) - One row per user and post

**Note**: UserPost rows are created on demand, when a user opens a post (only `opened_at` is set; the post is not marked read), reports reading progress or toggles read state. The reading-progress migration backfilled existing read rows with `read_progress` = 1 and `opened_at` = `read_at`.
```

4. The state diagram gets its third state. Replace:

```text
                     ┌─────────────────────┐
                     │                     │
                     ▼                     │
┌─────────┐    User opens    ┌─────────┐   │   Manual toggle
│ Unread  │ ───────────────► │  Read   │ ──┘
│         │                  │         │
│(default)│ ◄─────────────── │         │
└─────────┘   Manual toggle  └─────────┘
```

with:

```text
┌─────────┐ progress credited ┌─────────────┐ reaches 95% ┌─────────┐
│ Unread  │ ────────────────► │ In progress │ ──────────► │  Read   │
│(default)│                   │             │             │ (sticky)│
└─────────┘                   └─────────────┘             └─────────┘
     ▲                               │                         │
     └─────────── Mark unread ───────┴─────────────────────────┘
```

5. What the diagram leaves out, stated in words, just before the next section. Replace:

```md
### Feed Fetch State
```

with:

```md
Transitions the diagram does not draw:

- A single progress report of 95% or more takes an Unread post straight to Read.
- Mark read, from Unread or In progress: the post becomes Read and its progress becomes 100%.
- Mark unread, from In progress or Read: the post becomes Unread and its progress becomes 0%. Its `opened_at` is kept.
- Read is sticky: a progress report never demotes a read post.
- Opened is an independent flag, not a state. The first open sets it, and nothing above clears it.

### Feed Fetch State
```

- [ ] **Step 4: Amend the task list**

`tasks.md` records what was built for the first feature, so it keeps its history; the two places that promise "auto-mark-read" say what changed and when. T019, T099 and T126 stay as they are: they name files and components, and they stay true.

In `specs/001-rss-feed-reader/tasks.md` make two edits, in order.

1. The goal and the independent test of the read-a-post story. Replace:

```md
**Goal**: Users can read full post content with auto-mark-read and manual toggle

**Independent Test**: Click post, verify content displays, verify read state updates
```

with:

```md
**Goal**: Users can read full post content and toggle read state manually (since 2026-11-02, opening a post no longer marks it read; see `docs/superpowers/specs/2026-11-02-reading-progress-design.md`)

**Independent Test**: Click post, verify content displays and the post stays unread (it is only marked opened); verify read state updates when the post is read with Start reading or toggled manually
```

2. T103. Replace:

```md
- [X] T103 [US4] Implement post detail route (auto-marks read) in backend/app/api/routes/posts.py
```

with:

```md
- [X] T103 [US4] Implement post detail route in backend/app/api/routes/posts.py (originally it marked the post read; since 2026-11-02 it only records that the post was opened)
```

- [ ] **Step 5: Amend the OpenAPI contract**

In `specs/001-rss-feed-reader/contracts/openapi.yaml` make eight edits, in order. YAML is unforgiving about indentation, so copy the blocks exactly, and note that no plain scalar below contains a colon followed by a space.

1. The tag description. Replace:

```yaml
  - name: posts
    description: Post viewing and read state
```

with:

```yaml
  - name: posts
    description: Post viewing, read state and reading progress
```

2. The `readState` filter gains `in_progress` and says what each value covers. Replace:

```yaml
        - name: readState
          in: query
          description: Filter by read state
          schema:
            type: string
            enum: [all, unread, read]
            default: all
```

with:

```yaml
        - name: readState
          in: query
          description: >-
            Filter by read state. `unread` is every post that is not read,
            including opened and in-progress ones; `in_progress` is the subset
            of those with some reading progress.
          schema:
            type: string
            enum: [all, unread, in_progress, read]
            default: all
```

3. Reading a post no longer marks it read. Replace:

```yaml
      description: Returns full post content and marks as read
```

with:

```yaml
      description: Returns full post content and records that the user opened it. It does not mark the post as read
```

4. The manual toggle now sets the progress too. Replace:

```yaml
      description: Manually toggle read/unread state
```

with:

```yaml
      description: >-
        Manually toggle read/unread state. Marking a post read sets its reading
        progress to 100%; marking it unread resets progress to 0% (the post
        stays opened).
```

5. The new endpoint, in front of the audio section. Replace:

```yaml
  # ============================================================================
  # Audio (Text-to-Speech)
  # ============================================================================
  /posts/{postId}/audio:
```

with:

```yaml
  /posts/{postId}/progress:
    put:
      tags: [posts]
      summary: Report reading progress
      description: >-
        Reports how far the user has read a post, as a fraction from 0 to 1.
        The server keeps the furthest value it has seen, so a lower value never
        moves progress back. A value of 0.95 or more marks the post read, and a
        post that is already read is never demoted. The number is validated
        before the post is looked up, and a post that does not exist and a post
        the user does not own both answer 404. Shares the account's limit of 60
        write requests per minute with the other write endpoints.
      operationId: updateReadingProgress
      security:
        - sessionCookie: []
      parameters:
        - $ref: "#/components/parameters/postId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ReadingProgressUpdate"
      responses:
        "200":
          description: Progress recorded
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ReadingProgress"
        "400":
          description: The progress value is missing, is a boolean, or is not a finite number from 0 to 1
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
        "429":
          description: Request rate limit exceeded
          headers:
            Retry-After:
              description: Seconds to wait before retrying
              schema:
                type: integer
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  # ============================================================================
  # Audio (Text-to-Speech)
  # ============================================================================
  /posts/{postId}/audio:
```

6. The three new schemas, between `ReadStateUpdate` and `AudioInfo`. `ErrorEnvelope` is the nested body that the 400 and 429 answers of the new endpoint really use; the existing `Error` schema (flat) stays for the 401 and 404 answers. Replace:

```yaml
    ReadStateUpdate:
      type: object
      required:
        - isRead
      properties:
        isRead:
          type: boolean

    AudioInfo:
```

with:

```yaml
    ReadStateUpdate:
      type: object
      required:
        - isRead
      properties:
        isRead:
          type: boolean

    ReadingProgressUpdate:
      type: object
      required:
        - progress
      properties:
        progress:
          type: number
          minimum: 0
          maximum: 1
          description: How far the user has read, as a fraction from 0 to 1

    ReadingProgress:
      type: object
      required:
        - postId
        - isRead
        - readProgress
      properties:
        postId:
          type: string
          format: uuid
        isRead:
          type: boolean
        readProgress:
          type: number
          minimum: 0
          maximum: 1
          description: Furthest point read, from 0 to 1
        readAt:
          type: string
          format: date-time
          nullable: true

    ErrorEnvelope:
      type: object
      required:
        - error
      properties:
        error:
          type: object
          required:
            - code
            - message
          properties:
            code:
              type: string
              example: VALIDATION_ERROR
            message:
              type: string
            details:
              type: object
              additionalProperties: true
              description: Present on some errors, for example retryAfter on a 429

    AudioInfo:
```

7. Every post summary now carries the two new fields, so they are required. Replace:

```yaml
        - publishedAt
        - isRead
      properties:
```

with:

```yaml
        - publishedAt
        - isRead
        - readProgress
        - isSeen
      properties:
```

8. And they are described. Replace:

```yaml
        isRead:
          type: boolean
        hasAudio:
          type: boolean
```

with:

```yaml
        isRead:
          type: boolean
        readProgress:
          type: number
          minimum: 0
          maximum: 1
          description: Furthest point read, from 0 to 1
        isSeen:
          type: boolean
          description: True once the user has opened the post, whether or not it was read
        hasAudio:
          type: boolean
```

- [ ] **Step 6: Amend the read-along walkthrough**

`specs/003-read-along-highlight/quickstart.md` is not in the design's list of documents, but its first manual scenario tells the reader to wait for a button that no longer exists.

In `specs/003-read-along-highlight/quickstart.md` make one edit. Replace:

```md
1. Wait until "Listen to article" generates audio, then press play.
```

with:

```md
1. Open the arrow next to **Start reading** and choose **Read with sound**. It generates the audio and starts playing when it is ready. (An article whose audio is already loaded only needs **Play**.)
```

- [ ] **Step 7: Amend the README**

In `README.md` make four edits, in order. Wrap the new lines at about 80 columns, like their neighbours.

1. The feature list: the read-state bullet is reworded and a **Reading progress** bullet follows it. Replace:

```md
- **Read State Tracking**: Auto-track and manually toggle read/unread status
```

with:

```md
- **Read State Tracking**: Opening an article only marks it *opened*; it stays
  unread until you read it. Mark an article read or unread manually at any time.
- **Reading progress**: **Start reading** follows the article with the
  read-along highlight. The arrow beside it chooses *Read with sound*
  (generated audio, when the operator allows it) or *Read silently* (a
  highlight that moves at 150-400 words per minute with no audio; silent is the
  default); playing the article's audio counts as reading too. Progress only
  moves forward, and an article becomes read at 95%. Marking an article read or
  unread sets its progress to 100% or 0%. In-progress articles show a progress
  bar and percentage, unread articles you have opened show an *Opened* caption,
  and the sidebar filter offers All, Unread, In progress and Read.
```

2. The **Silent read-along** bullet is about muting audio that is playing, which is not the same thing as the new silent mode. Replace:

```md
  Auto-scroll waits while either playback-speed selector is open and resumes
  when it closes; playback and highlighting continue during speed selection.
```

with:

```md
  Auto-scroll waits while either playback-speed selector is open and resumes
  when it closes; playback and highlighting continue during speed selection.
  Muting keeps the generated audio playing, so the article still needs its
  audio; **Read silently** (see Reading progress) needs no audio at all.
```

3. The deployment notes name the newest migration. Replace:

```md
database connection variables, and the runtime password. Apply migrations
through `f7a1b2c3d4e5` and reapply runtime grants. Only `myfeeds_runtime`
```

with:

```md
database connection variables, and the runtime password. Apply migrations
through `b8e4a1c7d903` and reapply runtime grants. Only `myfeeds_runtime`
```

4. The migration caveat. Replace:

```md
The shared-audio-key migration preserves per-post ownership links; downgrading
its index requires first resolving any duplicate content keys.
```

with:

```md
The shared-audio-key migration preserves per-post ownership links; downgrading
its index requires first resolving any duplicate content keys.
The reading-progress migration removes duplicate `(user_id, post_id)` read-state
rows (keeping one per pair, preferring a read row) and marks existing read rows
as 100% read before it adds a unique constraint; downgrading cannot restore the
removed duplicates.
```

`my-feeds-threat-model.md` mentions `f7a1b2c3d4e5` too (the TM-004 row, line 44). That row is about the earlier migration and stays as it is.

- [ ] **Step 8: Amend the threat model**

In `my-feeds-threat-model.md` make one edit: the posts row of the entry-point table gains the progress route, and its notes say what the new endpoint does and does not trust. Replace:

```md
| Posts/counts/read-state | `/api/posts`, `/unread-counts`, `/<uuid>`, `/read-state`, `/<uuid>/read-state` | B1/B4/B7 | Query/cursor filters; ordinary ownership checks; detail GET auto-marks read. | `backend/app/api/routes/posts.py`; `backend/app/application/services/post_service.py` |
```

with:

```md
| Posts/counts/read-state/progress | `/api/posts`, `/unread-counts`, `/<uuid>`, `/read-state`, `/<uuid>/read-state`, `/<uuid>/progress` | B1/B4/B7 | Query/cursor filters; ordinary ownership checks; detail GET records "opened" and never marks read; progress PUT validates a finite number in [0,1] before any lookup, checks ownership before writing, answers the same 404 for missing and not-owned posts, and shares the 60 mutations/min account limit; progress is self-reported and only changes the caller's own lists. | `backend/app/api/routes/posts.py`; `backend/app/application/services/post_service.py` |
```

- [ ] **Step 9: Green — the checks**

```bash
git grep -n -i -E "auto-marks? read|automatically mark posts as read|auto-mark-read|Auto-track" -- README.md my-feeds-threat-model.md specs
git grep -n "Listen to article" -- specs README.md
git diff --stat -- specs README.md my-feeds-threat-model.md
cat specs/001-rss-feed-reader/contracts/openapi.yaml | docker compose exec -T backend python -c "import sys, yaml; d = yaml.safe_load(sys.stdin); s = d['components']['schemas']; put = d['paths']['/posts/{postId}/progress']['put']; params = d['paths']['/posts']['get']['parameters']; print(put['operationId'], sorted(put['responses'])); print([p['schema']['enum'] for p in params if p['name'] == 'readState']); print([k for k in ('ReadingProgressUpdate', 'ReadingProgress', 'ErrorEnvelope') if k not in s]); print(sorted(set(('readProgress', 'isSeen')) - set(s['PostSummary']['properties'])))"
```

Expected:

- The first command prints exactly two lines, both in `specs/001-rss-feed-reader/spec.md`: the struck-through FR-029 (line 150) and the 2026-02-03 clarification (line 210, now with its "Superseded" note under it). They stay on purpose, as history.
- The second prints nothing.
- The third lists the seven documents and nothing else.
- The fourth parses the contract and prints `updateReadingProgress ['200', '400', '401', '404', '429']`, then `[['all', 'unread', 'in_progress', 'read']]`, then two empty lists, `[]` and `[]` (nothing missing). If the backend image has no `yaml` module, run the same snippet with any Python that has PyYAML installed.

Then read the two diagrams in `data-model.md` in a monospaced font: every row of the entity box must have the same width, and the state diagram's vertical lines must sit under the boxes they leave.

- [ ] **Step 10: Commit (only if the user asked for commits)**

```bash
git add specs/001-rss-feed-reader/spec.md specs/001-rss-feed-reader/data-model.md specs/001-rss-feed-reader/tasks.md specs/001-rss-feed-reader/contracts/openapi.yaml specs/003-read-along-highlight/quickstart.md README.md my-feeds-threat-model.md
git commit -m "docs: opening an article no longer marks it read; document reading progress" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

## Task 20: Final verification of the whole change

This task changes no code. It runs every gate once over the finished change and keeps the output as the evidence for the final report. If a command fails for a reason that is not listed under "Known and pre-existing" at the end of this task, the change is not done: fix the cause in the task that owns it, then start again from Step 1. Never loosen a test, skip one, or edit an "Expected" line to make a run pass.

**Files:** none. Edit nothing in this task.

**Interfaces:**
- Consumes: everything from Tasks 1-19.
- Produces: no code. The command output and the Done-When table that the final report quotes.

- [ ] **Step 1: Backend — the whole suite, the migration test and the migration head**

```bash
docker compose run --rm migrate
docker compose exec -T backend pytest -q
docker compose run --rm --no-deps --entrypoint "" migrate python -m pytest -p no:cacheprovider tests/integration/test_reading_progress_migration.py -q
docker compose run --rm --no-deps --entrypoint "" migrate alembic heads
```

Expected: the suite ends with no failures and no errors. It had 547 passed at the commit this plan started from; this change adds its own tests, so the count is higher, and the only skips are the migration tests, which need the admin URL. The migration test prints `2 passed`. `alembic heads` prints the single line `b8e4a1c7d903 (head)`. The CRAP and mutation evidence from Task 7 still stands if no Python file changed after it; if one did, redo Task 7 Steps 2 to 6.

- [ ] **Step 2: Scope — nothing stray**

```bash
git status --short
git diff --stat
```

Expected: every path is named in the File Structure section above or lives under `docs/superpowers/`. Brand-new files show as `??` when nothing has been committed. Nothing from `frontend/dist`, `frontend/test-results`, `frontend/playwright-report`, `backend/mutants` or any `.env` file is listed (all of them are git-ignored; if one shows up, it was not ignored here, so remove it).

- [ ] **Step 3: Frontend — unit tests, types, lint, format and build**

```bash
docker compose exec -T frontend pnpm test
docker compose exec -T frontend pnpm exec tsc -b
docker compose exec -T frontend pnpm lint
docker compose exec -T frontend pnpm exec prettier --check \
  src/utils/readingProgress.ts src/utils/mediaClock.ts src/utils/pacedTimings.ts \
  src/utils/pacerClock.ts src/utils/readingProgressTracker.ts \
  src/hooks/usePacer.ts src/hooks/useReadingProgress.ts \
  src/components/StartReadingButton.tsx src/components/PacerControls.tsx \
  src/utils/__tests__/readingProgress.test.ts src/utils/__tests__/pacedTimings.test.ts \
  src/utils/__tests__/pacerClock.test.ts src/utils/__tests__/readingProgressTracker.test.ts \
  src/hooks/__tests__/usePacer.test.tsx src/hooks/__tests__/useReadingProgress.test.tsx \
  src/hooks/__tests__/useReadAlong.paced.test.tsx src/hooks/__tests__/useAudioPlayer.autoplay.test.tsx \
  src/services/__tests__/api.keepalive.test.ts \
  src/components/__tests__/StartReadingButton.test.tsx src/components/__tests__/PacerControls.test.tsx \
  src/components/__tests__/ReadAlongToggles.test.tsx src/components/__tests__/PostCard.test.tsx \
  src/components/__tests__/FeedSidebar.test.tsx \
  src/pages/posts/__tests__/PostDetailPage.reading.test.tsx \
  playwright/reading-progress.spec.ts
docker compose exec -T frontend pnpm build
```

The prettier command checks only the 25 files this plan created; existing files keep the formatting they have.

Expected:

- Vitest ends with `Test Files  47 passed (47)` and `Tests  567 passed (567)`. A different count means a test was added, dropped or skipped: find out which before going on.
- `tsc -b` prints nothing.
- Lint reports 0 errors and exactly the 4 warnings that were there before this change (`AuthContext.tsx`, `usePostsData.ts`, `theme.tsx` twice). A new warning is a defect.
- Prettier prints `All matched files use Prettier code style!`. On a checkout with CRLF line endings add `--end-of-line auto`.
- The build succeeds and writes `dist/sw.js`.

- [ ] **Step 4: Playwright**

Run these one after another, never at the same time: every run uses port 5173. The second run includes `service-worker.privacy.spec.ts`, which needs the `dist/` that Step 3 built.

```bash
docker compose exec -T frontend sh -lc 'npx playwright test playwright/audio.spec.ts playwright/post-detail.spec.ts playwright/posts.spec.ts playwright/reading-progress.spec.ts playwright/read-along.spec.ts --reporter=line --retries=0'
docker compose exec -T frontend sh -lc 'npx playwright test --reporter=line --retries=0'
docker compose exec -T frontend sh -lc 'VITE_ALLOW_EXTERNAL_IMAGES=true npx playwright test playwright/privacy.spec.ts --reporter=line --retries=0'
```

Expected:

1. `55 passed` (audio 7, post-detail 9, posts 11, reading-progress 7, read-along 21).
2. `87 passed` and `1 failed`: `privacy.spec.ts:4`, which fails the same way without this change (see "Known and pre-existing"). Any other failure is a defect.
3. `4 passed`. The flag is read when the Vite dev server starts: if a dev server is already running on port 5173, Playwright reuses it and the flag has no effect, so stop that server first.

- [ ] **Step 5: Docs — the Task 19 checks once more**

```bash
git grep -n -i -E "auto-marks? read|automatically mark posts as read|auto-mark-read|Auto-track" -- README.md my-feeds-threat-model.md specs
git grep -n "Listen to article" -- specs README.md
git diff --stat -- specs README.md my-feeds-threat-model.md
cat specs/001-rss-feed-reader/contracts/openapi.yaml | docker compose exec -T backend python -c "import sys, yaml; d = yaml.safe_load(sys.stdin); s = d['components']['schemas']; put = d['paths']['/posts/{postId}/progress']['put']; params = d['paths']['/posts']['get']['parameters']; print(put['operationId'], sorted(put['responses'])); print([p['schema']['enum'] for p in params if p['name'] == 'readState']); print([k for k in ('ReadingProgressUpdate', 'ReadingProgress', 'ErrorEnvelope') if k not in s]); print(sorted(set(('readProgress', 'isSeen')) - set(s['PostSummary']['properties'])))"
```

Expected:

- The first command prints exactly two lines, both in `specs/001-rss-feed-reader/spec.md`: the struck-through FR-029 and the 2026-02-03 clarification with its "Superseded" note. They stay on purpose, as history.
- The second prints nothing.
- The third lists the seven documents and nothing else. If the documents were committed, diff against the commit before Task 19 instead.
- The fourth prints `updateReadingProgress ['200', '400', '401', '404', '429']`, then `[['all', 'unread', 'in_progress', 'read']]`, then `[]` and `[]`. If the backend image has no `yaml` module, run the same snippet with any Python that has PyYAML installed.

- [ ] **Step 6: The Done-When table**

The "Done When" list in the spec is the finish line. Copy this table into the final report, with the result of each command named, not paraphrased. Every row's evidence has already run in Steps 1 to 5.

| Done when (spec) | Evidence |
|---|---|
| Opening an article leaves it Unread with an "Opened" marker and the unread badge unchanged. | `tests/contract/test_posts.py::test_get_post_records_open_without_marking_read`; `tests/integration/test_post_reading_progress.py::TestRecordOpened` and `TestListPostsForUser::test_progress_does_not_change_the_unread_counts`; Playwright "opening an article marks it opened, not read". |
| A silent read at a fast WPM goes Unread, In progress, Read at 95% and the detail chip flips live; sound reading does the same from the audio clock; seeking alone credits nothing. | Vitest `readingProgressTracker.test.ts`, `useReadingProgress.test.tsx`, `PostDetailPage.reading.test.tsx`; Playwright "a silent read moves an article from unread to in progress to read". |
| The In progress filter and `?read=in_progress` list the right articles across pages with a correct `hasMore`. | `TestListPostsForUser` (integration); Vitest `FeedSidebar.test.tsx`, `usePostsData.test.tsx`; the three "In progress filter" Playwright tests and "the four read-state filters share one row of the sidebar". |
| Manual and bulk mark read and unread follow the write table, and Read is never demoted by progress reports. | `TestRecordProgress`, `TestMarkAsRead`, `TestMarkAllRead` (integration); `TestPostServiceReadingProgress` (unit); `TestUpdateProgress` (contract). |
| The migration upgrades, downgrades and re-upgrades cleanly, and the unique constraint is in place. | `TestReadingProgressMigration` (`2 passed` in Step 1); `alembic heads` prints `b8e4a1c7d903 (head)`. |
| All suites pass; pytest-crap and mutmut have been run on the changed Python; FR-029 and related docs are superseded. | Steps 1, 3 and 4; the Task 7 CRAP and mutmut output; Step 5. |

- [ ] **Step 7: Optional manual smoke test**

Only with real OAuth credentials and a feed that has articles (see `specs/001-rss-feed-reader/quickstart.md`); skip it otherwise. Open an article: it stays Unread and the sidebar badge does not change. Choose "Start reading", then read silently at 400 wpm: the article's card in the list gains a progress bar, the "In progress" filter lists it, and at 95% the chip flips to Read. "Read with sound" answers 403 unless `EXTERNAL_TTS_ENABLED=true`.

- [ ] **Step 8: Report to the user**

In this order: what was built, in one paragraph; the numbers from Steps 1 to 5; every item under "Deviations from the spec" near the top of this plan, with the scope additions called out so the user can drop or split them (the `initialReadState` fix for the first-load filter race, and the documentation corrections beyond the spec); anything in "Known and pre-existing" that showed up; and what was not run (Step 7 if skipped).

**Known and pre-existing.** These fail or warn the same way without this change. None is caused by it, so none is fixed here.

- `privacy.spec.ts:4` ("publisher resources stay blocked until account consent") waits for the "Load publisher images" checkbox, which the app shows only when `VITE_ALLOW_EXTERNAL_IMAGES=true`. The dev server's default is off, and `image-warning.spec.ts` asserts that off behaviour. The file passes (`4 passed`) with the flag on, as in Step 4.
- `service-worker.privacy.spec.ts` tests the production service worker, so it fails without `dist/`. Step 3's build provides it.
- Two `read-along.spec.ts` tests are sensitive to machine load. If either fails in the full run, run that file alone (the first command in Step 4) before treating it as a regression.
- The dev-server log prints `<button> cannot contain a nested <button>` while the privacy spec runs. It is an existing warning in the UI and appears without this change too.
