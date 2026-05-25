from __future__ import annotations

import sqlite3
import time
from pathlib import Path


WORKSPACE = Path(__file__).resolve().parents[1]
DB_PATH = Path.home() / "AppData" / "Roaming" / "ai-tools-manager" / "devtracker.db"
ASSET_DIR = WORKSPACE / "src" / "assets" / "demo-screenshots"

NOW = int(time.time() * 1000)
DAY = 24 * 60 * 60 * 1000

STATUSES = [
    ("demo-status-design", "设计打磨", "#B8A6FF", 20),
    ("demo-status-developing", "开发中", "#74A9FF", 21),
    ("demo-status-demo", "可演示", "#63D693", 22),
    ("demo-status-paused", "暂停观察", "#F3BB6C", 23),
]

TAGS = [
    ("demo-tag-electron", "Electron", "#74A9FF"),
    ("demo-tag-motion", "动效", "#B8A6FF"),
    ("demo-tag-ai", "AI 工作流", "#63D693"),
    ("demo-tag-release", "发布", "#F3BB6C"),
]

PROJECTS = [
    {
        "id": "demo-project-vibetracker",
        "name": "VibeTracker",
        "description": "可视化跟进 vibecoding 项目进度，把每一次推进沉淀成 commit 式时间线。",
        "path": r"C:\Projects\VibeTracker",
        "repo_url": "https://github.com/zzf-857/VibeTracker",
        "status": "demo-status-design",
        "cover": "vibetracker-gallery.png",
        "created_ago": 36,
        "updated_ago": 0,
        "tags": ["demo-tag-electron", "demo-tag-motion"],
        "commits": [
            ("统一项目画廊与动效语言", "项目画廊开始以封面、状态、最近提交作为主视觉，补齐页面进场和卡片错峰动效。", 0, "vibetracker-gallery.png"),
            ("接入真实 commit 时间线", "详情页用 commit 记录替代百分比叙事，热力图按每日提交数量变深。", 1, "vibetracker-gallery.png"),
            ("完成自定义状态系统", "状态从固定三态升级为可排序、可改色、可保护删除的本地状态系统。", 4, "vibetracker-gallery.png"),
            ("打磨项目详情首屏结构", "首屏同时露出项目档案、封面、时间线和热力图，避免像普通后台管理页。", 8, "vibetracker-gallery.png"),
        ],
    },
    {
        "id": "demo-project-prompt-pocket",
        "name": "Prompt Pocket",
        "description": "轻量记录 vibecoding 过程中冒出来的好提示词和工程思路，不做重型 prompt 库。",
        "path": r"C:\Projects\PromptPocket",
        "repo_url": "https://github.com/zzf-857/PromptPocket",
        "status": "demo-status-developing",
        "cover": "prompt-pocket-notes.png",
        "created_ago": 24,
        "updated_ago": 1,
        "tags": ["demo-tag-ai"],
        "commits": [
            ("确定速记优先，不做重型库", "保留标题、标签、正文和是否入库，入口轻一点，避免偏离项目进展主线。", 1, "prompt-pocket-notes.png"),
            ("完成右侧笔记预览面板", "选中笔记后能直接看到结构化内容、标签和最近保存时间。", 3, "prompt-pocket-notes.png"),
            ("加入 prompt 分类筛选", "用少量柔和标签区分 UI、调试、架构、灵感等类型。", 7, "prompt-pocket-notes.png"),
        ],
    },
    {
        "id": "demo-project-release-desk",
        "name": "Release Desk",
        "description": "管理本地桌面工具从 demo 到可发布版本的检查清单和发布节奏。",
        "path": r"C:\Projects\ReleaseDesk",
        "repo_url": "https://github.com/zzf-857/ReleaseDesk",
        "status": "demo-status-demo",
        "cover": "release-desk-board.png",
        "created_ago": 18,
        "updated_ago": 2,
        "tags": ["demo-tag-electron", "demo-tag-release"],
        "commits": [
            ("打通构建检查流程", "发布前固定执行单测、构建、Electron 启动和关键页面冒烟检查。", 2, "release-desk-board.png"),
            ("整理发布看板信息架构", "把待处理、进行中、评审中、已完成和发布审查放进同一屏。", 5, "release-desk-board.png"),
            ("补齐版本发布备注", "记录目标日期、当前进度、变更统计和生成测试说明。", 9, "release-desk-board.png"),
        ],
    },
    {
        "id": "demo-project-motion-lab",
        "name": "Motion Lab",
        "description": "试验页面进出场、面板呼吸、状态变化和组件 hover 的微动效节奏。",
        "path": r"C:\Projects\MotionLab",
        "repo_url": "https://github.com/zzf-857/MotionLab",
        "status": "demo-status-design",
        "cover": "motion-lab-timeline.png",
        "created_ago": 14,
        "updated_ago": 3,
        "tags": ["demo-tag-motion"],
        "commits": [
            ("建立环境光背景节奏", "背景只做慢速漂移，保持冷静高级，不使用高饱和装饰光球。", 3, "motion-lab-timeline.png"),
            ("调整卡片 hover 幅度", "卡片只轻微抬起，边框和明度变化控制在 180ms 内。", 6, "motion-lab-timeline.png"),
            ("加入编辑面板侧向进入", "提交编辑面板从右侧滑入，保留来源感和空间连续性。", 10, "motion-lab-timeline.png"),
        ],
    },
]


