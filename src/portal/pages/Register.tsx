import { h } from 'preact'
import { useState } from 'preact/hooks'
import { api } from '../api'

interface Props { onNavigate: (page: 'login' | 'register' | 'dashboard') => void }

export function Register({ onNavigate }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    const { error: err } = await api.register(email, password)
    setLoading(false)
    if (err) { setError(err); return }
    setSuccess(true)
  }

  if (success) {
    return (
      <div class="min-h-screen flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md text-center">
          <div class="text-4xl mb-4">📧</div>
          <h1 class="text-xl font-semibold mb-2">Check your email</h1>
          <p class="text-gray-400 text-sm">We sent a verification link to <strong class="text-white">{email}</strong>. Click it to activate your account.</p>
          <button onClick={() => onNavigate('login')} class="mt-6 text-sm text-indigo-400 hover:text-indigo-300">Back to login</button>
        </div>
      </div>
    )
  }

  return (
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md">
        <h1 class="text-2xl font-bold mb-1">Create account</h1>
        <p class="text-gray-400 text-sm mb-6">Get API keys for Videntia Figma MCP</p>

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
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Confirm password</label>
            <input type="password" required value={confirm} onInput={e => setConfirm((e.target as HTMLInputElement).value)}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <button type="submit" disabled={loading}
            class="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p class="text-center text-sm text-gray-500 mt-4">
          Already have an account?{' '}
          <button onClick={() => onNavigate('login')} class="text-indigo-400 hover:text-indigo-300">Sign in</button>
        </p>
      </div>
    </div>
  )
}
