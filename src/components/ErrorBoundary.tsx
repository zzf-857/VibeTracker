import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 可接入日志系统
    console.error('[ErrorBoundary]', error, errorInfo.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex items-center justify-center h-full min-h-[400px] p-10">
          <div className="glass-panel rounded-[32px] p-8 max-w-md text-center">
            <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-accent-red/15 text-accent-red grid place-items-center">
              <span className="text-2xl font-bold">!</span>
            </div>
            <h2 className="text-xl font-semibold mb-3">页面遇到了问题</h2>
            <p className="text-text-secondary text-sm leading-6 mb-6">
              组件渲染时发生了意外错误。你可以尝试重新加载当前页面。
            </p>
            {this.state.error && (
              <pre className="text-left text-xs text-text-tertiary bg-bg-tertiary rounded-2xl p-4 mb-6 overflow-x-auto max-h-32 font-mono">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="motion-press bg-text-primary text-primary rounded-full px-6 py-3 text-sm font-semibold inline-flex items-center gap-2 transition-opacity hover:opacity-90"
            >
              <RotateCcw size={15} />
              重新加载
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
