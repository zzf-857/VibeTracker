import { Folder, Download, AlertTriangle } from 'lucide-react'

export function Settings() {
  return (
    <div className="flex flex-col h-full w-full py-8 px-10 gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">设置 (Settings)</h1>
        <p className="text-text-secondary text-sm">管理 DevTracker 的全局偏好和数据储存选项。</p>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 pb-10 flex flex-col gap-6 max-w-4xl">
         
         {/* General Settings */}
         <section className="bg-bg-secondary rounded-xl border border-border-primary p-6 gap-6 flex flex-col">
            <h2 className="text-lg font-bold text-text-primary pb-4 border-b border-border-subtle">常规偏好</h2>
            
            <div className="flex items-center justify-between">
               <div>
                  <h3 className="text-sm font-semibold mb-1">默认编辑器配置</h3>
                  <p className="text-xs text-text-tertiary">设置从 DevTracker 打开项目时使用的 IDE</p>
               </div>
               <select className="bg-bg-primary border border-border-primary text-text-primary text-sm rounded-lg focus:ring-accent-blue focus:border-accent-blue block p-2.5 w-48">
                 <option value="vscode">VS Code</option>
                 <option value="idea">IntelliJ IDEA</option>
                 <option value="cursor">Cursor</option>
                 <option value="terminal">System Terminal</option>
               </select>
            </div>

            <div className="flex items-center justify-between">
               <div>
                  <h3 className="text-sm font-semibold mb-1">深色主题 (Dark Mode)</h3>
                  <p className="text-xs text-text-tertiary">当前强制启用深色玻璃态主题，暂不可取消</p>
               </div>
               <div className="relative inline-block w-11 h-6 select-none bg-accent-blue rounded-full cursor-not-allowed opacity-50">
                  <span className="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform translate-x-5"></span>
               </div>
            </div>
         </section>

         {/* Core Options */}
         <section className="bg-bg-secondary rounded-xl border border-border-primary p-6 gap-6 flex flex-col">
            <h2 className="text-lg font-bold text-text-primary pb-4 border-b border-border-subtle">系统路径</h2>
            
            <div className="flex items-center justify-between">
               <div className="max-w-[60%]">
                  <h3 className="text-sm font-semibold mb-1">默认扫描目录</h3>
                  <p className="text-xs text-text-tertiary truncate">当前设定：C:\Users\Admin\Projects\。系统支持基于该路径快速搜索并导入未跟踪的项目源文件。</p>
               </div>
               <button className="bg-bg-tertiary text-text-secondary hover:text-text-primary border border-border-primary hover:border-border-subtle font-medium text-sm px-4 py-2 rounded-lg flex items-center gap-2 transition-all">
                  <Folder size={14} /> 更改目录
               </button>
            </div>
         </section>

         {/* Data Management */}
         <section className="bg-bg-secondary border border-accent-red/20 rounded-xl p-6 gap-6 flex flex-col">
            <h2 className="text-lg font-bold text-accent-red pb-4 border-b border-accent-red/10">数据与备份</h2>
            
            <div className="flex items-center justify-between">
               <div>
                  <h3 className="text-sm font-semibold mb-1 text-text-primary">引出本地数据库</h3>
                  <p className="text-xs text-text-tertiary">将 SQLite 数据导出为 JSON 或备份文件</p>
               </div>
               <button className="bg-bg-tertiary text-text-secondary hover:text-text-primary font-medium text-sm px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
                  <Download size={14} /> 数据导出
               </button>
            </div>

            <div className="flex items-center justify-between">
               <div>
                  <h3 className="text-sm font-semibold mb-1 text-text-primary">擦除应用记录</h3>
                  <p className="text-xs text-text-tertiary">清除当前跟踪的所有项目信息记录和待办。警告：此动作不可逆！</p>
               </div>
               <button className="bg-accent-red/10 text-accent-red hover:bg-accent-red hover:text-white font-medium text-sm px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
                  <AlertTriangle size={14} /> 危险操作
               </button>
            </div>
         </section>

      </div>
    </div>
  )
}
