import { h, render } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import './styles.css'
import { Register } from './pages/Register'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'

type Page = 'login' | 'register' | 'dashboard'

function getPage(): Page {
  const hash = window.location.hash.replace('#/', '')
  if (hash.startsWith('register')) return 'register'
  if (hash.startsWith('dashboard')) return 'dashboard'
  return 'login'
}

function App() {
  const [page, setPage] = useState<Page>(getPage)

  useEffect(() => {
    const onHash = () => setPage(getPage())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = (p: Page) => {
    window.location.hash = `/${p}`
    setPage(p)
  }

  if (page === 'register') return <Register onNavigate={navigate} />
  if (page === 'dashboard') return <Dashboard onNavigate={navigate} />
  return <Login onNavigate={navigate} />
}

render(<App />, document.getElementById('root')!)
