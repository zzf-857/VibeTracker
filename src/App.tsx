import { HashRouter as Router, Navigate, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProjectProvider } from './lib/store'
import { ImagePreviewProvider } from './components/ImagePreview'
import { NotificationsProvider } from './lib/notifications'

import { Dashboard } from './pages/Dashboard'
import { ProjectList } from './pages/ProjectList'
import { Settings } from './pages/Settings'
import { ProjectHubDetail } from './pages/ProjectHubDetail'

function App() {
  return (
    <ErrorBoundary>
      <ProjectProvider>
        <NotificationsProvider>
          <ImagePreviewProvider>
            <Router>
              <Routes>
                <Route path="/" element={<Layout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="projects" element={<ProjectList />} />
                  <Route path="project/:id" element={<ProjectHubDetail />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Router>
          </ImagePreviewProvider>
        </NotificationsProvider>
      </ProjectProvider>
    </ErrorBoundary>
  )
}

export default App
