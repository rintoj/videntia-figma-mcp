import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'

interface Props { onNavigate: (page: 'login' | 'register' | 'dashboard') => void }

export function Login({ onNavigate }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('verified=1')) setNotice('Email verified! You can now log in.')
    if (hash.includes('error=invalid-token')) setError('Verification link is invalid or expired.')
    // Check if already logged in
    api.me().then(({ data }) => { if (data) onNavigate('dashboard') })
  }, [])

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await api.login(email, password)
    setLoading(false)
    if (err) { setError(err); return }
    onNavigate('dashboard')
  }

  return (
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md">
        <h1 class="text-2xl font-bold mb-1">Sign in</h1>
        <p class="text-gray-400 text-sm mb-6">Videntia Figma MCP</p>

        {notice && <div class="bg-green-900/40 border border-green-700 text-green-300 text-sm rounded-lg px-4 py-3 mb-4">{notice}</div>}
        {error && <div class="bg-red-900/40 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input type="email" required value={email} onInput={e => setEmail((e.target as HTMLInputElement).value)}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input type="password" required value={password} onInput={e => setPassword((e.target as HTMLInputElement).value)}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <button type="submit" disabled={loading}
            class="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p class="text-center text-sm text-gray-500 mt-4">
          No account?{' '}
          <button onClick={() => onNavigate('register')} class="text-indigo-400 hover:text-indigo-300">Create one</button>
        </p>
      </div>
    </div>
  )
}
