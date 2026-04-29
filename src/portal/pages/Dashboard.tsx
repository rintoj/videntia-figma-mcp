import { h, Fragment } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'

interface Token {
  id: string
  name: string
  key_prefix: string
  created_at: number
  last_used_at: number | null
  revoked: number
}

interface Props { onNavigate: (page: 'login' | 'register' | 'dashboard') => void }

export function Dashboard({ onNavigate }: Props) {
  const [email, setEmail] = useState('')
  const [tokens, setTokens] = useState<Token[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.me().then(({ data }) => {
      if (!data) { onNavigate('login'); return }
      setEmail(data.email)
    })
    loadTokens()
  }, [])

  async function loadTokens() {
    const { data } = await api.listTokens()
    if (data) setTokens(data.filter(t => !t.revoked))
  }

  async function handleCreate(e: Event) {
    e.preventDefault()
    if (!newKeyName.trim()) return
    setLoading(true)
    setError('')
    const { data, error: err } = await api.createToken(newKeyName.trim())
    setLoading(false)
    if (err) { setError(err); return }
    setCreatedKey(data!.fullKey)
    setNewKeyName('')
    setShowModal(false)
    await loadTokens()
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? Any app using it will stop working.')) return
    await api.revokeToken(id)
    await loadTokens()
  }

  async function handleLogout() {
    await api.logout()
    onNavigate('login')
  }

  function copyKey() {
    navigator.clipboard.writeText(createdKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function fmt(ts: number | null) {
    if (!ts) return 'Never'
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div class="min-h-screen p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-xl font-bold">API Keys</h1>
          <p class="text-gray-500 text-sm">{email}</p>
        </div>
        <button onClick={handleLogout} class="text-sm text-gray-500 hover:text-gray-300">Sign out</button>
      </div>

      {/* Created key banner */}
      {createdKey && (
        <div class="bg-green-900/30 border border-green-700 rounded-xl p-4 mb-6">
          <p class="text-green-300 font-medium text-sm mb-2">Your new API key — copy it now, it won't be shown again</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 bg-gray-900 text-green-300 text-xs rounded-lg px-3 py-2 font-mono break-all">{createdKey}</code>
            <button onClick={copyKey} class="shrink-0 bg-green-700 hover:bg-green-600 text-white text-xs px-3 py-2 rounded-lg">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button onClick={() => setCreatedKey('')} class="mt-2 text-xs text-gray-500 hover:text-gray-300">Dismiss</button>
        </div>
      )}

      {/* Token list */}
      <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-4">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span class="text-sm font-medium">Active keys</span>
          <button onClick={() => setShowModal(true)}
            class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
            + New key
          </button>
        </div>

        {tokens.length === 0 ? (
          <div class="text-center py-12 text-gray-600 text-sm">No API keys yet</div>
        ) : (
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 text-gray-500 text-xs">
                <th class="text-left px-4 py-2">Name</th>
                <th class="text-left px-4 py-2">Prefix</th>
                <th class="text-left px-4 py-2">Created</th>
                <th class="text-left px-4 py-2">Last used</th>
                <th class="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id} class="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                  <td class="px-4 py-3 font-medium">{t.name}</td>
                  <td class="px-4 py-3 font-mono text-gray-400 text-xs">{t.key_prefix}…</td>
                  <td class="px-4 py-3 text-gray-500 text-xs">{fmt(t.created_at)}</td>
                  <td class="px-4 py-3 text-gray-500 text-xs">{fmt(t.last_used_at)}</td>
                  <td class="px-4 py-3 text-right">
                    <button onClick={() => handleRevoke(t.id)}
                      class="text-red-500 hover:text-red-400 text-xs">Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && <p class="text-red-400 text-sm mt-2">{error}</p>}

      {/* Create key modal */}
      {showModal && (
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-sm">
            <h2 class="font-semibold mb-4">Create API key</h2>
            <form onSubmit={handleCreate} class="space-y-4">
              <div>
                <label class="block text-sm text-gray-300 mb-1">Key name</label>
                <input autoFocus type="text" required placeholder="e.g. My Claude Desktop"
                  value={newKeyName} onInput={e => setNewKeyName((e.target as HTMLInputElement).value)}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
              </div>
              <div class="flex gap-2">
                <button type="button" onClick={() => setShowModal(false)}
                  class="flex-1 border border-gray-700 text-gray-400 hover:text-gray-200 rounded-lg px-4 py-2 text-sm">
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  class="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm">
                  {loading ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
