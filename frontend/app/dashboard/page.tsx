'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  Zap, ArrowLeft, Send, Bot, CheckCircle2,
  Clock, Loader2, Award, Shield, Link2, ExternalLink,
  Wallet, Play, Users, Star, Activity,
  FileText, Hash, DollarSign, Timer, AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react'

// ---- TYPES ----
interface Task {
  id: string
  title: string
  description: string
  status: string
  reward?: number
  selectedAgentName?: string
  selectedAgentId?: string
  artifactPath?: string
  result?: {
    summary: string
    artifactPath: string
    verificationNotes: string
  }
  createdAt?: number
  delegator?: string
  delegate?: string
  delegation?: Record<string, unknown>
  subDelegation?: {
    parent?: Record<string, unknown>
    delegator?: string
    delegate?: string
    capUsdc?: number
    createdAt?: number
  } | null
  chainJobId?: number
  txHashes?: Record<string, string>
  deadline?: number
}

interface Agent {
  id: string
  name: string
  capabilities: string[]
  reputation: number
}

type TabType = 'submit' | 'tasks' | 'agents' | 'delegation'

const LIFECYCLE_STAGES = [
  { key: 'queued', label: 'Queued', icon: Clock },
  { key: 'open', label: 'Open', icon: Send },
  { key: 'bidding', label: 'Agents Bidding', icon: Users },
  { key: 'assigned', label: 'Winner Chosen', icon: Award },
  { key: 'executing', label: 'Executing', icon: Activity },
  { key: 'done', label: 'Completed', icon: CheckCircle2 },
]

// ---- UTILS ----
function statusToStage(status: string): number {
  const map: Record<string, number> = {
    queued: 0,
    open: 1,
    bidding: 2,
    assigned: 3,
    in_progress: 4,
    completed: 4,
    failed: 4,
    cancelled: 4,
  }
  return map[status] ?? 0
}

function getStatusClass(status: string) {
  const map: Record<string, string> = {
    queued: 'agent-status-open',
    open: 'agent-status-open',
    assigned: 'agent-status-bidding',
    bidding: 'agent-status-bidding',
    in_progress: 'agent-status-executing',
    completed: 'agent-status-completed',
    failed: 'agent-status-open',
    cancelled: 'agent-status-open',
  }
  return map[status] ?? 'agent-status-open'
}

function isValidTxHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value)
}

function formatAddress(addr?: string) {
  if (!addr) return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function timeAgo(ts?: number) {
  if (!ts) return ''
  const diff = Date.now() / 1000 - ts / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

// ---- SUBCOMPONENTS ----

function WalletConnect({
  address,
  onConnect,
}: {
  address: string | null
  onConnect: (addr: string) => void
}) {
  const connect = async () => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      alert('MetaMask not installed. Please install it.')
      return
    }
    try {
      const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' })
      if (accounts?.[0]) onConnect(accounts[0])
    } catch {
      alert('Connection rejected.')
    }
  }

  return (
    <button
      onClick={connect}
      className={`wallet-btn ${address ? 'connected' : ''}`}
      id="wallet-connect-btn"
    >
      <Wallet className="w-4 h-4" />
      {address ? (
        <>
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          {formatAddress(address)}
        </>
      ) : (
        'Connect MetaMask'
      )}
    </button>
  )
}

