import { useEffect, useState } from 'react'
import { FolderOpen, Activity, CheckCircle2, PauseCircle, Plus } from 'lucide-react'
import { Project } from '../types'
import { useNavigate } from 'react-router-dom'

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    // Load projects from IPC
    window.ipcRenderer.invoke('get-projects').then(setProjects)
  }, [])

  const devCount = projects.filter(p => p.status === 'developing').length
  const completedCount = projects.filter(p => p.status === 'completed').length
  const pausedCount = projects.filter(p => p.status === 'paused').length

  const maxStatus = Math.max(devCount, completedCount, pausedCount, 1)

  return (
    <div className="flex flex-col h-full w-full py-8 px-10 gap-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">仪表板</h1>
          <p className="text-text-secondary text-sm">项目进度追踪与管理中心</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative group">
             <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <svg className="w-4 h-4 text-text-tertiary group-focus-within:text-accent-blue transition-colors" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"/>
                </svg>
            </div>
            <input type="text" className="bg-bg-secondary border border-border-primary text-text-primary text-sm rounded-lg focus:ring-accent-blue focus:border-accent-blue focus:outline-none block w-64 pl-10 p-2.5 transition-all" placeholder="快速找项目... (Ctrl+K)" />
          </div>
          <button onClick={() => navigate('/projects')} className="bg-accent-blue hover:bg-blue-500 text-bg-primary font-semibold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 transition-all shadow-[0_4px_12px_rgba(88,166,255,0.2)]">
            <Plus size={16} strokeWidth={2.5}/>
            新建项目
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-6">
        <StatCard icon={<FolderOpen size={20} className="text-text-secondary" />} title="项目总数" value={projects.length.toString()} />
        <StatCard icon={<Activity size={20} className="text-accent-blue" />} title="开发中" value={devCount.toString()} />
        <StatCard icon={<CheckCircle2 size={20} className="text-status-completed" />} title="已完成" value={completedCount.toString()} />
        <StatCard icon={<PauseCircle size={20} className="text-status-paused" />} title="已暂停" value={pausedCount.toString()} />
      </div>

      <div className="flex gap-6 min-h-[400px] flex-1">
        {/* Recent Projects List */}
        <div className="flex-1 bg-bg-secondary rounded-xl border border-border-primary p-6 flex flex-col relative overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-base font-semibold">近期活跃项目</h2>
            <button onClick={() => navigate('/projects')} className="text-xs text-accent-blue hover:text-blue-400 font-medium">查看全部 &rarr;</button>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-3 pb-4">
             {projects.slice(0, 10).map((p) => (
                <div key={p.id} onClick={() => navigate(`/project/${p.id}`)} className="group flex items-center justify-between p-4 rounded-lg bg-bg-tertiary border border-border-primary hover:border-border-subtle hover:bg-sidebar transition-all cursor-pointer">
                  <div className="flex flex-col max-w-[70%]">
                    <span className="font-medium text-text-primary text-[15px] group-hover:text-accent-blue transition-colors truncate">{p.name}</span>
                    <span className="text-xs text-text-tertiary mt-1 truncate">{p.path || '未绑定路径'}</span>
                  </div>
                  <div className="flex gap-4 items-center flex-shrink-0">
                     <div className="flex flex-col items-end gap-1.5">
                       <span className={`text-[11px] px-2 py-0.5 rounded-[4px] font-medium border
                          ${p.status === 'developing' ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/20' : ''}
                          ${p.status === 'completed' ? 'bg-status-completed/10 text-status-completed border-status-completed/20' : ''}
                          ${p.status === 'paused' ? 'bg-status-paused/10 text-status-paused border-status-paused/20' : ''}
                       `}>
                          {p.status === 'developing' ? '开发中' : p.status === 'completed' ? '已完成' : '已暂停'}
                       </span>
                       <span className="text-xs text-text-secondary font-medium font-mono">{Math.round(p.progress || 0)}%</span>
                     </div>
                  </div>
                </div>
             ))}
             {projects.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center opacity-50">
                 <FolderOpen size={48} className="mb-4 text-text-tertiary" />
                 <p className="text-sm">暂无活跃项目，快去新建一个吧！</p>
               </div>
             )}
          </div>
        </div>

        {/* Status Distribution Bar Chart */}
        <div className="w-[380px] bg-bg-secondary rounded-xl border border-border-primary p-6 flex flex-col">
          <h2 className="text-base font-semibold mb-6">项目状态分布</h2>
          
          <div className="flex-1 flex items-end justify-around pb-6 pt-4">
             {/* Dev Bar */}
             <div className="flex flex-col items-center justify-end h-full gap-3 group w-full">
                <span className="text-[13px] font-semibold text-text-primary">{devCount}</span>
                <div className="w-10 bg-accent-blue/90 rounded-t-[4px] relative overflow-hidden transition-all duration-500 ease-out group-hover:brightness-110" style={{ height: Math.max((devCount/maxStatus)*100, 4) + '%'}}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
                </div>
                <span className="text-[12px] text-text-secondary">开发中</span>
             </div>

             {/* Completed Bar */}
             <div className="flex flex-col items-center justify-end h-full gap-3 group w-full">
                <span className="text-[13px] font-semibold text-text-primary">{completedCount}</span>
                <div className="w-10 bg-status-completed/90 rounded-t-[4px] relative overflow-hidden transition-all duration-500 ease-out group-hover:brightness-110" style={{ height: Math.max((completedCount/maxStatus)*100, 4) + '%'}}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
                </div>
                <span className="text-[12px] text-text-secondary">已完成</span>
             </div>

             {/* Paused Bar */}
             <div className="flex flex-col items-center justify-end h-full gap-3 group w-full">
                <span className="text-[13px] font-semibold text-text-primary">{pausedCount}</span>
                <div className="w-10 bg-status-paused/90 rounded-t-[4px] relative overflow-hidden transition-all duration-500 ease-out group-hover:brightness-110" style={{ height: Math.max((pausedCount/maxStatus)*100, 4) + '%'}}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
                </div>
                <span className="text-[12px] text-text-secondary">已暂停</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, title, value }: { icon: React.ReactNode, title: string, value: string }) {
  return (
    <div className="bg-bg-secondary rounded-xl border border-border-primary p-5 flex flex-col gap-3 relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-5 opacity-20 group-hover:opacity-40 group-hover:scale-110 transition-all duration-300 pointer-events-none">
        {icon}
      </div>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[13px] font-medium text-text-secondary">{title}</span>
      </div>
      <div className="text-[32px] font-bold text-text-primary tabular-nums tracking-tight">
        {value}
      </div>
    </div>
  )
}
