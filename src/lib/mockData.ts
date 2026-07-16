import type { DevelopmentRecord, Project, ProjectStatus, Tag } from '../types'

const now = Date.now()
const day = 24 * 60 * 60 * 1000

export const MOCK_MODE_LABEL = '展示数据'

export const mockStatuses: ProjectStatus[] = [
  { id: 'mock-status-prototype', name: '原型中', color: '#74A9FF', sortIndex: 0, createdAt: now, updatedAt: now, projectCount: 2 },
  { id: 'mock-status-polish', name: '打磨中', color: '#B8A6FF', sortIndex: 1, createdAt: now, updatedAt: now, projectCount: 2 },
  { id: 'mock-status-demo', name: '可演示', color: '#63D693', sortIndex: 2, createdAt: now, updatedAt: now, projectCount: 1 },
  { id: 'mock-status-paused', name: '暂停', color: '#F3BB6C', sortIndex: 3, createdAt: now, updatedAt: now, projectCount: 1 },
]

export const mockTags: Tag[] = [
  { id: 'mock-tag-electron', name: 'Electron', color: '#74A9FF', createdAt: now },
  { id: 'mock-tag-design', name: '动效', color: '#B8A6FF', createdAt: now },
  { id: 'mock-tag-ai', name: 'AI 工作流', color: '#63D693', createdAt: now },
]