function MetricCard({
  label, value, sub, icon: Icon, color, trend,
}: {
  label: string; value: string; sub?: string
  icon: React.ComponentType<any>; color: string; trend?: string
}) {
  return (
    <div className="agent-panel p-5 metric-glow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-white/50 text-sm">{label}</span>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${color}20`, border: `1px solid ${color}40` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      {sub && <div className="text-xs text-white/40">{sub}</div>}
      {trend && <div className="text-xs text-emerald-400 mt-1">↑ {trend}</div>}
    </div>
  )
}

function TaskCard({ task, expanded, onToggle }: {
  task: Task
  expanded: boolean
  onToggle: () => void
}) {
  const stage = statusToStage(task.status)

  return (
    <div className="agent-panel overflow-hidden transition-all duration-300 animate-fade-in">
      {/* Task header */}
      <div
        className="p-4 cursor-pointer flex items-start gap-3"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`${getStatusClass(task.status)} text-xs font-semibold px-2.5 py-1 rounded-full`}>
              {task.status.replace('_', ' ')}
            </span>
            {task.chainJobId && (
              <span className="text-xs text-white/30">Chain #{task.chainJobId}</span>
            )}
          </div>
          <h3 className="text-white font-semibold text-sm truncate">{task.title || task.description}</h3>
          <div className="flex items-center gap-3 mt-1">
            {task.selectedAgentName && (
              <span className="text-xs text-white/40">→ {task.selectedAgentName}</span>
            )}
            {task.reward && (
              <span className="text-xs text-white/40 flex items-center gap-0.5">
                <DollarSign className="w-3 h-3" />{task.reward} USDC
              </span>
            )}
            {task.txHashes?.paymentTx && isValidTxHash(task.txHashes.paymentTx) && (
              <a href={`https://sepolia.basescan.org/tx/${task.txHashes.paymentTx}`} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
                View on BaseScan ↗
              </a>
            )}
          </div>
        </div>

        {/* Lifecycle bar */}
        <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
          {LIFECYCLE_STAGES.map((s, i) => {
            const done = i < stage
            const active = i === stage
            return (
              <div key={s.key} className="flex items-center gap-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center transition-all duration-500 ${
                    done ? 'bg-emerald-500/20 border border-emerald-500/50' :
                    active ? 'bg-indigo-500/20 border border-indigo-500/60' :
                    'bg-white/5 border border-white/10'
                  }`}
                >
                  <s.icon className={`w-3 h-3 ${done ? 'text-emerald-400' : active ? 'text-indigo-400' : 'text-white/20'}`} />
                </div>
                {i < LIFECYCLE_STAGES.length - 1 && (
                  <div className={`w-4 h-px ${i < stage ? 'bg-emerald-500/50' : 'bg-white/10'}`} />
                )}
              </div>
            )
          })}
        </div>

        <button className="text-white/30 ml-2 flex-shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4 animate-fade-in">
          {/* Description */}
          <div>
            <p className="text-xs text-white/40 mb-1">Description</p>
            <p className="text-sm text-white/70 leading-relaxed">{task.description}</p>
          </div>

          {/* Lifecycle Steps */}
          <div>
            <p className="text-xs text-white/40 mb-3">Lifecycle</p>
            <div className="space-y-3">
              {LIFECYCLE_STAGES.map((s, i) => {
                const done = i < stage
                const active = i === stage
                return (
                  <div key={s.key} className="lifecycle-step">
                    <div className={`step-dot ${done ? 'done' : active ? 'active' : 'pending'}`}>
                      {done ? '✓' : i + 1}
                    </div>
                    <div>
                      <div className={`text-sm font-medium ${done ? 'text-emerald-400' : active ? 'text-indigo-300' : 'text-white/30'}`}>
                        {s.label}
                      </div>
                    </div>
                    {active && !['completed', 'failed', 'cancelled'].includes(task.status) && (
                      <Loader2 className="w-4 h-4 text-indigo-400 animate-spin ml-auto" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Tx Hashes */}
          {task.txHashes && Object.keys(task.txHashes).length > 0 && (
            <div>
              <p className="text-xs text-white/40 mb-2">On-chain Transactions</p>
              <div className="space-y-1.5">
                {Object.entries(task.txHashes).filter(([, hash]) => isValidTxHash(hash)).map(([key, hash]) => (
                  <div key={key} className="flex items-center gap-2 bg-white/5 px-3 py-2 rounded-lg">
                    <Hash className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                    <span className="text-xs text-white/50 capitalize">{key}:</span>
                    <span className="text-xs text-indigo-300 font-mono truncate">{hash.slice(0, 20)}…</span>
                    <a
                      href={`https://sepolia.basescan.org/tx/${hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-indigo-400 hover:text-indigo-300"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Delegation chain */}
          {task.subDelegation && (
            <div>
              <p className="text-xs text-white/40 mb-2 flex items-center gap-1">
                <Shield className="w-3 h-3" /> Delegation Chain
              </p>
              <div className="space-y-2">
                <div className="delegation-node">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-xs text-white/50">User</span>
                    <span className="text-xs text-indigo-300 font-mono ml-auto">
                      {formatAddress(task.subDelegation.delegator || task.delegator)}
                    </span>
                  </div>
                </div>
                <div className="delegation-arrow text-xs text-indigo-400">
                  ↓ delegated ${task.subDelegation.capUsdc || task.reward} USDC cap
                </div>
                <div className="delegation-node">
                  <div className="flex items-center gap-2">
                    <Bot className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-xs text-white/50">Orchestrator</span>
                    <span className="text-xs text-indigo-300 font-mono ml-auto">
                      {formatAddress(task.subDelegation.delegate)}
                    </span>
                  </div>
                </div>
                <div className="delegation-arrow text-xs text-indigo-400">↓ sub-delegated to winner</div>
                <div className="delegation-node border-indigo-500/30">
                  <div className="flex items-center gap-2">
                    <Award className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs text-white/50">Specialist ({task.selectedAgentName})</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Artifact */}
          {task.artifactPath && (
            <div>
              <p className="text-xs text-white/40 mb-2">Artifact</p>
              <a
                href={`/api/backend/artifacts/${encodeURIComponent(task.artifactPath.split('/').pop() || '')}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-300 text-xs font-semibold hover:bg-indigo-500/20 transition-colors"
              >
                <FileText className="w-4 h-4" />
                View Artifact
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const color = agent.id === 'agent-owner' ? '#6366F1' : agent.id === 'agent-builder' ? '#10B981' : '#F59E0B'

  return (
    <div className="agent-panel p-4 metric-glow bid-card">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
          style={{ background: `${color}25`, border: `1px solid ${color}40` }}>
          <Bot className="w-5 h-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">{agent.name}</div>
          <div className="text-xs text-white/40">{agent.id}</div>
        </div>
        <div className="flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-current" />
          <span className="text-sm font-bold text-white">{agent.reputation}</span>
        </div>
      </div>

      {/* Reputation bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-white/40">Reputation</span>
          <span className="text-xs text-white/70">{agent.reputation}/100</span>
        </div>
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className="progress-fill" style={{ width: `${agent.reputation}%`, background: `linear-gradient(90deg, ${color}, ${color}80)` }} />
        </div>
      </div>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-1.5">
        {agent.capabilities.map(cap => (
          <span key={cap} className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/50 border border-white/10">
            {cap}
          </span>
        ))}
      </div>

    </div>
  )
}

// ---- MAIN DASHBOARD ----
export default function DashboardPage() {
  const [tab, setTab] = useState<TabType>('submit')
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [orchestratorAddress, setOrchestratorAddress] = useState<string>('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [backendError, setBackendError] = useState<string>('')
  const [expandedTask, setExpandedTask] = useState<string | null>(null)

  // Form state
  const [description, setDescription] = useState('')
  const [budget, setBudget] = useState('5')
  const [deadlineMinutes, setDeadlineMinutes] = useState('60')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')
  const [submitError, setSubmitError] = useState('')

  // Load bootstrap & initial data
  useEffect(() => {
    fetch('/api/backend/bootstrap')
      .then(r => r.json())
      .then(d => setOrchestratorAddress(d.orchestratorAddress || ''))
      .catch(() => setOrchestratorAddress(
        // Fallback to env value from plan
        process.env.NEXT_PUBLIC_AGENT_OWNER_WALLET || '0x890437459ECc4C844f28DeE85361734F2f054407'
      ))

    // Try to get already connected wallet
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      ;(window as any).ethereum.request({ method: 'eth_accounts' })
        .then((accounts: string[]) => {
          if (accounts?.[0]) setWalletAddress(accounts[0])
        })
        .catch(() => {})
    }
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        fetch('/api/backend/tasks'),
        fetch('/api/backend/agents'),
      ])
      if (!tasksRes.ok || !agentsRes.ok) {
        const msg = !tasksRes.ok ? `tasks ${tasksRes.status}` : `agents ${agentsRes.status}`
        setBackendError(`Backend unavailable (${msg}).`)
        return
      }
      const [t, a] = await Promise.all([tasksRes.json(), agentsRes.json()])
      setTasks(Array.isArray(t) ? t : [])
      setAgents(Array.isArray(a) ? a : [])
      setBackendError('')
    } catch {
      setBackendError('Backend unavailable on port 3002.')
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 3000)
    return () => clearInterval(interval)
  }, [fetchData])

  // ---- TASK SUBMIT ----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError('')
    setSubmitMsg('')

    if (!description.trim()) { setSubmitError('Description required.'); return }
    const reward = parseFloat(budget)
    if (!reward || reward <= 0) { setSubmitError('Valid budget required.'); return }

    // Need wallet
    if (!walletAddress) {
      setSubmitError('Please connect MetaMask first.')
      return
    }

    const delegate = orchestratorAddress
    if (!delegate) {
      setSubmitError('Orchestrator address missing. Starting demo mode.')
      // In demo (no AGENT_OWNER_WALLET env), use the known address
    }

    setSubmitting(true)
    setSubmitMsg('Connecting MetaMask…')
    setTab('tasks')

    try {
      // Send real ETH transaction
      const deadlineSec = Math.floor(Date.now() / 1000) + Math.floor(parseFloat(deadlineMinutes || '60') * 60)
      let paymentTxHash = ''

      if (delegate && (window as any).ethereum) {
        try {
          setSubmitMsg('Please confirm the Sepolia ETH payment in MetaMask...')
          // Simulate USDC with a small amount of ETH (0.0001 ETH per budget unit to conserve testnet funds)
          const valueWei = BigInt(Math.floor(reward * 1e14)).toString(16)
          
          const txHash = await (window as any).ethereum.request({
            method: 'eth_sendTransaction',
            params: [{
              from: walletAddress,
              to: delegate,
              value: '0x' + valueWei,
            }],
          })
          paymentTxHash = txHash
          setSubmitMsg(`Payment sent! (Tx: ${txHash.slice(0, 10)}...) Posting task…`)
        } catch (e) {
          setSubmitError('Payment cancelled or failed. Cannot post task.')
          setSubmitMsg('')
          setSubmitting(false)
          return
        }
      }

      const res = await fetch('/api/backend/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          reward,
          deadline: deadlineSec,
          delegator: walletAddress,
          delegate: delegate || walletAddress,
          paymentTxHash,
        }),
      })
      const payload = await res.json()
      if (res.ok) {
        setSubmitMsg(`✓ Task accepted (${payload.taskId || 'queued'})`)
        setDescription('')
        setBudget('5')
        await fetchData()
      } else {
        setSubmitError(payload.error || 'Submission failed.')
        setSubmitMsg('')
      }
    } catch (err) {
      setSubmitError('Network error - is the backend running on port 3002?')
      setSubmitMsg('')
    } finally {
      setSubmitting(false)
    }
  }

  // ---- STATS ----
  const completedCount = tasks.filter(t => ['completed'].includes(t.status)).length
  const activeCount = tasks.filter(t => ['queued', 'open', 'bidding', 'assigned', 'in_progress'].includes(t.status)).length

  return (
    <div className="min-h-screen" style={{ background: '#0A0F1E', fontFamily: "'Poppins', sans-serif" }}>
      {/* ---- TOPBAR ---- */}
      <header className="sticky top-0 z-50 border-b border-white/5" style={{ background: 'rgba(10, 15, 30, 0.9)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                <Zap className="w-4 h-4 text-indigo-400" />
              </div>
              <span className="font-bold text-white">AgentFlow</span>
              <span className="hidden sm:flex items-center gap-1 text-xs text-white/30 ml-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Base Sepolia
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div className="hidden sm:flex items-center gap-1 bg-white/5 rounded-xl p-1">
            {([
              { key: 'submit', label: 'Submit', icon: Send },
              { key: 'tasks', label: `Tasks (${tasks.length})`, icon: Activity },
              { key: 'agents', label: 'Agents', icon: Bot },
              { key: 'delegation', label: 'Delegation', icon: Shield },
            ] as { key: TabType; label: string; icon: React.ComponentType<any> }[]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  tab === key ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <WalletConnect address={walletAddress} onConnect={setWalletAddress} />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* ---- METRICS ROW ---- */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <MetricCard label="Total Tasks" value={String(tasks.length)} icon={Activity} color="#6366F1" sub="all time" />
          <MetricCard label="Completed" value={String(completedCount)} icon={CheckCircle2} color="#10B981" sub="finalized" />
          <MetricCard label="Active Now" value={String(activeCount)} icon={Loader2} color="#F59E0B" sub="in progress" />
          <MetricCard label="Agents Ready" value={String(agents.length || 3)} icon={Bot} color="#3B82F6" sub="online" />
        </div>
        {backendError && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
            <p className="text-red-400 text-sm">{backendError}</p>
          </div>
        )}

        {/* ---- SUBMIT TAB ---- */}
        {tab === 'submit' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
            {/* Submit form */}
            <div className="agent-panel p-6">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <Send className="w-4 h-4 text-indigo-400" />
                </div>
                <h2 className="text-white font-bold text-lg">Submit Task</h2>
              </div>

              {!walletAddress && (
                <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-300 text-sm font-medium">Connect MetaMask first</p>
                    <p className="text-amber-300/60 text-xs">Required to sign the delegation</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-white/60 text-sm mb-2 block">Task Description</label>
                  <textarea
                    id="task-description"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Build a landing page for a wallet app..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 resize-none transition-colors"
                    rows={4}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/60 text-sm mb-2 block">Budget (USDC)</label>
                    <div className="relative">
                      <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                      <input
                        id="task-budget"
                        value={budget}
                        onChange={e => setBudget(e.target.value)}
                        inputMode="decimal"
                        placeholder="5"
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-white/60 text-sm mb-2 block">Deadline (minutes)</label>
                    <div className="relative">
                      <Timer className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                      <input
                        id="task-deadline"
                        value={deadlineMinutes}
                        onChange={e => setDeadlineMinutes(e.target.value)}
                        inputMode="numeric"
                        placeholder="60"
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 transition-colors"
                      />
                    </div>
                  </div>
                </div>

                {submitError && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30">
                    <p className="text-red-400 text-sm">{submitError}</p>
                  </div>
                )}

                {submitMsg && (
                  <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin flex-shrink-0" />
                    <p className="text-indigo-300 text-sm">{submitMsg}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  id="submit-task-btn"
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: submitting ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366F1, #818CF8)', boxShadow: submitting ? 'none' : '0 0 30px rgba(99,102,241,0.3)' }}
                >
                  {submitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                  ) : (
                    <><Send className="w-4 h-4" /> Submit Task</>
                  )}
                </button>
              </form>
            </div>

            {/* How it works panel */}
            <div className="space-y-4">
              <div className="agent-panel p-6">
                <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                  <Play className="w-4 h-4 text-indigo-400" />
                  What Happens Next
                </h3>
                <div className="space-y-4">
                  {[
                    { icon: Send, color: '#6366F1', title: 'Task enters marketplace', desc: 'Your task is posted on the board and broadcast to all agents' },
                    { icon: Users, color: '#F59E0B', title: 'Agents bid', desc: 'Builder and Design agents evaluate the task and submit competitive bids' },
                    { icon: Award, color: '#10B981', title: 'Winner selected', desc: 'Orchestrator scores bids on price, reputation, and capabilities' },
                    { icon: Activity, color: '#3B82F6', title: 'Execution begins', desc: 'Winning agent executes the task using its toolkit' },
                    { icon: CheckCircle2, color: '#10B981', title: 'Artifact delivered', desc: 'Result is verified, payment released from escrow' },
                  ].map(({ icon: Icon, color, title, desc }) => (
                    <div key={title} className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
                        <Icon className="w-3.5 h-3.5" style={{ color }} />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white/90">{title}</div>
                        <div className="text-xs text-white/40 mt-0.5">{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Orchestrator address */}
              <div className="agent-panel p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm font-semibold text-white">Orchestrator</span>
                  {orchestratorAddress ? (
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20">configured</span>
                  ) : (
                    <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20">demo mode</span>
                  )}
                </div>
                <div className="font-mono text-xs text-indigo-300 bg-white/5 px-3 py-2 rounded-lg break-all">
                  {orchestratorAddress || '0x890437459ECc4C844f28DeE85361734F2f054407'}
                </div>
                <p className="text-xs text-white/30 mt-2">
                  This is the MetaMask delegation target — the orchestrator agent's wallet.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ---- TASKS TAB ---- */}
        {tab === 'tasks' && (
          <div className="animate-fade-in space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-lg">Task Board</h2>
              <button onClick={fetchData} className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1">
                <Loader2 className="w-3 h-3" /> Refresh
              </button>
            </div>
            {tasks.length === 0 ? (
              <div className="agent-panel p-12 text-center">
                <Activity className="w-10 h-10 text-white/20 mx-auto mb-3" />
                <p className="text-white/40 text-sm">No tasks yet. Submit one from the Submit tab!</p>
                <button onClick={() => setTab('submit')} className="mt-4 px-4 py-2 bg-indigo-500/20 text-indigo-300 text-sm rounded-xl hover:bg-indigo-500/30 transition-colors">
                  Submit First Task →
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.slice().reverse().map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    expanded={expandedTask === task.id}
                    onToggle={() => setExpandedTask(prev => prev === task.id ? null : task.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- AGENTS TAB ---- */}
        {tab === 'agents' && (
          <div className="animate-fade-in space-y-4">
            <h2 className="text-white font-bold text-lg">Registered Agents</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(agents.length > 0 ? agents : [
                { id: 'agent-owner', name: 'Owner Agent', capabilities: ['planning', 'verification'], reputation: 95 },
                { id: 'agent-builder', name: 'Builder Agent', capabilities: ['frontend', 'copywriting', 'generalist'], reputation: 72 },
                { id: 'agent-design', name: 'Design Agent', capabilities: ['frontend', 'branding', 'copywriting'], reputation: 88 },
              ]).map(agent => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>

            <div className="agent-panel p-5">
              <h3 className="text-white font-semibold mb-2">Live Bidding</h3>
              <p className="text-sm text-white/50">
                Bids are shown in task lifecycle updates as they are received by the backend worker loop.
              </p>
            </div>
          </div>
        )}

        {/* ---- DELEGATION TAB ---- */}
        {tab === 'delegation' && (
          <div className="animate-fade-in space-y-4">
            <h2 className="text-white font-bold text-lg">Delegation Chain (ERC-7715)</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chain visualization */}
              <div className="agent-panel p-6">
                <h3 className="text-white/70 text-sm font-semibold uppercase tracking-wider mb-5">Trust Architecture</h3>
                <div className="space-y-3">
                  {/* User node */}
                  <div className="p-4 rounded-2xl border-2" style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                        <Wallet className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div>
                        <div className="text-xs text-white/40 uppercase tracking-wider">User (Delegator)</div>
                        <div className="text-sm font-bold text-white">{formatAddress(walletAddress || '0x890437459ECc4C844f28DeE85361734F2f054407')}</div>
                      </div>
                    </div>
                    <div className="text-xs text-indigo-300/70">Signs ONE MetaMask delegation. Sets budget cap + deadline.</div>
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center gap-3 px-4">
                    <div className="flex-1 h-px bg-gradient-to-r from-indigo-500/50 to-indigo-500/10" />
                    <div className="text-xs text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-full border border-indigo-500/20">
                      ERC-7715 delegation
                    </div>
                    <div className="flex-1 h-px bg-gradient-to-r from-indigo-500/10 to-indigo-500/50" />
                  </div>

                  {/* Orchestrator */}
                  <div className="p-4 rounded-2xl border" style={{ background: 'rgba(99,102,241,0.05)', borderColor: 'rgba(99,102,241,0.2)' }}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/15 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-indigo-300" />
                      </div>
                      <div>
                        <div className="text-xs text-white/40 uppercase tracking-wider">Orchestrator (Delegate)</div>
                        <div className="text-sm font-bold text-white">{formatAddress(orchestratorAddress || '0x890437459ECc4C844f28DeE85361734F2f054407')}</div>
                      </div>
                    </div>
                    <div className="text-xs text-indigo-300/70">Posts jobs, evaluates bids, sub-delegates to winner</div>
                  </div>

                  {/* Sub-delegation arrow */}
                  <div className="flex items-center gap-3 px-4">
                    <div className="flex-1 h-px bg-gradient-to-r from-amber-500/50 to-amber-500/10" />
                    <div className="text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">
                      sub-delegation
                    </div>
                    <div className="flex-1 h-px bg-gradient-to-r from-amber-500/10 to-amber-500/50" />
                  </div>

                  {/* Specialist */}
                  <div className="p-4 rounded-2xl border" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)' }}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center">
                        <Award className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <div className="text-xs text-white/40 uppercase tracking-wider">Specialist (Winner)</div>
                        <div className="text-sm font-bold text-white">Builder Agent / Design Agent</div>
                      </div>
                    </div>
                    <div className="text-xs text-amber-300/70">Executes the task within sub-delegated budget</div>
                  </div>
                </div>
              </div>

              {/* Delegation details */}
              <div className="space-y-4">
                <div className="agent-panel p-5">
                  <h3 className="text-white/70 text-sm font-semibold uppercase tracking-wider mb-4">How Delegation Works</h3>
                  <div className="space-y-3">
                    {[
                      { icon: Shield, color: '#6366F1', title: 'ERC-7715 Standard', desc: 'MetaMask Delegation Framework lets users authorize agents to act within defined limits' },
                      { icon: DollarSign, color: '#10B981', title: 'Budget Caveats', desc: 'NativeTokenPaymentEnforcer limits USDC spend to exactly your approved amount' },
                      { icon: Clock, color: '#F59E0B', title: 'Time Bounds', desc: 'TimestampEnforcer ensures delegation expires at your chosen deadline' },
                      { icon: Link2, color: '#3B82F6', title: 'Sub-delegation', desc: 'Orchestrator can further delegate to winning specialist — verifiable chain' },
                    ].map(({ icon: Icon, color, title, desc }) => (
                      <div key={title} className="flex items-start gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                        <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
                          style={{ background: `${color}20` }}>
                          <Icon className="w-3.5 h-3.5" style={{ color }} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white/90">{title}</div>
                          <div className="text-xs text-white/40 mt-0.5">{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Delegation from tasks */}
                {tasks.filter(t => t.delegation).length > 0 && (
                  <div className="agent-panel p-5">
                    <h3 className="text-sm font-semibold text-white/70 mb-3">Signed Delegations</h3>
                    <div className="space-y-2">
                      {tasks.filter(t => t.delegation).map(t => (
                        <div key={t.id} className="flex items-center gap-2 p-2 bg-white/5 rounded-xl">
                          <Shield className="w-4 h-4 text-indigo-400" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white/70 truncate">{t.title}</div>
                            <div className="text-xs text-white/30">{formatAddress(t.delegator)} → {formatAddress(t.delegate)}</div>
                          </div>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
