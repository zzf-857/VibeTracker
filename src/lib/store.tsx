import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { Project, ProjectStatus, Tag } from '../types'

interface StoreContextProps {
  projects: Project[]
  statuses: ProjectStatus[]
  tags: Tag[]
  isLoaded: boolean
  loadError: string | null
  refresh: () => Promise<void>
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>
  setStatuses: React.Dispatch<React.SetStateAction<ProjectStatus[]>>
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>
}

const StoreContext = createContext<StoreContextProps | undefined>(undefined)

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoadError(null)
      const [p, s, t] = await Promise.all([
        window.vibe.projects.list(),
        window.vibe.taxonomy.listStatuses(),
        window.vibe.taxonomy.listTags(),
      ])
      setProjects(p)
      setStatuses(s)
      setTags(t)
      setIsLoaded(true)
    } catch (err) {
      console.error('Store failed to sync data from IPC:', err)
      setLoadError(err instanceof Error ? err.message : String(err))
      setIsLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh() }
    const unsubscribeGit = window.vibe.git.onState(state => {
      if (state.status === 'syncing') {
        setProjects(current => current.map(project => project.id === state.projectId
          ? {
              ...project,
              gitSync: {
                ...(project.gitSync || { branch: '', headSha: '', commitCount: 0, lastScannedAt: null, error: '' }),
                status: 'syncing',
                error: '',
                backfillProcessed: state.processed ?? project.gitSync?.backfillProcessed ?? 0,
                backfillTotal: state.total ?? project.gitSync?.backfillTotal ?? 0,
                backfillProgress: state.progress ?? project.gitSync?.backfillProgress ?? 0,
                backfillResumable: Boolean(state.resumed),
              },
            }
          : project))
        return
      }
      void refresh()
    })
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      unsubscribeGit()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh])

  return (
    <StoreContext.Provider
      value={{
        projects,
        statuses,
        tags,
        isLoaded,
        loadError,
        refresh,
        setProjects,
        setStatuses,
        setTags,
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const context = useContext(StoreContext)
  if (!context) {
    throw new Error('useStore must be used within a ProjectProvider')
  }
  return context
}
