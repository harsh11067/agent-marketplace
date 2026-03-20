'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard, Package, Users, DollarSign, Megaphone, HelpCircle,
  Search, SlidersHorizontal, ChevronLeft, ChevronRight, Star,
  TrendingUp, Bot, Zap, ChevronDown, ArrowUpRight, Crown
} from 'lucide-react'

// ---- DATA ----
const CUSTOMERS = [
  { name: 'Jane Cooper', company: 'Microsoft', phone: '(225) 555-0118', email: 'jane@microsoft.com', country: 'United States', active: true },
  { name: 'Floyd Miles', company: 'Yahoo', phone: '(205) 555-0100', email: 'floyd@yahoo.com', country: 'Kiribati', active: false },
  { name: 'Ronald Richards', company: 'Adobe', phone: '(302) 555-0107', email: 'ronald@adobe.com', country: 'Israel', active: false },
  { name: 'Marvin McKinney', company: 'Tesla', phone: '(252) 555-0126', email: 'marvin@tesla.com', country: 'Iran', active: true },
  { name: 'Jerome Bell', company: 'Google', phone: '(629) 555-0129', email: 'jerome@google.com', country: 'Réunion', active: true },
  { name: 'Kathryn Murphy', company: 'Microsoft', phone: '(406) 555-0120', email: 'kathryn@microsoft.com', country: 'Curaçao', active: true },
  { name: 'Jacob Jones', company: 'Yahoo', phone: '(208) 555-0112', email: 'jacob@yahoo.com', country: 'Brazil', active: true },
  { name: 'Kristin Watson', company: 'Facebook', phone: '(704) 555-0127', email: 'kristin@facebook.com', country: 'Åland Islands', active: false },
]

const AGENTS_DATA = [
  { name: 'Owner Agent', id: 'agent-owner', rep: 95, role: 'coordinator', tasks: 24, color: '#6366F1' },
  { name: 'Builder Agent', id: 'agent-builder', rep: 72, role: 'worker', tasks: 18, color: '#10B981' },
  { name: 'Design Agent', id: 'agent-design', rep: 88, role: 'worker', tasks: 31, color: '#F59E0B' },
]

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/crm', active: true },
  { icon: Package, label: 'AI Agents', href: '/dashboard', active: false },
  { icon: Users, label: 'Customers', href: '/crm', active: false },
  { icon: DollarSign, label: 'Payments', href: '/crm', active: false },
  { icon: Megaphone, label: 'Promote', href: '/crm', active: false },
  { icon: HelpCircle, label: 'Help', href: '/crm', active: false },
]

const AVATAR_COLORS = [
  'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-blue-500', 'bg-purple-500', 'bg-teal-500', 'bg-orange-500',
]

