# VibeTracker Interaction Motion Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Progress Ritual Motion System so VibeTracker feels more alive around project progress, especially commit creation, while preserving the Calm Apple Dark UI style.

**Architecture:** Add a small motion layer made of CSS tokens, utility functions, and lightweight React components. Use CSS transitions/keyframes plus React state for one-shot rituals; avoid new animation dependencies in this first pass.

**Tech Stack:** Electron, React 18, React Router, TypeScript, Tailwind CSS, CSS keyframes, Node test runner.

---

## File Structure

- Modify: `src/index.css`
  - Add motion tokens, press/focus/update/ritual classes, reduced-motion coverage.
- Create: `src/lib/motion.ts`
  - Define typed motion phase names, stagger helpers, one-shot id helpers, and class-name helpers.
- Create: `tests/motion.test.ts`
  - Unit tests for motion utility behavior.
- Create: `src/components/AnimatedPage.tsx`
  - Shared page wrapper for page transition direction and stable stagger context.
- Create: `src/components/MotionButton.tsx`
  - Small reusable button wrapper for press/focus classes where pages have repeated custom buttons.
- Create: `src/components/PresenceList.tsx`
  - Lightweight wrapper for list item insertion/removal classes.
- Create: `src/components/RitualFeedback.tsx`
  - One-shot overlay/marker component for commit-created and cover-updated rituals.
- Modify: `src/components/Layout.tsx`
  - Add route motion context at the main content shell.
- Modify: `src/components/Sidebar.tsx`
  - Add active indicator glide, press feedback, and calmer hover states.
- Modify: `src/pages/Dashboard.tsx`
  - Add animated stats, active project update emphasis, recent commit stream insertion feedback, mini heatmap pulse.
- Modify: `src/pages/ProjectList.tsx`
  - Add gallery card update emphasis, composer expansion motion, card hover polish, filter reflow fade.
- Modify: `src/pages/ProjectDetail.tsx`
  - Add commit creation ritual, timeline dot ignition, heatmap changed-cell pulse, editor panel source motion, cover sweep.
- Modify: `src/pages/Settings.tsx`
  - Add status color morph and row update feedback.
- Modify: `src/pages/TagManagement.tsx`
  - Align tag interactions with the shared motion layer.
- Optional modify: `docs/superpowers/specs/2026-05-26-calm-apple-dark-ui-design-system.md`
  - Only update if implementation reveals reusable motion rules worth documenting.

## Task 1: Motion Tokens And Utilities

**Files:**
- Modify: `src/index.css`
- Create: `src/lib/motion.ts`
- Test: `tests/motion.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Add `tests/motion.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getStaggerStyle,
  getMotionPhaseClass,
  makeRitualKey,
  shouldAnimateCountChange,
} from '../src/lib/motion.ts'

test('getStaggerStyle exposes the CSS stagger custom property', () => {
  assert.deepEqual(getStaggerStyle(3), { '--stagger': 3 })
})

test('getMotionPhaseClass maps known ritual phases to stable class names', () => {
  assert.equal(getMotionPhaseClass('confirm'), 'ritual-confirm')
  assert.equal(getMotionPhaseClass('timeline'), 'ritual-timeline')
  assert.equal(getMotionPhaseClass('sync'), 'ritual-sync')
  assert.equal(getMotionPhaseClass('settle'), 'ritual-settle')
})

test('makeRitualKey changes when an entity receives a new event timestamp', () => {
  assert.equal(makeRitualKey('commit-1', 1779800000000), 'commit-1:1779800000000')
})

