import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export interface SqliteStatement {
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
  run: (...params: unknown[]) => unknown
}

export interface SqliteDatabase {
  exec: (sql: string) => unknown
  prepare: (sql: string) => SqliteStatement
  transaction?: <T extends (...args: never[]) => unknown>(fn: T) => T
  pragma?: (source: string) => unknown
}

export interface MigrationResult {
  fromVersion: number
  toVersion: number
  appliedVersions: number[]
  backupPath: string | null
}

interface MigrationContext {
  db: SqliteDatabase
}

interface Migration {
  version: number
  name: string
  up: (context: MigrationContext) => void
}

function tableExists(db: SqliteDatabase, table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function columnExists(db: SqliteDatabase, table: string, column: string) {
  if (!tableExists(db, table)) return false
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(row => row.name === column)
}

function addColumn(db: SqliteDatabase, table: string, definition: string) {
  const column = definition.trim().split(/\s+/, 1)[0]
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
  }
}

function migrationBackupPath(dbPath: string, now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const parsed = path.parse(dbPath)
  let candidate = path.join(parsed.dir, `${parsed.name}-pre-schema-${stamp}${parsed.ext || '.db'}`)
  let suffix = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}-pre-schema-${stamp}-${suffix}${parsed.ext || '.db'}`)
    suffix += 1
  }
  return candidate
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'legacy-compatible-base-schema',
    up: ({ db }) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          path TEXT DEFAULT '',
          status TEXT DEFAULT 'status-developing',
          progress REAL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL,
          createdAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_tags (
          projectId TEXT,
          tagId TEXT,
          PRIMARY KEY (projectId, tagId),
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(tagId) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS noteblocks (
          id TEXT PRIMARY KEY,
          projectId TEXT,
          content TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS todos (
          id TEXT PRIMARY KEY,
          projectId TEXT,
          content TEXT NOT NULL,
          completed INTEGER DEFAULT 0 CHECK(completed IN (0, 1)),
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS project_statuses (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          sortIndex INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_commits (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          progressDelta REAL DEFAULT 0,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS commit_images (
          id TEXT PRIMARY KEY,
          commitId TEXT NOT NULL,
          imagePath TEXT NOT NULL,
          caption TEXT DEFAULT '',
          sortIndex INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          FOREIGN KEY(commitId) REFERENCES project_commits(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS _migrations (
          key TEXT PRIMARY KEY,
          appliedAt INTEGER NOT NULL
        );
      `)
      addColumn(db, 'projects', 'coverImagePath TEXT DEFAULT ""')
      addColumn(db, 'projects', 'repoUrl TEXT DEFAULT ""')
    },
  },
  {
    version: 2,
    name: 'local-project-hub-domain-model',
    up: ({ db }) => {
      addColumn(db, 'projects', 'canonicalPath TEXT')
      addColumn(db, 'projects', 'phase TEXT DEFAULT ""')
      addColumn(db, 'projects', 'milestone TEXT DEFAULT ""')
      addColumn(db, 'projects', 'nextStep TEXT DEFAULT ""')
      addColumn(db, 'projects', 'importedAt INTEGER')

      db.exec(`
        CREATE TABLE IF NOT EXISTS git_commits (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          sha TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT DEFAULT '',
          authorName TEXT DEFAULT '',
          authorEmail TEXT DEFAULT '',
          authoredAt INTEGER NOT NULL,
          parentShasJson TEXT DEFAULT '[]',
          fileNamesJson TEXT DEFAULT '[]',
          statsJson TEXT DEFAULT '{}',
          createdAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
          UNIQUE(projectId, sha)
        );

        CREATE TABLE IF NOT EXISTS git_sync_state (
          projectId TEXT PRIMARY KEY,
          headSha TEXT DEFAULT '',
          lastSyncedSha TEXT DEFAULT '',
          branch TEXT DEFAULT '',
          detached INTEGER DEFAULT 0 CHECK(detached IN (0, 1)),
          remoteUrl TEXT DEFAULT '',
          commitCount INTEGER DEFAULT 0,
          lastScannedAt INTEGER,
          status TEXT NOT NULL DEFAULT 'never',
          error TEXT DEFAULT '',
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS development_records (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'ai')),
          reviewStatus TEXT NOT NULL DEFAULT 'accepted' CHECK(reviewStatus IN ('draft', 'accepted', 'rejected')),
          provider TEXT DEFAULT '',
          model TEXT DEFAULT '',
          promptVersion TEXT DEFAULT '',
          inputHash TEXT DEFAULT '',
          progressDelta REAL DEFAULT 0,
          userEditedAt INTEGER,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS development_record_git_commits (
          recordId TEXT NOT NULL,
          gitSha TEXT NOT NULL,
          PRIMARY KEY(recordId, gitSha),
          FOREIGN KEY(recordId) REFERENCES development_records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS development_record_images (
          id TEXT PRIMARY KEY,
          recordId TEXT NOT NULL,
          imagePath TEXT NOT NULL,
          caption TEXT DEFAULT '',
          sortIndex INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          FOREIGN KEY(recordId) REFERENCES development_records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS project_ai_rules (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          version INTEGER NOT NULL,
          language TEXT NOT NULL DEFAULT 'zh-CN',
          toneMode TEXT NOT NULL DEFAULT 'historical' CHECK(toneMode IN ('historical', 'standardized')),
          summaryGuidance TEXT DEFAULT '',
          recordGuidance TEXT DEFAULT '',
          exclusionsJson TEXT DEFAULT '[]',
          customRulesJson TEXT DEFAULT '[]',
          isActive INTEGER NOT NULL DEFAULT 1 CHECK(isActive IN (0, 1)),
          createdAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
          UNIQUE(projectId, version)
        );

        CREATE TABLE IF NOT EXISTS launch_profiles (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          name TEXT NOT NULL,
          executable TEXT NOT NULL,
          argsJson TEXT NOT NULL DEFAULT '[]',
          cwd TEXT NOT NULL,
          envJson TEXT NOT NULL DEFAULT '{}',
          readyUrl TEXT DEFAULT '',
          readyPort INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          validated INTEGER NOT NULL DEFAULT 0 CHECK(validated IN (0, 1)),
          confirmedHash TEXT DEFAULT '',
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS managed_assets (
          id TEXT PRIMARY KEY,
          projectId TEXT,
          recordId TEXT,
          path TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(recordId) REFERENCES development_records(id) ON DELETE CASCADE
        );
      `)

      db.exec(`
        INSERT OR IGNORE INTO development_records (
          id, projectId, title, description, source, reviewStatus, provider, model,
          promptVersion, inputHash, progressDelta, userEditedAt, createdAt, updatedAt
        )
        SELECT id, projectId, title, COALESCE(description, ''), 'manual', 'accepted', '', '',
          '', '', COALESCE(progressDelta, 0), updatedAt, createdAt, updatedAt
        FROM project_commits;

        INSERT OR IGNORE INTO development_record_images (
          id, recordId, imagePath, caption, sortIndex, createdAt
        )
        SELECT id, commitId, imagePath, COALESCE(caption, ''), sortIndex, createdAt
        FROM commit_images
        WHERE commitId IN (SELECT id FROM development_records);
      `)
    },
  },
  {
    version: 3,
    name: 'indexes-and-status-compatibility',
    up: ({ db }) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_development_records_project_review_date
          ON development_records(projectId, reviewStatus, createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_development_record_images_record
          ON development_record_images(recordId, sortIndex, createdAt);
        CREATE INDEX IF NOT EXISTS idx_record_git_sha ON development_record_git_commits(gitSha);
        CREATE INDEX IF NOT EXISTS idx_git_commits_project_date ON git_commits(projectId, authoredAt DESC);
        CREATE INDEX IF NOT EXISTS idx_launch_profiles_project ON launch_profiles(projectId, enabled);
        CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
        CREATE INDEX IF NOT EXISTS idx_project_tags_tagId ON project_tags(tagId);
        CREATE INDEX IF NOT EXISTS idx_noteblocks_projectId ON noteblocks(projectId);
        CREATE INDEX IF NOT EXISTS idx_todos_projectId ON todos(projectId, completed, createdAt);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_canonical_path_unique
          ON projects(canonicalPath) WHERE canonicalPath IS NOT NULL AND canonicalPath <> '';
      `)

      const now = Date.now()
      const statuses = [
        ['status-idea', '构思中', '#A8B0BD'],
        ['status-prototype', '原型中', '#74A9FF'],
        ['status-developing', '开发中', '#74A9FF'],
        ['status-demo', '可演示', '#63D693'],
        ['status-polish', '打磨中', '#B8A6FF'],
        ['status-paused', '暂停', '#F3BB6C'],
        ['status-completed', '完成', '#63D693'],
        ['status-archived', '归档', '#707A8A'],
      ] as const
      const insertStatus = db.prepare(`
        INSERT OR IGNORE INTO project_statuses (id, name, color, sortIndex, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      const statusCount = db.prepare('SELECT COUNT(*) AS count FROM project_statuses').get() as { count: number | bigint }
      if (Number(statusCount.count) === 0) {
        statuses.forEach((status, index) => insertStatus.run(status[0], status[1], status[2], index, now, now))
      }

      const legacyStatusMap: Record<string, string> = {
        developing: 'status-developing',
        completed: 'status-completed',
        paused: 'status-paused',
      }
      const updateStatus = db.prepare('UPDATE projects SET status = ?, updatedAt = ? WHERE id = ?')
      for (const project of db.prepare('SELECT id, status FROM projects').all() as Array<{ id: string; status: string }>) {
        const nextStatus = legacyStatusMap[project.status]
        if (nextStatus) updateStatus.run(nextStatus, now, project.id)
      }
    },
  },
  {
    version: 4,
    name: 'traceable-ai-generation-runs',
    up: ({ db }) => {
      addColumn(db, 'development_records', 'generationRunId TEXT')
      addColumn(db, 'development_records', 'confidence REAL')
      addColumn(db, 'development_records', "evidenceJson TEXT DEFAULT '[]'")
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_generation_runs (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          promptVersion TEXT NOT NULL,
          inputHash TEXT NOT NULL,
          inputShasJson TEXT NOT NULL,
          outputJson TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ai_generation_runs_project_date
          ON ai_generation_runs(projectId, createdAt DESC);
      `)
    },
  },
  {
    version: 5,
    name: 'git-reachability-generations',
    up: ({ db }) => {
      // Existing rows remain visible until the first post-migration full scan. The
      // empty scanGeneration cursor makes the domain layer perform that scan.
      addColumn(db, 'git_commits', 'reachable INTEGER NOT NULL DEFAULT 1 CHECK(reachable IN (0, 1))')
      addColumn(db, 'git_commits', "lastSeenGeneration TEXT NOT NULL DEFAULT ''")
      addColumn(db, 'git_sync_state', "scanGeneration TEXT NOT NULL DEFAULT ''")
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_git_commits_project_reachable_date
          ON git_commits(projectId, reachable, authoredAt DESC, sha DESC);
      `)
    },
  },
  {
    version: 6,
    name: 'git-commit-dispositions',
    up: ({ db }) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS git_commit_tracking (
          projectId TEXT NOT NULL,
          gitSha TEXT NOT NULL,
          disposition TEXT NOT NULL DEFAULT 'pending'
            CHECK(disposition IN ('pending', 'handled', 'ignored')),
          seenAt INTEGER,
          handledByRecordId TEXT,
          updatedAt INTEGER NOT NULL,
          PRIMARY KEY(projectId, gitSha),
          FOREIGN KEY(projectId, gitSha) REFERENCES git_commits(projectId, sha) ON DELETE CASCADE,
          FOREIGN KEY(handledByRecordId) REFERENCES development_records(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_git_commit_tracking_project_disposition
          ON git_commit_tracking(projectId, disposition, updatedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_git_commit_tracking_record
          ON git_commit_tracking(handledByRecordId);
      `)
      if (tableExists(db, 'development_records') && tableExists(db, 'development_record_git_commits')) {
        db.exec(`
          INSERT OR IGNORE INTO git_commit_tracking (
            projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
          )
          SELECT dr.projectId, link.gitSha, 'handled', dr.updatedAt, dr.id, dr.updatedAt
          FROM development_record_git_commits link
          JOIN development_records dr ON dr.id = link.recordId
          JOIN git_commits gc ON gc.projectId = dr.projectId AND gc.sha = link.gitSha
          WHERE dr.reviewStatus = 'accepted';
        `)
      }
    },
  },
  {
    version: 7,
    name: 'git-commit-active-record-invariants',
    up: ({ db }) => {
      if (
        !tableExists(db, 'git_commits')
        || !tableExists(db, 'git_commit_tracking')
        || !tableExists(db, 'development_records')
        || !tableExists(db, 'development_record_git_commits')
      ) return

      // An active record is the source of truth for commit consumption. Repair
      // rows produced before this invariant existed while preserving seenAt.
      db.exec(`
        INSERT INTO git_commit_tracking (
          projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
        )
        SELECT gc.projectId, gc.sha,
          CASE activeRecord.reviewStatus WHEN 'accepted' THEN 'handled' ELSE 'pending' END,
          CASE
            WHEN activeRecord.reviewStatus = 'accepted' THEN COALESCE(gt.seenAt, activeRecord.updatedAt)
            ELSE gt.seenAt
          END,
          CASE activeRecord.reviewStatus WHEN 'accepted' THEN activeRecord.id ELSE NULL END,
          MAX(COALESCE(gt.updatedAt, 0), activeRecord.updatedAt)
        FROM git_commits gc
        JOIN development_records activeRecord ON activeRecord.id = (
          SELECT dr.id
          FROM development_record_git_commits link
          JOIN development_records dr ON dr.id = link.recordId
          WHERE dr.projectId = gc.projectId AND link.gitSha = gc.sha
            AND dr.reviewStatus IN ('draft', 'accepted')
          ORDER BY CASE dr.reviewStatus WHEN 'accepted' THEN 0 ELSE 1 END,
            dr.updatedAt DESC, dr.id DESC
          LIMIT 1
        )
        LEFT JOIN git_commit_tracking gt
          ON gt.projectId = gc.projectId AND gt.gitSha = gc.sha
        WHERE activeRecord.reviewStatus IN ('draft', 'accepted')
        ON CONFLICT(projectId, gitSha) DO UPDATE SET
          disposition = excluded.disposition,
          seenAt = COALESCE(git_commit_tracking.seenAt, excluded.seenAt),
          handledByRecordId = excluded.handledByRecordId,
          updatedAt = excluded.updatedAt;

        UPDATE git_commit_tracking
        SET handledByRecordId = NULL
        WHERE handledByRecordId IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM development_record_git_commits link
            JOIN development_records dr ON dr.id = link.recordId
            WHERE dr.id = git_commit_tracking.handledByRecordId
              AND dr.projectId = git_commit_tracking.projectId
              AND link.gitSha = git_commit_tracking.gitSha
              AND dr.reviewStatus = 'accepted'
          );

        DROP TRIGGER IF EXISTS trg_git_tracking_active_insert_guard;
        DROP TRIGGER IF EXISTS trg_git_tracking_active_update_guard;
        DROP TRIGGER IF EXISTS trg_git_tracking_active_delete_guard;
        DROP TRIGGER IF EXISTS trg_git_record_link_sync_tracking;
        DROP TRIGGER IF EXISTS trg_git_record_link_release_tracking;
        DROP TRIGGER IF EXISTS trg_development_record_status_sync_tracking;

        CREATE TRIGGER trg_git_tracking_active_insert_guard
        BEFORE INSERT ON git_commit_tracking
        WHEN NOT EXISTS (
          SELECT 1 FROM git_commit_tracking existing
          WHERE existing.projectId = NEW.projectId AND existing.gitSha = NEW.gitSha
        )
        BEGIN
          SELECT CASE
            WHEN EXISTS (
              SELECT 1 FROM development_record_git_commits link
              JOIN development_records dr ON dr.id = link.recordId
              WHERE dr.projectId = NEW.projectId AND link.gitSha = NEW.gitSha
                AND dr.reviewStatus = 'accepted'
            ) AND (
              NEW.disposition <> 'handled'
              OR NEW.handledByRecordId IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM development_record_git_commits link
                JOIN development_records dr ON dr.id = link.recordId
                WHERE dr.id = NEW.handledByRecordId AND dr.projectId = NEW.projectId
                  AND link.gitSha = NEW.gitSha AND dr.reviewStatus = 'accepted'
              )
            ) THEN RAISE(ABORT, 'accepted Git commit must be handled by its active record')
            WHEN NOT EXISTS (
              SELECT 1 FROM development_record_git_commits link
              JOIN development_records dr ON dr.id = link.recordId
              WHERE dr.projectId = NEW.projectId AND link.gitSha = NEW.gitSha
                AND dr.reviewStatus = 'accepted'
            ) AND EXISTS (
              SELECT 1 FROM development_record_git_commits link
              JOIN development_records dr ON dr.id = link.recordId
              WHERE dr.projectId = NEW.projectId AND link.gitSha = NEW.gitSha
                AND dr.reviewStatus = 'draft'
            ) AND (NEW.disposition <> 'pending' OR NEW.handledByRecordId IS NOT NULL)
              THEN RAISE(ABORT, 'draft Git commit must remain pending')
            WHEN NEW.handledByRecordId IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM development_record_git_commits link
              JOIN development_records dr ON dr.id = link.recordId
              WHERE dr.id = NEW.handledByRecordId AND dr.projectId = NEW.projectId
                AND link.gitSha = NEW.gitSha AND dr.reviewStatus = 'accepted'
            ) THEN RAISE(ABORT, 'handled record must be an accepted linked record')
          END;
        END;

        CREATE TRIGGER trg_git_tracking_active_update_guard
        BEFORE UPDATE OF disposition, handledByRecordId ON git_commit_tracking
        BEGIN
          SELECT CASE
            WHEN EXISTS (
              SELECT 1 FROM development_record_git_commits link
              JOIN development_records dr ON dr.id = link.recordId
              WHERE dr.projectId = NEW.projectId AND link.gitSha = NEW.gitSha
                AND dr.reviewStatus = 'accepted'
            ) AND (
              NEW.disposition <> 'handled'
              OR NEW.handledByRecordId IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM development_record_git_commits link
                JOIN development_records dr ON dr.id = link.recordId
                WHERE dr.id = NEW.handledByRecordId AND dr.projectId = NEW.projectId
                  AND link.gitSha = NEW.gitSha AND dr.reviewStatus = 'accepted'
              )
            ) THEN RAISE(ABORT, 'accepted Git commit must be handled by its active record')
            WHEN NOT EXISTS (
              SELECT 1 FROM development_record_git_commits link
              JOIN development_records dr ON dr.id = link.recordId
              WHERE dr.projectId = NEW.projectId AND link.gitSha = NEW.gitSha
                AND dr.reviewStatus = 'accepted'
            ) AND EXISTS (
              SELECT 1 FROM development_record_git_commits link
              JOIN development_records dr ON dr.id = link.recordId
              WHERE dr.projectId = NEW.projectId AND link.gitSha = NEW.gitSha
                AND dr.reviewStatus = 'draft'
            ) AND (NEW.disposition <> 'pending' OR NEW.handledByRecordId IS NOT NULL)
              THEN RAISE(ABORT, 'draft Git commit must remain pending')
            WHEN NEW.handledByRecordId IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM development_record_git_commits link
              JOIN development_records dr ON dr.id = link.recordId
              WHERE dr.id = NEW.handledByRecordId AND dr.projectId = NEW.projectId
                AND link.gitSha = NEW.gitSha AND dr.reviewStatus = 'accepted'
            ) THEN RAISE(ABORT, 'handled record must be an accepted linked record')
          END;
        END;

        CREATE TRIGGER trg_git_tracking_active_delete_guard
        BEFORE DELETE ON git_commit_tracking
        WHEN EXISTS (
          SELECT 1 FROM git_commits gc
          WHERE gc.projectId = OLD.projectId AND gc.sha = OLD.gitSha
        ) AND EXISTS (
          SELECT 1 FROM development_record_git_commits link
          JOIN development_records dr ON dr.id = link.recordId
          WHERE dr.projectId = OLD.projectId AND link.gitSha = OLD.gitSha
            AND dr.reviewStatus = 'accepted'
        )
        BEGIN
          SELECT RAISE(ABORT, 'accepted Git commit tracking cannot be deleted');
        END;

        CREATE TRIGGER trg_git_record_link_sync_tracking
        AFTER INSERT ON development_record_git_commits
        WHEN EXISTS (
          SELECT 1 FROM development_records owner
          JOIN git_commits gc ON gc.projectId = owner.projectId AND gc.sha = NEW.gitSha
          WHERE owner.id = NEW.recordId
        )
        BEGIN
          INSERT INTO git_commit_tracking (
            projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
          )
          SELECT owner.projectId, NEW.gitSha,
            CASE activeRecord.reviewStatus WHEN 'accepted' THEN 'handled' ELSE 'pending' END,
            CASE activeRecord.reviewStatus WHEN 'accepted' THEN activeRecord.updatedAt ELSE NULL END,
            CASE activeRecord.reviewStatus WHEN 'accepted' THEN activeRecord.id ELSE NULL END,
            activeRecord.updatedAt
          FROM development_records owner
          JOIN development_records activeRecord ON activeRecord.id = (
            SELECT dr.id
            FROM development_record_git_commits link
            JOIN development_records dr ON dr.id = link.recordId
            WHERE dr.projectId = owner.projectId AND link.gitSha = NEW.gitSha
              AND dr.reviewStatus IN ('draft', 'accepted')
            ORDER BY CASE dr.reviewStatus WHEN 'accepted' THEN 0 ELSE 1 END,
              dr.updatedAt DESC, dr.id DESC
            LIMIT 1
          )
          WHERE owner.id = NEW.recordId
          ON CONFLICT(projectId, gitSha) DO UPDATE SET
            disposition = excluded.disposition,
            seenAt = COALESCE(git_commit_tracking.seenAt, excluded.seenAt),
            handledByRecordId = excluded.handledByRecordId,
            updatedAt = excluded.updatedAt;
        END;

        CREATE TRIGGER trg_git_record_link_release_tracking
        AFTER DELETE ON development_record_git_commits
        WHEN EXISTS (
          SELECT 1 FROM development_records owner
          WHERE owner.id = OLD.recordId AND owner.reviewStatus IN ('draft', 'accepted')
        )
        BEGIN
          UPDATE git_commit_tracking
          SET disposition = CASE WHEN EXISTS (
                SELECT 1 FROM development_record_git_commits activeLink
                JOIN development_records activeRecord ON activeRecord.id = activeLink.recordId
                WHERE activeRecord.projectId = (
                    SELECT projectId FROM development_records WHERE id = OLD.recordId
                  )
                  AND activeLink.gitSha = OLD.gitSha
                  AND activeRecord.reviewStatus = 'accepted'
              ) THEN 'handled' ELSE 'pending' END,
            handledByRecordId = (
              SELECT activeRecord.id
              FROM development_record_git_commits activeLink
              JOIN development_records activeRecord ON activeRecord.id = activeLink.recordId
              WHERE activeRecord.projectId = (
                  SELECT projectId FROM development_records WHERE id = OLD.recordId
                )
                AND activeLink.gitSha = OLD.gitSha
                AND activeRecord.reviewStatus = 'accepted'
              ORDER BY activeRecord.updatedAt DESC, activeRecord.id DESC
              LIMIT 1
            ),
            updatedAt = MAX(updatedAt, (
              SELECT updatedAt FROM development_records WHERE id = OLD.recordId
            ))
          WHERE projectId = (
              SELECT projectId FROM development_records WHERE id = OLD.recordId
            ) AND gitSha = OLD.gitSha;
        END;

        CREATE TRIGGER trg_development_record_status_sync_tracking
        AFTER UPDATE OF reviewStatus ON development_records
        WHEN OLD.reviewStatus <> NEW.reviewStatus
        BEGIN
          UPDATE git_commit_tracking
          SET disposition = CASE WHEN EXISTS (
                SELECT 1 FROM development_record_git_commits activeLink
                JOIN development_records activeRecord ON activeRecord.id = activeLink.recordId
                WHERE activeRecord.projectId = NEW.projectId
                  AND activeLink.gitSha = git_commit_tracking.gitSha
                  AND activeRecord.reviewStatus = 'accepted'
              ) THEN 'handled' ELSE 'pending' END,
            handledByRecordId = (
              SELECT activeRecord.id
              FROM development_record_git_commits activeLink
              JOIN development_records activeRecord ON activeRecord.id = activeLink.recordId
              WHERE activeRecord.projectId = NEW.projectId
                AND activeLink.gitSha = git_commit_tracking.gitSha
                AND activeRecord.reviewStatus = 'accepted'
              ORDER BY activeRecord.updatedAt DESC, activeRecord.id DESC
              LIMIT 1
            ),
            updatedAt = MAX(updatedAt, NEW.updatedAt)
          WHERE projectId = NEW.projectId
            AND gitSha IN (
              SELECT gitSha FROM development_record_git_commits WHERE recordId = NEW.id
            );

          INSERT INTO git_commit_tracking (
            projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
          )
          SELECT NEW.projectId, link.gitSha,
            CASE activeRecord.reviewStatus WHEN 'accepted' THEN 'handled' ELSE 'pending' END,
            CASE activeRecord.reviewStatus WHEN 'accepted' THEN activeRecord.updatedAt ELSE NULL END,
            CASE activeRecord.reviewStatus WHEN 'accepted' THEN activeRecord.id ELSE NULL END,
            activeRecord.updatedAt
          FROM development_record_git_commits link
          JOIN git_commits gc ON gc.projectId = NEW.projectId AND gc.sha = link.gitSha
          JOIN development_records activeRecord ON activeRecord.id = (
            SELECT candidate.id
            FROM development_record_git_commits activeLink
            JOIN development_records candidate ON candidate.id = activeLink.recordId
            WHERE candidate.projectId = NEW.projectId AND activeLink.gitSha = link.gitSha
              AND candidate.reviewStatus IN ('draft', 'accepted')
            ORDER BY CASE candidate.reviewStatus WHEN 'accepted' THEN 0 ELSE 1 END,
              candidate.updatedAt DESC, candidate.id DESC
            LIMIT 1
          )
          WHERE link.recordId = NEW.id
          ON CONFLICT(projectId, gitSha) DO UPDATE SET
            disposition = excluded.disposition,
            seenAt = COALESCE(git_commit_tracking.seenAt, excluded.seenAt),
            handledByRecordId = excluded.handledByRecordId,
            updatedAt = excluded.updatedAt;
        END;
      `)
    },
  },
  {
    version: 8,
    name: 'recoverable-ai-generation-runs',
    up: ({ db }) => {
      if (!tableExists(db, 'ai_generation_runs')) return
      addColumn(db, 'ai_generation_runs', "status TEXT NOT NULL DEFAULT 'succeeded' CHECK(status IN ('running', 'succeeded', 'failed', 'cancelled'))")
      addColumn(db, 'ai_generation_runs', 'rulesVersion INTEGER NOT NULL DEFAULT 0')
      addColumn(db, 'ai_generation_runs', "rulesSnapshotJson TEXT NOT NULL DEFAULT '{}'")
      addColumn(db, 'ai_generation_runs', "settingsSnapshotJson TEXT NOT NULL DEFAULT '{}'")
      addColumn(db, 'ai_generation_runs', "inputSnapshotJson TEXT NOT NULL DEFAULT '{}'")
      addColumn(db, 'ai_generation_runs', "replaceDraftIdsJson TEXT NOT NULL DEFAULT '[]'")
      addColumn(db, 'ai_generation_runs', "error TEXT NOT NULL DEFAULT ''")
      addColumn(db, 'ai_generation_runs', 'updatedAt INTEGER NOT NULL DEFAULT 0')
      addColumn(db, 'ai_generation_runs', 'completedAt INTEGER')
      db.exec(`
        UPDATE ai_generation_runs
        SET status = 'succeeded', updatedAt = createdAt, completedAt = COALESCE(completedAt, createdAt)
        WHERE updatedAt = 0;
        CREATE INDEX IF NOT EXISTS idx_ai_generation_runs_project_status_date
          ON ai_generation_runs(projectId, status, createdAt DESC);
      `)
    },
  },
  {
    version: 9,
    name: 'persistent-git-sync-scheduling',
    up: ({ db }) => {
      if (!tableExists(db, 'git_sync_state')) return
      // Some legacy/partially migrated databases predate the complete v2
      // git_sync_state shape. Keep this migration defensive so the automatic
      // pre-migration backup and transaction can recover those installations
      // instead of failing while creating the scheduler index.
      addColumn(db, 'git_sync_state', "status TEXT NOT NULL DEFAULT 'never'")
      addColumn(db, 'git_sync_state', "error TEXT DEFAULT ''")
      addColumn(db, 'git_sync_state', 'lastScannedAt INTEGER')
      addColumn(db, 'git_sync_state', 'failureCount INTEGER NOT NULL DEFAULT 0 CHECK(failureCount >= 0)')
      addColumn(db, 'git_sync_state', 'nextRetryAt INTEGER')
      db.exec(`
        UPDATE git_sync_state SET
          status = 'failed',
          error = CASE
            WHEN COALESCE(error, '') = '' THEN '应用上次退出时 Git 同步仍在执行，已安排重新同步'
            ELSE error
          END,
          failureCount = failureCount + 1,
          nextRetryAt = 0
        WHERE status = 'syncing';

        CREATE INDEX IF NOT EXISTS idx_git_sync_state_schedule
          ON git_sync_state(status, nextRetryAt, lastScannedAt);
      `)
    },
  },
  {
    version: 10,
    name: 'resumable-git-history-backfill',
    up: ({ db }) => {
      if (!tableExists(db, 'git_sync_state')) return
      addColumn(db, 'git_sync_state', "backfillHeadSha TEXT NOT NULL DEFAULT ''")
      addColumn(db, 'git_sync_state', "backfillBaseSha TEXT NOT NULL DEFAULT ''")
      addColumn(db, 'git_sync_state', "backfillMode TEXT NOT NULL DEFAULT ''")
      addColumn(db, 'git_sync_state', "backfillGeneration TEXT NOT NULL DEFAULT ''")
      addColumn(db, 'git_sync_state', 'backfillOffset INTEGER NOT NULL DEFAULT 0 CHECK(backfillOffset >= 0)')
      addColumn(db, 'git_sync_state', 'backfillTotal INTEGER NOT NULL DEFAULT 0 CHECK(backfillTotal >= 0)')
      addColumn(db, 'git_sync_state', 'backfillInserted INTEGER NOT NULL DEFAULT 0 CHECK(backfillInserted >= 0)')
      addColumn(db, 'git_sync_state', 'backfillStartedAt INTEGER')
      addColumn(db, 'git_sync_state', 'backfillUpdatedAt INTEGER')
      db.exec(`
        UPDATE git_sync_state SET
          backfillOffset = MAX(0, COALESCE(backfillOffset, 0)),
          backfillTotal = MAX(0, COALESCE(backfillTotal, 0)),
          backfillInserted = MAX(0, COALESCE(backfillInserted, 0));

        CREATE INDEX IF NOT EXISTS idx_git_sync_state_backfill
          ON git_sync_state(backfillGeneration, backfillUpdatedAt);
      `)
    },
  },
  {
    version: 11,
    name: 'traceable-ai-project-suggestion-applications',
    up: ({ db }) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_project_suggestion_applications (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          generationRunId TEXT NOT NULL,
          inputShasJson TEXT NOT NULL DEFAULT '[]',
          beforeJson TEXT NOT NULL DEFAULT '{}',
          appliedJson TEXT NOT NULL DEFAULT '{}',
          createdAt INTEGER NOT NULL,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(generationRunId) REFERENCES ai_generation_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ai_project_suggestion_applications_run
          ON ai_project_suggestion_applications(generationRunId, createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_project_suggestion_applications_project
          ON ai_project_suggestion_applications(projectId, createdAt DESC);
      `)
    },
  },
  {
    version: 12,
    name: 'persistent-background-task-history',
    up: ({ db }) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS background_tasks (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          projectId TEXT NOT NULL DEFAULT '',
          generationRunId TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
          detail TEXT NOT NULL DEFAULT '',
          progress REAL,
          contextJson TEXT NOT NULL DEFAULT '{}',
          canRetry INTEGER NOT NULL DEFAULT 0 CHECK(canRetry IN (0, 1)),
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_background_tasks_updated
          ON background_tasks(updatedAt DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_background_tasks_project
          ON background_tasks(projectId, updatedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_background_tasks_status
          ON background_tasks(status, updatedAt DESC);
      `)
    },
  },
  {
    version: 13,
    name: 'persistent-launch-run-history',
    up: ({ db }) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS launch_runs (
          id TEXT PRIMARY KEY,
          profileId TEXT NOT NULL,
          projectId TEXT NOT NULL,
          sessionId TEXT NOT NULL,
          commandHash TEXT NOT NULL,
          pid INTEGER,
          state TEXT NOT NULL CHECK(state IN (
            'starting', 'running', 'ready', 'failed', 'stopped', 'interrupted'
          )),
          startedAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          stoppedAt INTEGER,
          error TEXT NOT NULL DEFAULT '',
          logsJson TEXT NOT NULL DEFAULT '[]',
          FOREIGN KEY(profileId) REFERENCES launch_profiles(id) ON DELETE CASCADE,
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_launch_runs_profile_started
          ON launch_runs(profileId, startedAt DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_launch_runs_project_started
          ON launch_runs(projectId, startedAt DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_launch_runs_state_updated
          ON launch_runs(state, updatedAt DESC, id DESC);
      `)
    },
  },
  {
    version: 14,
    name: 'remove-pseudo-progress-semantics',
    up: ({ db }) => {
      // Project completion and record impact were historically represented as
      // user-entered percentages. They are not measurable task progress and
      // conflict with the phase / milestone / next-step model. SQLite's DROP
      // COLUMN keeps every remaining row, constraint, index and foreign key in
      // place while removing only these two obsolete values.
      if (columnExists(db, 'projects', 'progress')) {
        db.exec('ALTER TABLE projects DROP COLUMN progress')
      }
      if (columnExists(db, 'development_records', 'progressDelta')) {
        db.exec('ALTER TABLE development_records DROP COLUMN progressDelta')
      }
    },
  },
  {
    version: 15,
    name: 'core-domain-database-invariants',
    up: ({ db }) => {
      if (tableExists(db, 'projects') && tableExists(db, 'project_statuses')) {
        const statuses = db.prepare('SELECT id, name FROM project_statuses ORDER BY sortIndex, createdAt, id').all() as Array<{ id: string; name: string }>
        const fallbackStatusId = statuses[0]?.id
        const legacyAliases: Record<string, string> = {
          developing: 'status-developing',
          completed: 'status-completed',
          paused: 'status-paused',
        }
        const invalidProjects = db.prepare(`
          SELECT p.id, p.status FROM projects p
          LEFT JOIN project_statuses ps ON ps.id = p.status
          WHERE ps.id IS NULL
        `).all() as Array<{ id: string; status: string | null }>
        const updateProjectStatus = db.prepare('UPDATE projects SET status = ? WHERE id = ?')
        const insertLegacyStatus = db.prepare(`
          INSERT OR IGNORE INTO project_statuses (id, name, color, sortIndex, createdAt, updatedAt)
          VALUES (?, ?, '#A8B0BD', ?, ?, ?)
        `)
        let nextSortIndex = statuses.length
        for (const project of invalidProjects) {
          const legacyStatus = String(project.status || '').trim()
          let statusId = legacyAliases[legacyStatus]
          if (!statusId || !statuses.some(status => status.id === statusId)) {
            statusId = statuses.find(status => status.name.toLocaleLowerCase() === legacyStatus.toLocaleLowerCase())?.id || ''
          }
          if (!statusId && legacyStatus) {
            statusId = `legacy-status-${createHash('sha256').update(legacyStatus).digest('hex').slice(0, 24)}`
            insertLegacyStatus.run(statusId, legacyStatus.slice(0, 80), nextSortIndex, Date.now(), Date.now())
            nextSortIndex += 1
            statuses.push({ id: statusId, name: legacyStatus.slice(0, 80) })
          }
          updateProjectStatus.run(statusId || fallbackStatusId || 'status-developing', project.id)
        }

        db.exec(`
          DROP TRIGGER IF EXISTS trg_projects_status_insert_guard;
          DROP TRIGGER IF EXISTS trg_projects_status_update_guard;
          DROP TRIGGER IF EXISTS trg_projects_status_insert_alias;
          DROP TRIGGER IF EXISTS trg_projects_status_update_alias;
          DROP TRIGGER IF EXISTS trg_project_status_delete_guard;

          CREATE TRIGGER trg_projects_status_insert_guard
          BEFORE INSERT ON projects
          WHEN COALESCE(NEW.status, '') NOT IN ('', 'developing', 'completed', 'paused')
            AND NOT EXISTS (SELECT 1 FROM project_statuses WHERE id = NEW.status)
          BEGIN
            SELECT RAISE(ABORT, 'project status must reference project_statuses');
          END;

          CREATE TRIGGER trg_projects_status_update_guard
          BEFORE UPDATE OF status ON projects
          WHEN COALESCE(NEW.status, '') NOT IN ('', 'developing', 'completed', 'paused')
            AND NOT EXISTS (SELECT 1 FROM project_statuses WHERE id = NEW.status)
          BEGIN
            SELECT RAISE(ABORT, 'project status must reference project_statuses');
          END;

          CREATE TRIGGER trg_projects_status_insert_alias
          AFTER INSERT ON projects
          WHEN COALESCE(NEW.status, '') IN ('', 'developing', 'completed', 'paused')
          BEGIN
            UPDATE projects SET status = COALESCE(
              (SELECT id FROM project_statuses WHERE id = CASE NEW.status
                WHEN 'completed' THEN 'status-completed'
                WHEN 'paused' THEN 'status-paused'
                ELSE 'status-developing' END),
              (SELECT id FROM project_statuses ORDER BY sortIndex, createdAt, id LIMIT 1)
            ) WHERE id = NEW.id;
          END;

          CREATE TRIGGER trg_projects_status_update_alias
          AFTER UPDATE OF status ON projects
          WHEN COALESCE(NEW.status, '') IN ('', 'developing', 'completed', 'paused')
          BEGIN
            UPDATE projects SET status = COALESCE(
              (SELECT id FROM project_statuses WHERE id = CASE NEW.status
                WHEN 'completed' THEN 'status-completed'
                WHEN 'paused' THEN 'status-paused'
                ELSE 'status-developing' END),
              (SELECT id FROM project_statuses ORDER BY sortIndex, createdAt, id LIMIT 1)
            ) WHERE id = NEW.id;
          END;

          CREATE TRIGGER trg_project_status_delete_guard
          BEFORE DELETE ON project_statuses
          WHEN EXISTS (SELECT 1 FROM projects WHERE status = OLD.id)
          BEGIN
            SELECT RAISE(ABORT, 'project status is still in use');
          END;
        `)
      }

      if (tableExists(db, 'ai_generation_runs') && columnExists(db, 'ai_generation_runs', 'completedAt')) {
        db.exec(`
          DROP TRIGGER IF EXISTS trg_ai_generation_lifecycle_insert_guard;
          DROP TRIGGER IF EXISTS trg_ai_generation_lifecycle_update_guard;

          CREATE TRIGGER trg_ai_generation_lifecycle_insert_guard
          BEFORE INSERT ON ai_generation_runs
          WHEN (NEW.status = 'running' AND NEW.completedAt IS NOT NULL)
            OR (NEW.status <> 'running' AND NEW.completedAt IS NULL)
          BEGIN
            SELECT RAISE(ABORT, 'AI generation run lifecycle is inconsistent');
          END;

          CREATE TRIGGER trg_ai_generation_lifecycle_update_guard
          BEFORE UPDATE OF status, completedAt, createdAt, updatedAt ON ai_generation_runs
          WHEN (NEW.status = 'running' AND NEW.completedAt IS NOT NULL)
            OR (NEW.status <> 'running' AND NEW.completedAt IS NULL)
          BEGIN
            SELECT RAISE(ABORT, 'AI generation run lifecycle is inconsistent');
          END;
        `)
      }

      if (tableExists(db, 'development_records')) {
        db.exec(`
          DROP TRIGGER IF EXISTS trg_development_record_manual_review_insert_guard;
          DROP TRIGGER IF EXISTS trg_development_record_manual_review_update_guard;
          DROP TRIGGER IF EXISTS trg_development_record_source_immutable;
          DROP TRIGGER IF EXISTS trg_development_record_generation_insert_guard;
          DROP TRIGGER IF EXISTS trg_development_record_generation_update_guard;

          CREATE TRIGGER trg_development_record_manual_review_insert_guard
          BEFORE INSERT ON development_records
          WHEN NEW.source = 'manual' AND NEW.reviewStatus <> 'accepted'
          BEGIN
            SELECT RAISE(ABORT, 'manual development records must be accepted');
          END;

          CREATE TRIGGER trg_development_record_manual_review_update_guard
          BEFORE UPDATE OF source, reviewStatus ON development_records
          WHEN NEW.source = 'manual' AND NEW.reviewStatus <> 'accepted'
          BEGIN
            SELECT RAISE(ABORT, 'manual development records must be accepted');
          END;

          CREATE TRIGGER trg_development_record_source_immutable
          BEFORE UPDATE OF source ON development_records
          WHEN NEW.source <> OLD.source
          BEGIN
            SELECT RAISE(ABORT, 'development record source is immutable');
          END;
        `)
        if (tableExists(db, 'ai_generation_runs') && columnExists(db, 'development_records', 'generationRunId')) {
          db.exec(`
            CREATE TRIGGER trg_development_record_generation_insert_guard
            BEFORE INSERT ON development_records
            WHEN COALESCE(NEW.generationRunId, '') <> '' AND (
              NEW.source <> 'ai' OR NOT EXISTS (
                SELECT 1 FROM ai_generation_runs run
                WHERE run.id = NEW.generationRunId AND run.projectId = NEW.projectId
              )
            )
            BEGIN
              SELECT RAISE(ABORT, 'AI development record must reference a generation run from the same project');
            END;

            CREATE TRIGGER trg_development_record_generation_update_guard
            BEFORE UPDATE OF projectId, source, generationRunId ON development_records
            WHEN COALESCE(NEW.generationRunId, '') <> '' AND (
              NEW.source <> 'ai' OR NOT EXISTS (
                SELECT 1 FROM ai_generation_runs run
                WHERE run.id = NEW.generationRunId AND run.projectId = NEW.projectId
              )
            )
            BEGIN
              SELECT RAISE(ABORT, 'AI development record must reference a generation run from the same project');
            END;
          `)
        }
      }

      if (
        tableExists(db, 'development_record_git_commits')
        && tableExists(db, 'development_records')
        && tableExists(db, 'git_commits')
      ) {
        db.exec(`
          DROP TRIGGER IF EXISTS trg_record_git_sha_insert_guard;
          DROP TRIGGER IF EXISTS trg_record_git_project_insert_guard;
          DROP TRIGGER IF EXISTS trg_record_git_active_insert_guard;
          DROP TRIGGER IF EXISTS trg_record_git_active_status_guard;
          DROP TRIGGER IF EXISTS trg_record_git_link_immutable;

          CREATE TRIGGER trg_record_git_sha_insert_guard
          BEFORE INSERT ON development_record_git_commits
          WHEN length(NEW.gitSha) < 7 OR length(NEW.gitSha) > 64
            OR NEW.gitSha GLOB '*[^0-9A-Fa-f]*'
          BEGIN
            SELECT RAISE(ABORT, 'development record Git SHA is invalid');
          END;

          CREATE TRIGGER trg_record_git_project_insert_guard
          BEFORE INSERT ON development_record_git_commits
          WHEN EXISTS (SELECT 1 FROM git_commits WHERE sha = NEW.gitSha)
            AND NOT EXISTS (
              SELECT 1 FROM development_records owner
              JOIN git_commits commitFact
                ON commitFact.projectId = owner.projectId AND commitFact.sha = NEW.gitSha
              WHERE owner.id = NEW.recordId
            )
          BEGIN
            SELECT RAISE(ABORT, 'development record Git SHA belongs to another project');
          END;

          CREATE TRIGGER trg_record_git_active_insert_guard
          BEFORE INSERT ON development_record_git_commits
          WHEN EXISTS (
            SELECT 1 FROM development_records incoming
            JOIN development_record_git_commits existingLink ON existingLink.gitSha = NEW.gitSha
            JOIN development_records existingRecord ON existingRecord.id = existingLink.recordId
            WHERE incoming.id = NEW.recordId
              AND incoming.reviewStatus IN ('draft', 'accepted')
              AND existingRecord.projectId = incoming.projectId
              AND existingRecord.id <> incoming.id
              AND existingRecord.reviewStatus IN ('draft', 'accepted')
          )
          BEGIN
            SELECT RAISE(ABORT, 'Git SHA already belongs to an active development record');
          END;

          CREATE TRIGGER trg_record_git_active_status_guard
          BEFORE UPDATE OF reviewStatus, projectId ON development_records
          WHEN NEW.reviewStatus IN ('draft', 'accepted') AND EXISTS (
            SELECT 1 FROM development_record_git_commits ownLink
            JOIN development_record_git_commits existingLink ON existingLink.gitSha = ownLink.gitSha
            JOIN development_records existingRecord ON existingRecord.id = existingLink.recordId
            WHERE ownLink.recordId = NEW.id
              AND existingRecord.projectId = NEW.projectId
              AND existingRecord.id <> NEW.id
              AND existingRecord.reviewStatus IN ('draft', 'accepted')
          )
          BEGIN
            SELECT RAISE(ABORT, 'Git SHA already belongs to an active development record');
          END;

          CREATE TRIGGER trg_record_git_link_immutable
          BEFORE UPDATE ON development_record_git_commits
          BEGIN
            SELECT RAISE(ABORT, 'development record Git links are immutable; delete and insert instead');
          END;
        `)
      }
    },
  },
  {
    version: 16,
    name: 'bounded-git-history-baseline',
    up: ({ db }) => {
      if (!tableExists(db, 'git_sync_state')) return
      addColumn(db, 'git_sync_state', 'historyLimit INTEGER NOT NULL DEFAULT 0 CHECK(historyLimit >= 0)')
      addColumn(db, 'git_sync_state', 'historyTruncated INTEGER NOT NULL DEFAULT 0 CHECK(historyTruncated IN (0, 1))')
      db.exec(`
        UPDATE git_sync_state SET
          historyLimit = MAX(0, COALESCE(historyLimit, 0)),
          historyTruncated = CASE WHEN historyTruncated = 1 THEN 1 ELSE 0 END;
      `)
    },
  },
  {
    version: 17,
    name: 'project-relink-asset-roots',
    up: ({ db }) => {
      if (!tableExists(db, 'projects')) return
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_relink_roots (
          projectId TEXT NOT NULL,
          rootPath TEXT NOT NULL COLLATE NOCASE,
          createdAt INTEGER NOT NULL,
          PRIMARY KEY (projectId, rootPath),
          FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_project_relink_roots_project_date
          ON project_relink_roots(projectId, createdAt DESC);
      `)
    },
  },
]

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1].version

export function getSchemaVersion(db: SqliteDatabase) {
  if (!tableExists(db, 'schema_migrations')) return 0
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }
  return Number(row.version) || 0
}

function hasUserSchema(db: SqliteDatabase) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
  `).get() as { count: number }
  return row.count > 0
}

export function migrateDatabase(
  db: SqliteDatabase,
  options: { dbPath: string; now?: Date; onBackup?: (backupPath: string) => void },
): MigrationResult {
  const fromVersion = getSchemaVersion(db)
  const pending = migrations.filter(migration => migration.version > fromVersion)
  if (pending.length === 0) {
    return { fromVersion, toVersion: fromVersion, appliedVersions: [], backupPath: null }
  }

  let backupPath: string | null = null
  if (hasUserSchema(db) && fs.existsSync(options.dbPath)) {
    backupPath = migrationBackupPath(options.dbPath, options.now ?? new Date())
    try {
      const escapedBackupPath = backupPath.replace(/'/g, "''")
      db.exec(`VACUUM INTO '${escapedBackupPath}'`)
    } catch (vacuumError) {
      const checkpoint = db.pragma?.('wal_checkpoint(TRUNCATE)') as Array<{ busy?: number }> | undefined
      if (checkpoint?.some(row => Number(row.busy || 0) > 0)) {
        throw new Error(`Database backup failed because WAL checkpoint is busy: ${vacuumError instanceof Error ? vacuumError.message : String(vacuumError)}`)
      }
      fs.copyFileSync(options.dbPath, backupPath)
    }
    options.onBackup?.(backupPath)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      appliedAt INTEGER NOT NULL
    );
  `)

  const apply = () => {
    for (const migration of pending) {
      migration.up({ db })
      db.prepare('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now())
    }
  }

  try {
    if (db.transaction) {
      db.transaction(apply)()
    } else {
      db.exec('BEGIN IMMEDIATE')
      try {
        apply()
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Database migration failed; transaction was rolled back${backupPath ? ` (backup: ${backupPath})` : ''}: ${message}`)
  }

  return {
    fromVersion,
    toVersion: LATEST_SCHEMA_VERSION,
    appliedVersions: pending.map(migration => migration.version),
    backupPath,
  }
}