// ---- COMPONENTS ----
function Avatar({ name, index }: { name: string; index: number }) {
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${AVATAR_COLORS[index % AVATAR_COLORS.length]}`}>
      {name.split(' ').map(n => n[0]).join('')}
    </div>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
        style={{ background: 'rgba(22, 192, 152, 0.15)', color: '#008767' }}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
      style={{ background: '#FFF0F0', color: '#DF0404' }}>
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      Inactive
    </span>
  )
}

function Sidebar() {
  return (
    <aside className="crm-sidebar">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 px-2 mb-8">
        <div className="w-9 h-9 rounded-xl bg-crm-purple flex items-center justify-center">
          <Zap className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-base font-bold text-[#292D32] leading-none">AgentFlow</div>
          <div className="text-[10px] text-[#9197B3] uppercase tracking-wide">Dashboard</div>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map(({ icon: Icon, label, href, active }) => (
          <Link key={label} href={href}
            className={`sidebar-item relative ${active ? 'active' : ''}`}>
            {active && <span className="indicator" />}
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span>{label}</span>
            {active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-40" />}
          </Link>
        ))}
      </nav>

      {/* Promo card */}
      <div className="mx-2 rounded-2xl overflow-hidden mt-6"
        style={{ background: 'linear-gradient(135deg, #5932EA, #7C5AFF)' }}>
        <div className="p-4 text-center">
          <Crown className="w-8 h-8 text-yellow-300 mx-auto mb-2" />
          <p className="text-white text-xs font-bold mb-1">Get Pro Now!</p>
          <p className="text-white/70 text-[11px] mb-3">70% off Special offer</p>
          <button className="w-full py-2 bg-white text-[#5932EA] text-xs font-bold rounded-xl">
            Get Now
          </button>
        </div>
      </div>

      {/* User */}
      <div className="flex items-center gap-2.5 px-2 mt-6 pt-4 border-t border-[#EEEEEE]">
        <div className="w-8 h-8 rounded-full bg-crm-purple flex items-center justify-center text-white text-xs font-bold">OA</div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-[#292D32] truncate">Owner Agent</div>
          <div className="text-[10px] text-[#9197B3] truncate">0x8904...0407</div>
        </div>
      </div>
    </aside>
  )
}

// ---- MAIN PAGE ----
export default function CRMPage() {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('Newest')
  const [page, setPage] = useState(1)

  const filtered = CUSTOMERS.filter(c =>
    search === '' ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="crm-layout" style={{ fontFamily: "'Poppins', sans-serif" }}>
      <Sidebar />

      <main className="crm-main overflow-hidden">
        {/* Top header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#292D32]">Hello, Evano 👋</h1>
            <p className="text-[#9197B3] text-sm">Your AI marketplace dashboard at a glance</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9197B3]" />
              <input
                className="pl-9 pr-4 py-2 text-sm bg-white border border-[#EEEEEE] rounded-xl focus:outline-none focus:border-[#5932EA] transition-colors w-48"
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-white border border-[#EEEEEE] rounded-xl cursor-pointer text-sm text-[#9197B3]">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M3 4h18M7 8h10M10 12h4" />
              </svg>
              <span>Filter</span>
            </div>
            <Link href="/dashboard"
              className="flex items-center gap-1.5 px-4 py-2 bg-[#5932EA] text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
              <Bot className="w-4 h-4" />
              Launch Agents
            </Link>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-5">
          {[
            {
              label: 'Total Agents',
              value: '256K',
              change: '+16%',
              icon: <Users className="w-6 h-6" />,
              iconBg: 'rgba(255, 218, 68, 0.2)',
              iconColor: '#EAB308',
            },
            {
              label: 'Tasks Completed',
              value: '2,300',
              change: '+1%',
              icon: <TrendingUp className="w-6 h-6" />,
              iconBg: 'rgba(99, 102, 241, 0.15)',
              iconColor: '#6366F1',
            },
            {
              label: 'Active Now',
              value: '3',
              change: '0%',
              icon: <Bot className="w-6 h-6" />,
              iconBg: 'rgba(16, 185, 129, 0.15)',
              iconColor: '#10B981',
            },
          ].map(({ label, value, change, icon, iconBg, iconColor }) => (
            <div key={label} className="crm-stat-card">
              <div className="crm-stat-icon" style={{ background: iconBg }}>
                <span style={{ color: iconColor }}>{icon}</span>
              </div>
              <div className="flex-1">
                <p className="text-[#9197B3] text-xs font-medium mb-1">{label}</p>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-[#292D32]">{value}</span>
                  <span className="flex items-center gap-0.5 text-xs font-medium text-emerald-600">
                    <ArrowUpRight className="w-3 h-3" />
                    {change}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Agents Mini Cards */}
        <div className="grid grid-cols-3 gap-4">
          {AGENTS_DATA.map(agent => (
            <div key={agent.id} className="crm-stat-card">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ background: agent.color }}>
                {agent.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#292D32] truncate">{agent.name}</p>
                <p className="text-xs text-[#9197B3] capitalize">{agent.role}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <div className="flex items-center gap-1">
                    <Star className="w-3 h-3 text-amber-400 fill-current" />
                    <span className="text-xs font-semibold text-[#292D32]">{agent.rep}</span>
                  </div>
                  <span className="text-xs text-[#9197B3]">{agent.tasks} tasks</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Customer Table */}
        <div className="crm-table-card flex-1 flex flex-col">
          {/* Table header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-[#292D32]">All Customers</h2>
              <p className="text-xs text-[#9197B3]">Active Members</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#B5B7C0]" />
                <input
                  className="pl-8 pr-4 py-1.5 text-xs bg-[#F9FBFF] border border-[#EEEEEE] rounded-lg focus:outline-none focus:border-[#5932EA] w-44"
                  placeholder="Search..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[#EEEEEE] rounded-lg cursor-pointer text-xs text-[#9197B3]">
                Sort by: <span className="text-[#292D32] font-medium ml-1">{sortBy}</span>
                <ChevronDown className="w-3 h-3 ml-1" />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-[#EEEEEE]">
                  {['Customer Name', 'Company', 'Phone Number', 'Email', 'Country', 'Status'].map(h => (
                    <th key={h} className="pb-3 text-xs font-medium text-[#B5B7C0] whitespace-nowrap pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={c.email} className="border-b border-[#EEEEEE] hover:bg-[#F9FBFF] transition-colors group">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.name} index={i} />
                        <span className="text-sm font-medium text-[#292D32] whitespace-nowrap">{c.name}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-sm text-[#292D32]">{c.company}</td>
                    <td className="py-3 pr-4 text-sm text-[#292D32] whitespace-nowrap">{c.phone}</td>
                    <td className="py-3 pr-4 text-sm text-[#292D32]">{c.email}</td>
                    <td className="py-3 pr-4 text-sm text-[#292D32]">{c.country}</td>
                    <td className="py-3">
                      <StatusBadge active={c.active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-5 pt-4 border-t border-[#EEEEEE]">
            <p className="text-xs text-[#B5B7C0]">
              Showing data 1 to {filtered.length} of <strong className="text-[#292D32]">256K</strong> entries
            </p>
            <div className="flex items-center gap-1.5">
              <button className="crm-pagination-btn" onClick={() => setPage(Math.max(1, page - 1))}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              {[1, 2, 3, 4].map(p => (
                <button
                  key={p}
                  className={`crm-pagination-btn ${page === p ? 'active' : ''}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ))}
              <span className="text-[#B5B7C0] px-1">...</span>
              <button className="crm-pagination-btn" onClick={() => setPage(Math.min(40, page + 1))}>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Quick nav to AgentFlow */}
        <div className="rounded-2xl p-5 border border-[#EEEEEE] bg-gradient-to-r from-[#F0F0FF] to-white flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-[#292D32] mb-1">Try AgentFlow Dashboard</h3>
            <p className="text-xs text-[#9197B3]">Submit a task and watch AI agents bid and execute in real-time</p>
          </div>
          <Link href="/dashboard"
            className="flex items-center gap-2 px-5 py-2.5 bg-[#5932EA] text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors whitespace-nowrap">
            <Zap className="w-4 h-4" />
            Open AgentFlow
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </main>
    </div>
  )
}