test('shouldAnimateCountChange only animates real count changes', () => {
  assert.equal(shouldAnimateCountChange(3, 4), true)
  assert.equal(shouldAnimateCountChange(4, 4), false)
  assert.equal(shouldAnimateCountChange(undefined, 1), false)
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm run test:unit`

Expected: FAIL because `src/lib/motion.ts` does not exist.

- [ ] **Step 3: Create the motion utility module**

Add `src/lib/motion.ts`:

```ts
import type { CSSProperties } from 'react'

export type MotionPhase = 'confirm' | 'timeline' | 'sync' | 'settle'

export function getStaggerStyle(index: number): CSSProperties {
  return { '--stagger': index } as CSSProperties
}

export function getMotionPhaseClass(phase: MotionPhase) {
  return `ritual-${phase}`
}

export function makeRitualKey(entityId: string, timestamp: number) {
  return `${entityId}:${timestamp}`
}

export function shouldAnimateCountChange(previous: number | undefined, next: number) {
  return typeof previous === 'number' && previous !== next
}
```

- [ ] **Step 4: Add global motion tokens and base classes**

In `src/index.css`, extend `:root` with:

```css
  --motion-instant: 80ms;
  --motion-fast: 120ms;
  --motion-base: 180ms;
  --motion-panel: 280ms;
  --motion-page: 340ms;
  --motion-ritual: 980ms;

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasized: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-press: cubic-bezier(0.3, 0, 0.2, 1);

  --lift-card: -4px;
  --press-scale: 0.98;
```

Then update `.soft-motion`, `.page-enter`, `.motion-card`, `.stagger-item`, and focused input styles to use the tokens:

```css
.soft-motion {
  transition-duration: var(--motion-base);
  transition-timing-function: var(--ease-standard);
}

.page-enter {
  animation: pageEnter var(--motion-page) var(--ease-emphasized) both;
}

.motion-card {
  transition:
    transform var(--motion-base) var(--ease-standard),
    border-color var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard),
    box-shadow var(--motion-base) var(--ease-standard),
    opacity var(--motion-base) var(--ease-standard),
    filter var(--motion-base) var(--ease-standard);
  will-change: transform;
}

.motion-card:hover {
  transform: translateY(var(--lift-card));
  box-shadow: 0 34px 90px rgba(0, 0, 0, 0.34);
}

.motion-press {
  transition:
    transform var(--motion-fast) var(--ease-press),
    opacity var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard);
}

.motion-press:active {
  transform: scale(var(--press-scale));
}

.motion-focus {
  transition:
    border-color var(--motion-base) var(--ease-standard),
    box-shadow var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard);
}

.motion-focus:focus {
  border-color: rgba(247, 248, 251, 0.28);
  box-shadow:
    0 0 0 1px rgba(116, 169, 255, 0.12),
    inset 0 0 28px rgba(116, 169, 255, 0.055);
}

.stagger-item {
  animation: itemRise 320ms var(--ease-emphasized) both;
  animation-delay: calc(var(--stagger, 0) * 55ms);
}
```

- [ ] **Step 5: Add ritual keyframes and reduced-motion overrides**

Append these classes and keyframes to `src/index.css`:

```css
.ritual-confirm {
  animation: ritualConfirm 160ms var(--ease-press) both;
}

.ritual-timeline {
  animation: ritualTimeline 420ms var(--ease-emphasized) both;
}

.ritual-sync {
  animation: ritualSync 300ms var(--ease-emphasized) both;
}

.ritual-settle {
  animation: ritualSettle 360ms var(--ease-standard) both;
}

.motion-update {
  animation: updateGlow 760ms var(--ease-standard) both;
}

.heatmap-pulse {
  animation: heatmapPulse 720ms var(--ease-emphasized) both;
}

.cover-sheen::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(105deg, transparent 20%, rgba(255, 255, 255, 0.18) 48%, transparent 74%);
  transform: translateX(-120%);
  animation: coverSheen 880ms var(--ease-emphasized) both;
}

@keyframes ritualConfirm {
  from { transform: scale(0.985); filter: brightness(0.96); }
  to { transform: scale(1); filter: brightness(1); }
}

