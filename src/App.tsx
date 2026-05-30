import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'

import { Dashboard } from './pages/Dashboard'
import { ProjectList } from './pages/ProjectList'
import { TagManagement } from './pages/TagManagement'
import { Settings } from './pages/Settings'
import { ProjectDetail } from './pages/ProjectDetail'

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<ProjectList />} />
            <Route path="tags" element={<TagManagement />} />
            <Route path="project/:id" element={<ProjectDetail />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Router>
    </ErrorBoundary>
  )
}

export default App
