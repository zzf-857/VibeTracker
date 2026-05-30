import React, { createContext, useContext, useState, useCallback } from 'react'
import { Project, ProjectStatus, Tag } from '../types'

interface StoreContextProps {
  projects: Project[]
  statuses: ProjectStatus[]
  tags: Tag[]
  isLoaded: boolean
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

  const refresh = useCallback(async () => {
    try {
      const [p, s, t] = await Promise.all([
        window.ipcRenderer.invoke('get-projects'),
        window.ipcRenderer.invoke('get-statuses'),
        window.ipcRenderer.invoke('get-tags'),
      ])
      setProjects(p)
      setStatuses(s)
      setTags(t)
      setIsLoaded(true)
    } catch (err) {
      console.error('Store failed to sync data from IPC:', err)
    }
  }, [])

  return (
    <StoreContext.Provider
      value={{
        projects,
        statuses,
        tags,
        isLoaded,
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