@keyframes ritualTimeline {
  0% { opacity: 0; transform: translateY(12px) scale(0.985); }
  62% { opacity: 1; transform: translateY(-2px) scale(1.006); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes ritualSync {
  0% { filter: brightness(1); }
  45% { filter: brightness(1.2); }
  100% { filter: brightness(1); }
}

@keyframes ritualSettle {
  from { opacity: 0.92; }
  to { opacity: 1; }
}

@keyframes updateGlow {
  0% { box-shadow: 0 0 0 rgba(99, 214, 147, 0); border-color: var(--border-subtle); }
  38% { box-shadow: 0 0 0 8px rgba(99, 214, 147, 0.08); border-color: rgba(99, 214, 147, 0.32); }
  100% { box-shadow: 0 0 0 rgba(99, 214, 147, 0); border-color: var(--border-subtle); }
}

@keyframes heatmapPulse {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(99, 214, 147, 0); }
  42% { transform: scale(1.16); box-shadow: 0 0 0 8px rgba(99, 214, 147, 0.12); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(99, 214, 147, 0); }
}

@keyframes coverSheen {
  from { transform: translateX(-120%); opacity: 0; }
  35% { opacity: 0.55; }
  to { transform: translateX(120%); opacity: 0; }
}
```

Inside the existing `@media (prefers-reduced-motion: reduce)` block, add:

```css
  .ritual-confirm,
  .ritual-timeline,
  .ritual-sync,
  .ritual-settle,
  .motion-update,
  .heatmap-pulse,
  .cover-sheen::after {
    animation: none !important;
  }
```

- [ ] **Step 6: Run tests and build**

Run: `npm run test:unit`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/lib/motion.ts tests/motion.test.ts
git commit -m "建立进展仪式动效令牌"
```

## Task 2: Shared Motion Components

**Files:**
- Create: `src/components/AnimatedPage.tsx`
- Create: `src/components/MotionButton.tsx`
- Create: `src/components/PresenceList.tsx`
- Create: `src/components/RitualFeedback.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Create `AnimatedPage`**

Add `src/components/AnimatedPage.tsx`:

```tsx
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils'

type AnimatedPageProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  tone?: 'standard' | 'gallery' | 'detail' | 'system'
}