function mockImage(title: string, accent: string, secondary = '#151A21') {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="${secondary}" offset="0"/>
          <stop stop-color="#080A0D" offset="1"/>
        </linearGradient>
        <radialGradient id="glow" cx="35%" cy="20%" r="70%">
          <stop stop-color="${accent}" stop-opacity=".36" offset="0"/>
          <stop stop-color="${accent}" stop-opacity="0" offset="1"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="720" rx="44" fill="url(#bg)"/>
      <rect width="1200" height="720" fill="url(#glow)"/>
      <rect x="88" y="92" width="1024" height="86" rx="28" fill="rgba(255,255,255,.10)" stroke="rgba(255,255,255,.16)"/>
      <rect x="88" y="218" width="468" height="334" rx="34" fill="rgba(255,255,255,.075)" stroke="rgba(255,255,255,.13)"/>
      <rect x="592" y="218" width="520" height="146" rx="32" fill="rgba(255,255,255,.09)" stroke="rgba(255,255,255,.13)"/>
      <rect x="592" y="396" width="326" height="156" rx="30" fill="rgba(255,255,255,.065)" stroke="rgba(255,255,255,.10)"/>
      <circle cx="996" cy="476" r="52" fill="${accent}" opacity=".82"/>
      <text x="120" y="146" fill="#F7F8FB" font-size="34" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-weight="700">${title}</text>
      <text x="120" y="610" fill="#A8B0BD" font-size="22" font-family="Segoe UI, Microsoft YaHei, sans-serif">VibeTracker mock preview</text>
    </svg>
  `
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function commit(projectId: string, index: number, daysAgo: number, title: string, description: string, imagePath = ''): DevelopmentRecord {
  const createdAt = now - daysAgo * day - index * 90 * 60 * 1000
  return {
    id: `${projectId}-commit-${index}`,
    projectId,
    title,
    description,
    createdAt,
    updatedAt: createdAt,
    images: imagePath ? [{
      id: `${projectId}-image-${index}`,
      commitId: `${projectId}-commit-${index}`,
      imagePath,
      caption: title,
      sortIndex: 0,
      createdAt,
    }] : [],
  }
}

const covers = {
  center: mockImage('项目总览与画廊', '#74A9FF'),
  motion: mockImage('动效系统调校', '#B8A6FF'),
  prompt: mockImage('轻量提示词速记', '#63D693'),
  launch: mockImage('桌面发布面板', '#F3BB6C'),
}

export const mockProjects: Project[] = [
  {
    id: 'mock-vibetracker',
    name: 'VibeTracker',
    description: '可视化跟进 vibecoding 项目进度，把每一次推进沉淀成 commit 式时间线。',
    path: 'C:\\Projects\\VibeTracker',
    repoUrl: 'https://github.com/zzf-857/VibeTracker',
    status: 'mock-status-polish',
    statusInfo: mockStatuses[1],
    coverImagePath: '',
    resolvedCoverImagePath: covers.center,
    createdAt: now - 34 * day,
    updatedAt: now - 2 * 60 * 60 * 1000,
    tags: [mockTags[0], mockTags[1]],
    commits: [
      commit('mock-vibetracker', 1, 0, '统一项目画廊动效语言', '补齐页面进场、卡片错峰和背景环境光，让项目中心更像长期打开的创作空间。', covers.motion),
      commit('mock-vibetracker', 2, 1, '完成 commit 时间线首版', '详情页开始以提交记录作为核心叙事，热力图同步跟进每日活跃度。', covers.center),
      commit('mock-vibetracker', 3, 4, '梳理自定义状态系统', '状态从固定枚举改为用户可管理，为不同项目阶段留下弹性。'),
    ],
    commitCount: 3,
  },
  {
    id: 'mock-prompt-pocket',
    name: 'Prompt Pocket',
    description: '轻量记录 vibecoding 过程中突然冒出来的好提示词和工程思路。',
    path: 'C:\\Projects\\PromptPocket',
    repoUrl: 'https://github.com/zzf-857/PromptPocket',
    status: 'mock-status-prototype',
    statusInfo: mockStatuses[0],
    coverImagePath: '',
    resolvedCoverImagePath: covers.prompt,
    createdAt: now - 20 * day,
    updatedAt: now - 1 * day,
    tags: [mockTags[2]],
    commits: [
      commit('mock-prompt-pocket', 1, 1, '确定速记优先，不做重型库', '入口保持轻，不让 prompt 模块抢走项目进展主线。', covers.prompt),
      commit('mock-prompt-pocket', 2, 3, '加入标签和标题字段', '每条速记只保留标题、标签和是否入库，后续再考虑结构化整理。'),
    ],
    commitCount: 2,
  },
  {
    id: 'mock-release-desk',
    name: 'Release Desk',
    description: '管理本地桌面工具从 demo 到可发布版本的检查清单。',
    path: 'C:\\Projects\\ReleaseDesk',
    repoUrl: 'https://github.com/zzf-857/ReleaseDesk',
    status: 'mock-status-demo',
    statusInfo: mockStatuses[2],
    coverImagePath: '',
    resolvedCoverImagePath: covers.launch,
    createdAt: now - 16 * day,
    updatedAt: now - 2 * day,
    tags: [mockTags[0]],
    commits: [
      commit('mock-release-desk', 1, 2, '打通构建检查流程', '把构建、单测和冒烟检查整理成固定发布前动作。', covers.launch),
      commit('mock-release-desk', 2, 7, '整理发布面板信息架构', '把版本号、目标平台和发布备注放在同一个安静面板里。'),
    ],
    commitCount: 2,
  },
  {
    id: 'mock-motion-lab',
    name: 'Motion Lab',
    description: '专门试验页面进出场、面板呼吸和状态变化的微动效。',
    path: 'C:\\Projects\\MotionLab',
    repoUrl: 'https://github.com/zzf-857/MotionLab',
    status: 'mock-status-polish',
    statusInfo: mockStatuses[1],
    coverImagePath: '',
    resolvedCoverImagePath: covers.motion,
    createdAt: now - 11 * day,
    updatedAt: now - 3 * day,
    tags: [mockTags[1]],
    commits: [
      commit('mock-motion-lab', 1, 3, '建立环境光背景节奏', '背景只做慢速漂移，避免高饱和光斑破坏冷静感。', covers.motion),
      commit('mock-motion-lab', 2, 5, '调整卡片 hover 幅度', '卡片只抬起一点点，保持 Apple 式克制。'),
    ],
    commitCount: 2,
  },
]

export const mockCommits = mockProjects.flatMap(project => project.commits || [])

export function isMockProjectId(id: string | undefined) {
  return Boolean(id?.startsWith('mock-'))
}

export function getMockProject(id: string | undefined) {
  return mockProjects.find(project => project.id === id) || null
}