def image_path(filename: str) -> str:
    return str(ASSET_DIR / filename)


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"找不到数据库：{DB_PATH}")

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        cur = conn.cursor()

        columns = {row[1] for row in cur.execute("PRAGMA table_info(projects)").fetchall()}
        if "repoUrl" not in columns:
            cur.execute('ALTER TABLE projects ADD COLUMN repoUrl TEXT DEFAULT ""')

        for project in PROJECTS:
            cur.execute("DELETE FROM projects WHERE id = ?", (project["id"],))

        for status_id, name, color, sort_index in STATUSES:
            cur.execute(
                """
                INSERT INTO project_statuses (id, name, color, sortIndex, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  color = excluded.color,
                  sortIndex = excluded.sortIndex,
                  updatedAt = excluded.updatedAt
                """,
                (status_id, name, color, sort_index, NOW, NOW),
            )

        for tag_id, name, color in TAGS:
            cur.execute(
                """
                INSERT INTO tags (id, name, color, createdAt)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  color = excluded.color
                """,
                (tag_id, name, color, NOW),
            )

        for project in PROJECTS:
            created_at = NOW - project["created_ago"] * DAY
            updated_at = NOW - project["updated_ago"] * DAY
            cur.execute(
                """
                INSERT INTO projects (id, name, description, path, repoUrl, status, progress, coverImagePath, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
                """,
                (
                    project["id"],
                    project["name"],
                    project["description"],
                    project["path"],
                    project["repo_url"],
                    project["status"],
                    image_path(project["cover"]),
                    created_at,
                    updated_at,
                ),
            )

            for tag_id in project["tags"]:
                cur.execute(
                    "INSERT OR IGNORE INTO project_tags (projectId, tagId) VALUES (?, ?)",
                    (project["id"], tag_id),
                )

            for index, (title, description, days_ago, image) in enumerate(project["commits"], start=1):
                commit_id = f"{project['id']}-commit-{index}"
                commit_at = NOW - days_ago * DAY - index * 70 * 60 * 1000
                cur.execute(
                    """
                    INSERT INTO project_commits (id, projectId, title, description, progressDelta, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (commit_id, project["id"], title, description, 8 if index == 1 else 0, commit_at, commit_at),
                )
                cur.execute(
                    """
                    INSERT INTO commit_images (id, commitId, imagePath, caption, sortIndex, createdAt)
                    VALUES (?, ?, ?, ?, 0, ?)
                    """,
                    (f"{commit_id}-image-1", commit_id, image_path(image), title, commit_at),
                )

        conn.commit()

    print(f"已导入 {len(PROJECTS)} 个演示项目到 {DB_PATH}")


if __name__ == "__main__":
    main()