export function AnimatedPage({ children, className, tone = 'standard', ...props }: AnimatedPageProps) {
  return (
    <div className={cn('page-enter motion-page-shell', `motion-page-${tone}`, className)} {...props}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Create `MotionButton`**

Add `src/components/MotionButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils'

type MotionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  active?: boolean
}

export function MotionButton({ children, className, active = false, ...props }: MotionButtonProps) {
  return (
    <button
      className={cn('motion-press motion-focus', active && 'motion-update', className)}
      {...props}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 3: Create `PresenceList`**

Add `src/components/PresenceList.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react'
import { getStaggerStyle } from '../lib/motion'
import { cn } from '../lib/utils'

type PresenceListProps<T> = {
  items: T[]
  getKey: (item: T) => string
  className?: string
  itemClassName?: string
  renderItem: (item: T, index: number) => ReactNode
}

export function PresenceList<T>({ items, getKey, className, itemClassName, renderItem }: PresenceListProps<T>) {
  return (
    <div className={className}>
      {items.map((item, index) => (
        <div key={getKey(item)} className={cn('presence-item', itemClassName)} style={getStaggerStyle(index) as CSSProperties}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Create `RitualFeedback`**

Add `src/components/RitualFeedback.tsx`:

```tsx
import { cn } from '../lib/utils'

type RitualFeedbackProps = {
  active: boolean
  tone?: 'commit' | 'cover' | 'status'
  className?: string
}

export function RitualFeedback({ active, tone = 'commit', className }: RitualFeedbackProps) {
  if (!active) return null
  return <span aria-hidden="true" className={cn('ritual-feedback', `ritual-feedback-${tone}`, className)} />
}
```

- [ ] **Step 5: Add component support CSS**

Append to `src/index.css`:

```css
.motion-page-shell {
  transform-origin: 50% 42%;
}

.motion-page-gallery {
  animation-name: pageEnterGallery;
}

.motion-page-detail {
  animation-name: pageEnterDetail;
}

.motion-page-system {
  animation-name: pageEnterSystem;
}

.presence-item {
  animation: itemRise 320ms var(--ease-emphasized) both;
  animation-delay: calc(var(--stagger, 0) * 45ms);
}

.ritual-feedback {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  pointer-events: none;
  background: var(--status-completed);
  box-shadow: 0 0 0 0 rgba(99, 214, 147, 0.18);
  animation: ritualPing 760ms var(--ease-emphasized) both;
}

.ritual-feedback-cover {
  background: var(--accent-blue);
}

.ritual-feedback-status {
  background: var(--accent-orange);
}

@keyframes pageEnterGallery {
  from { opacity: 0; transform: translateY(12px) scale(0.992); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes pageEnterDetail {
  from { opacity: 0; transform: translateY(10px) scale(0.988); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes pageEnterSystem {
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes ritualPing {
  0% { opacity: 0; transform: scale(0.76); box-shadow: 0 0 0 0 rgba(99, 214, 147, 0); }
  35% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 10px rgba(99, 214, 147, 0.14); }
  100% { opacity: 0; transform: scale(1.02); box-shadow: 0 0 0 18px rgba(99, 214, 147, 0); }
}
```

- [ ] **Step 6: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/AnimatedPage.tsx src/components/MotionButton.tsx src/components/PresenceList.tsx src/components/RitualFeedback.tsx src/index.css
git commit -m "抽取共享交互动效组件"
```

## Task 3: Navigation And Page Transitions

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/ProjectList.tsx`
- Modify: `src/pages/ProjectDetail.tsx`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/pages/TagManagement.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Wrap pages with `AnimatedPage`**

In each page, import `AnimatedPage`:

```tsx
import { AnimatedPage } from '../components/AnimatedPage'
```

Replace the top-level page containers:

```tsx
<AnimatedPage tone="gallery" className="flex flex-col min-h-full w-full py-8 px-10 gap-8">
```

Use these tones:

- `Dashboard.tsx`: `tone="standard"`
- `ProjectList.tsx`: `tone="gallery"`
- `ProjectDetail.tsx`: `tone="detail"`
- `Settings.tsx`: `tone="system"`
- `TagManagement.tsx`: `tone="system"`

Remove duplicated `page-enter` from those top-level `className` strings.

- [ ] **Step 2: Add a stable route shell**

Update `src/components/Layout.tsx`:

```tsx
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function Layout() {
  const location = useLocation()

  return (
    <div className="flex h-screen w-full overflow-hidden text-text-primary">
      <Sidebar />
      <main className="flex-1 h-full overflow-hidden flex flex-col relative z-[1]">
        <div className="flex-1 overflow-x-hidden overflow-y-auto w-full motion-route-shell" data-route={location.pathname}>
          <div className="min-h-full w-full max-w-[1440px] mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Add sidebar glide indicator**

Update `src/components/Sidebar.tsx` to use `useLocation` and an active index:

```tsx
import { NavLink, useLocation } from 'react-router-dom'
```

Inside `Sidebar`:

```tsx
const location = useLocation()
const activeIndex = Math.max(0, navItems.findIndex(item => item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)))
```

Inside `<nav className="flex flex-col gap-3 items-center">`, add before the map:

```tsx
<span
  aria-hidden="true"
  className="sidebar-active-indicator"
  style={{ transform: `translateY(${activeIndex * 60}px)` }}
/>
```

Update each `NavLink` class to include `motion-press relative z-10`.

- [ ] **Step 4: Add route and sidebar CSS**

Append to `src/index.css`:

```css
.motion-route-shell {
  perspective: 1200px;
}

.sidebar-active-indicator {
  position: absolute;
  top: 105px;
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.105);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.18);
  transition: transform var(--motion-panel) var(--ease-emphasized);
}
```

Ensure the `<nav>` has `relative`:

```tsx
<nav className="relative flex flex-col gap-3 items-center">
```

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.tsx src/components/Sidebar.tsx src/pages/Dashboard.tsx src/pages/ProjectList.tsx src/pages/ProjectDetail.tsx src/pages/Settings.tsx src/pages/TagManagement.tsx src/index.css
git commit -m "升级页面切换与导航动效"
```

## Task 4: Project Gallery Motion

**Files:**
- Modify: `src/pages/ProjectList.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add filtered reflow feedback**

In `ProjectList.tsx`, import `getStaggerStyle`:

```tsx
import { getStaggerStyle } from '../lib/motion'
```

Replace inline stagger style on gallery cards with:

```tsx
style={getStaggerStyle(index + 2)}
```

Add a key to the grid that changes with filters:

```tsx
<div key={`${activeTag ?? 'all'}:${searchQuery}`} className="gallery-grid grid grid-cols-3 gap-6 pb-10">
```

- [ ] **Step 2: Polish project card hover and update emphasis**

In `ProjectGalleryCard`, update the button class:

```tsx
className="group text-left glass-panel ambient-panel motion-card gallery-card stagger-item rounded-[30px] overflow-hidden min-h-[360px] flex flex-col"
```

Wrap recent commit title in a motion target:

```tsx
<p className="gallery-card-recent text-sm text-text-primary font-medium truncate">{recentCommit?.title || '还没有进展提交'}</p>
```

For cover images, update `SafeImage` class:

```tsx
className="h-full w-full object-cover gallery-cover"
```

- [ ] **Step 3: Improve composer expansion**

Change composer section class:

```tsx
className="glass-panel ambient-panel composer-panel rounded-[30px] p-4"
```

Add `motion-focus` to all composer inputs/selects and `motion-press` to composer buttons.

- [ ] **Step 4: Add gallery CSS**

Append to `src/index.css`:

```css
.gallery-grid {
  animation: galleryReflow 240ms var(--ease-standard) both;
}

.gallery-card {
  transition:
    transform var(--motion-panel) var(--ease-emphasized),
    border-color var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard),
    box-shadow var(--motion-panel) var(--ease-emphasized);
}

.gallery-card:hover {
  transform: translateY(-6px) scale(1.006);
}

.gallery-cover {
  transition: transform 700ms var(--ease-emphasized), filter 280ms var(--ease-standard);
}

.gallery-card:hover .gallery-cover {
  transform: scale(1.045);
  filter: brightness(1.05);
}

.gallery-card-recent {
  transition: color var(--motion-base) var(--ease-standard), transform var(--motion-base) var(--ease-standard);
}

.gallery-card:hover .gallery-card-recent {
  color: var(--text-primary);
  transform: translateY(-1px);
}

.composer-panel {
  animation: composerExpand var(--motion-panel) var(--ease-emphasized) both;
  transform-origin: 88% 0%;
}

@keyframes galleryReflow {
  from { opacity: 0.82; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes composerExpand {
  from { opacity: 0; transform: translateY(-10px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
```

- [ ] **Step 5: Run build and inspect**

Run: `npm run build`

Expected: PASS.

Run: `npm run dev -- --host 127.0.0.1`

Expected: Electron opens. Inspect project gallery hover, composer open/close, search/filter reflow.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProjectList.tsx src/index.css
git commit -m "打磨项目画廊交互动效"
```

## Task 5: Commit Ritual In Project Detail

**Files:**
- Modify: `src/pages/ProjectDetail.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add ritual state**

In `ProjectDetail.tsx`, add state near the existing form state:

```tsx
const [ritualCommitId, setRitualCommitId] = useState<string | null>(null)
const [ritualStartedAt, setRitualStartedAt] = useState<number>(0)
const [coverRitualKey, setCoverRitualKey] = useState('')
```

- [ ] **Step 2: Trigger ritual after successful commit creation**

Change `createCommit`:

```tsx
const createCommit = async () => {
  if (!project || !commitTitle.trim()) return
  if (isMockProjectId(project.id)) return
  const createdId = await window.ipcRenderer.invoke('create-commit', {
    projectId: project.id,
    title: commitTitle.trim(),
    description: commitDescription.trim(),
    progressDelta: Number(progressDelta) || 0,
    imagePath: commitImagePath.trim(),
  })
  setRitualCommitId(createdId)
  setRitualStartedAt(Date.now())
  if (commitImagePath.trim()) setCoverRitualKey(`${createdId}:${Date.now()}`)
  setCommitTitle('')
  setCommitDescription('')
  setProgressDelta('')
  setCommitImagePath('')
  await loadData()
  window.setTimeout(() => setRitualCommitId(null), 1200)
}
```

- [ ] **Step 3: Mark the composer confirmation**

Add ritual classes to the commit composer wrapper:

```tsx
<div className={`bg-bg-secondary border border-border-subtle rounded-[26px] p-4 mb-6 commit-composer ${ritualCommitId ? 'ritual-confirm' : ''}`}>
```

Add `motion-focus` to inputs/textarea and `motion-press` to buttons in the commit composer.

- [ ] **Step 4: Mark the new timeline card**

Pass ritual props to `CommitCard`:

```tsx
<CommitCard
  key={commit.id}
  commit={commit}
  index={index}
  isNew={commit.id === ritualCommitId}
  ...
/>
```

Update `CommitCard` props:

```tsx
function CommitCard({
  commit,
  index,
  isNew = false,
  onEdit,
  onDelete,
  onSetCover,
}: {
  commit: ProjectCommit
  index: number
  isNew?: boolean
  onEdit: () => void
  onDelete: () => void
  onSetCover: (path: string) => void
}) {
```

Update article class:

```tsx
className={`motion-card stagger-item commit-card relative bg-bg-secondary border border-border-subtle rounded-[24px] p-5 transition-all duration-[220ms] hover:bg-bg-tertiary before:absolute before:-left-[31px] before:top-6 before:w-4 before:h-4 before:rounded-full before:bg-status-completed before:border-[4px] before:border-[#111318] ${isNew ? 'commit-card-new ritual-timeline' : ''}`}
```

- [ ] **Step 5: Pulse changed heatmap cell**

Pass `ritualStartedAt`:

```tsx
<CommitHeatmap commits={commits} pulseTimestamp={ritualStartedAt} />
```

Update signature:

```tsx
function CommitHeatmap({ commits, pulseTimestamp }: { commits: ProjectCommit[]; pulseTimestamp?: number }) {
```

Inside the day map:

```tsx
const pulseKey = pulseTimestamp ? formatDateKey(pulseTimestamp) : ''
```

Apply class:

```tsx
return <span key={day.key} title={`${day.key}: ${day.count} 次提交`} className={`aspect-square rounded-[5px] ${className} ${day.key === pulseKey ? 'heatmap-pulse' : ''}`} />
```

- [ ] **Step 6: Add cover sweep when a commit image affects cover**

Update cover wrapper:

```tsx
<div key={coverRitualKey || cover} className={`relative h-full min-h-[260px] group ${coverRitualKey ? 'cover-sheen' : ''}`}>
```

In `setCoverFromPath`, after successful update:

```tsx
setCoverRitualKey(`${imagePath}:${Date.now()}`)
window.setTimeout(() => setCoverRitualKey(''), 1000)
```

- [ ] **Step 7: Add detail ritual CSS**

Append to `src/index.css`:

```css
.commit-composer {
  transition:
    border-color var(--motion-base) var(--ease-standard),
    box-shadow var(--motion-base) var(--ease-standard),
    transform var(--motion-fast) var(--ease-press);
}

.commit-card {
  transform-origin: 24px 24px;
}

.commit-card-new {
  border-color: rgba(99, 214, 147, 0.32);
}

.commit-card-new::after {
  content: "";
  position: absolute;
  left: -36px;
  top: 20px;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid rgba(99, 214, 147, 0.28);
  animation: ritualPing 760ms var(--ease-emphasized) both;
}
```

- [ ] **Step 8: Run build and inspect**

Run: `npm run build`

Expected: PASS.

Run: `npm run dev -- --host 127.0.0.1`

Expected: Electron opens. Create a real commit in a non-mock project. Confirm composer responds, timeline node lights, heatmap cell pulses, cover sweeps only when image affects cover.

- [ ] **Step 9: Commit**

```bash
git add src/pages/ProjectDetail.tsx src/index.css
git commit -m "实现提交创建仪式动效"
```

## Task 6: Dashboard And Data Sync Motion

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add count-up component**

Inside `Dashboard.tsx`, add this helper component before `StatCard`:

```tsx
function CountUpValue({ value }: { value: string }) {
  const numeric = Number(value)
  const [display, setDisplay] = useState(Number.isFinite(numeric) ? numeric : 0)

  useEffect(() => {
    if (!Number.isFinite(numeric)) return
    const start = display
    const delta = numeric - start
    if (delta === 0) return
    const startedAt = Date.now()
    const duration = 420
    const frame = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + delta * eased))
      if (progress < 1) window.requestAnimationFrame(frame)
    }
    window.requestAnimationFrame(frame)
  }, [numeric])

  return <>{Number.isFinite(numeric) ? display : value}</>
}
```

Update `StatCard` value:

```tsx
<div className="text-[32px] font-semibold font-mono"><CountUpValue value={value} /></div>
```

- [ ] **Step 2: Add recent stream presence classes**

Update recent commit stream button class:

```tsx
className="recent-stream-item block w-full text-left border-l border-border-primary pl-4 transition-all duration-[180ms] hover:border-accent-blue hover:translate-x-0.5"
```

Add stagger style:

```tsx
style={{ '--stagger': index } as CSSProperties}
```

Change map to include index:

```tsx
{commits.map(({ project, commit }, index) => (
```

- [ ] **Step 3: Add project card motion alignment**

Update active project button class:

```tsx
className="dashboard-project-card motion-card group text-left bg-bg-secondary border border-border-subtle rounded-[24px] overflow-hidden min-h-[210px]"
```

Update cover image class:

```tsx
className="w-full h-full object-cover gallery-cover"
```

- [ ] **Step 4: Add dashboard CSS**

Append to `src/index.css`:

```css
.dashboard-project-card {
  transition:
    transform var(--motion-panel) var(--ease-emphasized),
    background-color var(--motion-base) var(--ease-standard),
    border-color var(--motion-base) var(--ease-standard),
    box-shadow var(--motion-panel) var(--ease-emphasized);
}

.dashboard-project-card:hover {
  transform: translateY(-4px) scale(1.004);
  background: var(--bg-tertiary);
}

.recent-stream-item {
  animation: itemRise 280ms var(--ease-emphasized) both;
  animation-delay: calc(var(--stagger, 0) * 42ms);
}
```

- [ ] **Step 5: Run build and inspect**

Run: `npm run build`

Expected: PASS.

Run: `npm run dev -- --host 127.0.0.1`

Expected: Dashboard stats count smoothly and recent stream/card hover feel consistent.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Dashboard.tsx src/index.css
git commit -m "增强总览数据同步动效"
```

## Task 7: Editor, Settings, And Final Polish

**Files:**
- Modify: `src/pages/ProjectDetail.tsx`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/pages/TagManagement.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Upgrade commit editor panel motion**

In `CommitEditor`, change overlay class:

```tsx
className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end editor-backdrop"
```

Change aside class:

```tsx
className="editor-panel w-[500px] h-full bg-[#111318] border-l border-border-primary p-6 shadow-2xl overflow-y-auto custom-scrollbar"
```

Add `motion-focus` to inputs/textarea and `motion-press` to editor buttons.

- [ ] **Step 2: Add settings row update classes**

In `Settings.tsx`, add `status-row` to each status row container:

```tsx
className="status-row motion-card bg-bg-secondary border border-border-subtle rounded-[24px] p-4 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 items-center"
```

Add `motion-focus` to status inputs and color controls. Add `motion-press` to create/update/delete/reorder buttons.

- [ ] **Step 3: Add tag management motion alignment**

In `TagManagement.tsx`, add `motion-focus` to tag inputs and `motion-press` to action buttons.

Update tag cards to include:

```tsx
className="tag-card motion-card stagger-item bg-bg-secondary rounded-[24px] border border-border-primary p-6 flex flex-col gap-5 relative group overflow-hidden"
```

- [ ] **Step 4: Add editor/settings CSS**

Append to `src/index.css`:

```css
.editor-backdrop {
  animation: backdropIn var(--motion-panel) var(--ease-standard) both;
}

.editor-panel {
  animation: panelSlideIn var(--motion-panel) var(--ease-emphasized) both;
}

.status-row,
.tag-card {
  transition:
    transform var(--motion-base) var(--ease-standard),
    border-color var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard),
    box-shadow var(--motion-base) var(--ease-standard);
}

.status-row:hover,
.tag-card:hover {
  transform: translateY(-2px);
  background: var(--bg-tertiary);
}

@keyframes backdropIn {
  from { opacity: 0; backdrop-filter: blur(0); }
  to { opacity: 1; backdrop-filter: blur(8px); }
}
```

- [ ] **Step 5: Run full verification**

Run: `npm run test:unit`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Run: `npm run dev -- --host 127.0.0.1`

Expected: Electron opens. Manually verify:

- Page transitions have spatial continuity.
- Sidebar active indicator glides.
- Project gallery hover and composer expansion feel polished.
- New commit plays the 1-second ritual and then settles.
- Heatmap pulse only happens on changed cell.
- Editor panel opens from the side and backdrop is calm.
- Reduced motion mode disables movement-heavy effects.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProjectDetail.tsx src/pages/Settings.tsx src/pages/TagManagement.tsx src/index.css
git commit -m "完善编辑面板与设置微交互"
```

## Parallelization Notes

After Task 1 and Task 2 are complete, these can be developed in parallel because they mostly touch separate pages:

- Task 4: Project gallery motion.
- Task 6: Dashboard data sync motion.
- Task 7 Step 2-4: Settings and tag management microinteractions.

Task 5 should be handled by one focused worker because it touches the most important stateful interaction: commit creation, heatmap pulse, and cover sweep.

## Final Verification

- [ ] Run `npm run test:unit`.
- [ ] Run `npm run build`.
- [ ] Run `npm run dev -- --host 127.0.0.1`.
- [ ] Verify Electron opens without white screen.
- [ ] Create a real project if needed.
- [ ] Create a commit without image and confirm timeline + heatmap ritual.
- [ ] Create a commit with image and confirm cover sweep when the image becomes cover candidate.
- [ ] Edit and delete a commit and confirm no full creation ritual plays.
- [ ] Search/filter project gallery and confirm card reflow fade.
- [ ] Navigate dashboard, gallery, detail, settings, tags and confirm the app stays calm.
- [ ] Temporarily enable reduced motion in the OS or DevTools emulation and confirm movement-heavy effects are suppressed.

## Commit Sequence

1. `建立进展仪式动效令牌`
2. `抽取共享交互动效组件`
3. `升级页面切换与导航动效`
4. `打磨项目画廊交互动效`
5. `实现提交创建仪式动效`
6. `增强总览数据同步动效`
7. `完善编辑面板与设置微交互`

## Self-Review

- Spec coverage: The plan covers motion tokens, source-aware page transitions, commit ritual, heatmap pulse, gallery update emphasis, dashboard sync motion, editor panel source motion, settings/tag microinteractions, and reduced-motion requirements.
- Placeholder scan: No unfinished placeholder markers remain.
- Type consistency: New helpers use `MotionPhase`, `CSSProperties`, and existing `ProjectCommit` fields. Page changes reuse existing IPC and data structures without schema changes.
- Scope check: The plan stays within interaction and motion upgrade work. It does not change the data model, Prompt module, or core information architecture.
