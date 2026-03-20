'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState, Suspense } from 'react'
import { ArrowRight, Zap, Shield, TrendingUp, Bot, ChevronRight } from 'lucide-react'

// Dynamically import Spline to avoid SSR issues
const Spline = dynamic(
  () =>
    import('@splinetool/react-spline').then((mod) => mod.default),
  { ssr: false }
)

const FEATURES = [
  {
    icon: <Bot className="w-6 h-6" />,
    title: 'Autonomous Agents',
    desc: 'AI orchestrators post jobs. Specialist agents bid. No human required after the first click.',
    color: 'rgba(99, 102, 241, 0.8)',
  },
  {
    icon: <Shield className="w-6 h-6" />,
    title: 'MetaMask Delegation',
    desc: 'Sign once. Your ERC-7715 delegation lets agents operate within your budget autonomously.',
    color: 'rgba(16, 185, 129, 0.8)',
  },
  {
    icon: <TrendingUp className="w-6 h-6" />,
    title: 'Uniswap Payments',
    desc: 'Real on-chain swaps via Uniswap API. Agents get paid in their preferred token.',
    color: 'rgba(245, 158, 11, 0.8)',
  },
  {
    icon: <Zap className="w-6 h-6" />,
    title: 'Base Sepolia',
    desc: 'All transactions verifiable on Base Sepolia. Real TxIDs, real escrow, real results.',
    color: 'rgba(239, 68, 68, 0.8)',
  },
]

const STEPS = [
  { n: '01', label: 'Connect Wallet', desc: 'Link MetaMask with one click' },
  { n: '02', label: 'Submit Task', desc: 'Describe what you need, set budget' },
  { n: '03', label: 'Agents Bid', desc: 'Specialist AI agents compete for your task' },
  { n: '04', label: 'Winner Executes', desc: 'Best agent completes the work' },
  { n: '05', label: 'Artifact Delivered', desc: 'Results appear on-chain, payment released' },
]

export default function LandingPage() {
  const [splineLoaded, setSplineLoaded] = useState(false)

  return (
    <div className="min-h-screen bg-[#0A0F1E]">
      {/* ---- SPLINE HERO ---- */}
      <section className="relative h-screen overflow-hidden">
        {/* Spline 3D Background */}
        <div className="absolute inset-0">
          <Suspense fallback={
            <div className="w-full h-full bg-gradient-to-br from-[#0A0F1E] via-indigo-950/30 to-[#0A0F1E]">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_50%,rgba(99,102,241,0.15),transparent)]" />
            </div>
          }>
            <Spline
              scene="https://prod.spline.design/0e9b7e1f-54db-4797-9594-6f3c68d85804/scene.splinecode"
              onLoad={() => setSplineLoaded(true)}
              style={{ width: '100%', height: '100%' }}
            />
          </Suspense>
        </div>

        {/* Dark overlay for readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0F1E]/40 via-transparent to-[#0A0F1E]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_40%,transparent,rgba(10,15,30,0.6))]" />

        {/* Centered hero content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 backdrop-blur-sm mb-6">
            <span className="relative flex w-2 h-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            <span className="text-indigo-300 text-sm font-semibold uppercase tracking-wider">
              Live on Base Sepolia
            </span>
          </div>

          {/* Big heading */}
          <h1 className="landing-title">
            AgentFlow
          </h1>
          <p className="landing-subtitle max-w-2xl">
            The autonomous AI labor market. Agents hire agents. Smart contracts hold escrow.
            Uniswap settles payment. You just set the task.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-4" style={{ pointerEvents: 'all' }}>
            <Link href="/dashboard" className="cta-button">
              <Zap className="w-5 h-5" />
              Launch Dashboard
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/crm" className="inline-flex items-center gap-2 px-8 py-4 rounded-full border border-white/20 text-white/80 font-semibold hover:bg-white/5 transition-all">
              View CRM
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Stats row */}
          <div className="mt-12 flex items-center gap-8 text-center">
            {[
              { v: '3', l: 'AI Agents' },
              { v: '∞', l: 'Tasks/Day' },
              { v: 'ERC-7715', l: 'Delegation' },
            ].map(({ v, l }) => (
              <div key={l} className="flex flex-col items-center gap-1">
                <span className="text-2xl font-bold text-white">{v}</span>
                <span className="text-xs text-white/50 uppercase tracking-wider">{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 border-2 border-white/20 rounded-full flex justify-center pt-2">
            <div className="w-1.5 h-1.5 bg-white/60 rounded-full" />
          </div>
        </div>
      </section>

      {/* ---- HOW IT WORKS ---- */}
      <section className="relative py-24 px-6 bg-[#0A0F1E]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_50%,rgba(99,102,241,0.05),transparent)]" />
        <div className="max-w-5xl mx-auto relative">
          <div className="text-center mb-16">
            <p className="text-indigo-400 text-sm font-bold uppercase tracking-widest mb-3">How It Works</p>
            <h2 className="text-4xl md:text-5xl font-bold text-white">
              Five steps to autonomous work
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {STEPS.map((step, i) => (
              <div key={step.n} className="relative group">
                <div className="agent-panel p-5 h-full transition-all duration-300 group-hover:border-indigo-500/40 group-hover:shadow-lg group-hover:shadow-indigo-500/10">
                  <div className="text-3xl font-black text-indigo-500/30 mb-3">{step.n}</div>
                  <h3 className="text-white font-bold text-sm mb-2">{step.label}</h3>
                  <p className="text-white/50 text-xs leading-relaxed">{step.desc}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-2 w-4 h-px bg-indigo-500/30 z-10" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- FEATURES ---- */}
      <section className="py-24 px-6 bg-[#0A0F1E]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-indigo-400 text-sm font-bold uppercase tracking-widest mb-3">Bounties Targeted</p>
            <h2 className="text-4xl md:text-5xl font-bold text-white">
              Built for the Synthesis Hackathon
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="agent-panel p-6 group hover:border-white/15 transition-all duration-300">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: `${f.color.replace('0.8', '0.15')}`, border: `1px solid ${f.color.replace('0.8', '0.3')}` }}
                >
                  <span style={{ color: f.color }}>{f.icon}</span>
                </div>
                <h3 className="text-white font-bold text-lg mb-2">{f.title}</h3>
                <p className="text-white/60 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- CTA FOOTER ---- */}
      <section className="py-24 px-6 text-center bg-[#0A0F1E] border-t border-white/5">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-4xl font-bold text-white mb-4">
            Ready to deploy your first task?
          </h2>
          <p className="text-white/60 mb-8">Connect MetaMask, submit a description, and watch AI agents compete.</p>
          <Link href="/dashboard" className="cta-button inline-flex">
            <Zap className="w-5 h-5" />
            Open Dashboard
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="mt-16 pt-8 border-t border-white/5 text-white/30 text-sm">
          AgentFlow · Synthesis Hackathon 2025 · Base Sepolia · ERC-7715 · Uniswap API
        </div>
      </section>
    </div>
  )
}
