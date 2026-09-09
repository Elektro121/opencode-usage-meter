/** OpenCode Usage Meter v0.1.3-iris — Go usage ($ + pacing) + soldes autres comptes (OpenRouter, Exa, Kagi, Firecrawl, Tavily). */
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  STATUSBAR_AREAS,
  useQuery
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useRef, useState } from 'react'

const ID = 'opencode-usage-meter'
let rest

/** Caps Go (USD) : 5h / semaine / mois. */
const CAPS = { rolling: 12, weekly: 30, monthly: 60 }
const LABELS = { rolling: '5h', weekly: 'Semaine', monthly: 'Mois' }

function OpenCodeMark() {
  return jsx('svg', {
    viewBox: '0 0 14 16',
    className: 'shrink-0',
    style: { width: '0.8125rem', height: '0.8125rem' },
    fill: 'currentColor',
    'aria-hidden': true,
    children: jsx('path', {
      fillRule: 'evenodd',
      d: 'M13.4 16H0.6V0H13.4V16ZM10.2 12.8H3.8V3.2H10.2V12.8Z'
    })
  })
}

function clampPercent(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0
}

function usd(value) {
  return `${Number(value).toFixed(2).replace('.', ',')}\u00A0$`
}

function nb(value) {
  return Math.round(Number(value)).toLocaleString('fr-FR')
}

function formatReset(epochSeconds) {
  const value = Number(epochSeconds)
  if (!Number.isFinite(value) || value <= 0) return 'reset inconnu'
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date(value * 1000))
}

function Gauge({ remaining, warning }) {
  const value = clampPercent(remaining)
  return jsx('div', {
    className: 'h-1.5 overflow-hidden rounded-full bg-(--ui-fill-secondary)',
    children: jsx('div', {
      className: 'h-full rounded-full transition-[width]',
      style: {
        width: `${value}%`,
        background: warning ? 'var(--ui-warning)' : 'var(--ui-accent)'
      }
    })
  })
}

/** Fenêtre OpenCode en dollars (cap fixe). */
function UsageRow({ window }) {
  const cap = CAPS[window.key.split('-')[0]] || null
  const usedPct = clampPercent(window.usedPercent)
  const usedUsd = cap ? cap * usedPct / 100 : null
  const low = 100 - usedPct <= 20
  return jsxs('div', {
    className: 'space-y-1.5',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-4 text-xs',
        children: [
          jsx('span', { className: 'text-(--ui-text-secondary)', children: LABELS[window.key.split('-')[0]] || window.label }),
          jsx('strong', {
            className: 'font-medium text-(--ui-text-primary)',
            children: usedUsd != null ? `${usd(usedUsd)} / ${usd(cap)}` : `${Math.round(usedPct)}% utilisés`
          })
        ]
      }),
      jsx(Gauge, { remaining: window.remainingPercent, warning: low }),
      jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: `Reset ${formatReset(window.resetsAt)}` })
    ]
  })
}

/** Pacing mensuel Go : fenêtre 30 j glissante dérivée de resetsAt (jamais le calendrier civil). */
function PacingCard({ window }) {
  const cap = CAPS.monthly
  const used = clampPercent(window.usedPercent) * cap / 100
  const resetInSec = Number(window.resetsAt) - Date.now() / 1000
  if (!Number.isFinite(resetInSec) || resetInSec <= 0) {
    return jsx('div', { className: 'rounded-md bg-(--ui-fill-tertiary) p-2 text-[0.6875rem] text-(--ui-text-secondary)', children: '📅 Fenêtre mensuelle sur le point de se réinitialiser.' })
  }
  const daysLeft = resetInSec / 86400
  const daysElapsed = Math.max(0.25, 30 - daysLeft)
  const target = cap * daysElapsed / 30
  const delta = used - target
  const projected = used / daysElapsed * 30
  const margin = cap - projected
  const verdict = delta > 1 ? '🔴' : delta < -1 ? '🟢' : '🟡'
  const verdictText = delta > 1 ? `en avance de ${usd(Math.abs(delta))}` : delta < -1 ? `sous l'objectif de ${usd(Math.abs(delta))}` : 'dans le rythme'
  const lines = [
    `📅 Pacing : ${verdict} ${verdictText} (cible ${usd(target)})`,
    margin >= 0
      ? `Projection fin de fenêtre : ${usd(projected)} → marge ${usd(margin)}`
      : `Projection fin de fenêtre : ${usd(projected)} → dépassement ${usd(Math.abs(margin))}`
  ]
  return jsxs('div', {
    className: 'space-y-0.5 rounded-md bg-(--ui-fill-tertiary) p-2 text-[0.6875rem] text-(--ui-text-secondary)',
    children: lines.map((line, index) => jsx('div', { children: line }, index))
  })
}

/** Une ligne par autre compte, selon le kind renvoyé par /providers. */
function ProviderRow({ name, data }) {
  if (!data || data.status === 'not_configured' || data.status === 'unavailable') return null
  if (data.status === 'error') {
    return jsxs('div', {
      className: 'flex items-center justify-between gap-4 text-xs',
      children: [
        jsx('span', { className: 'text-(--ui-text-secondary)', children: name }),
        jsx('span', { className: 'text-(--ui-warning)', title: data.error || '', children: '—' })
      ]
    })
  }
  const labels = {
    openrouter: 'OpenRouter',
    exa: 'Exa',
    kagi: 'Kagi',
    firecrawl: 'Firecrawl',
    tavily: 'Tavily'
  }
  let value = ''
  let percent = null
  let subline = ''
  if (data.kind === 'balance') {
    value = usd(data.balance)
    if (name === 'openrouter' && Number(data.monthlyUsage) > 0) subline = `Mois ${usd(data.monthlyUsage)}`
  } else if (data.kind === 'budget') {
    value = `${usd(data.remaining)} / ${usd(data.budget)}`
    percent = data.budget ? 100 * data.spent / data.budget : null
  } else if (data.kind === 'credits') {
    value = `${nb(data.remaining)} / ${nb(data.total)}`
    percent = data.usedPercent
  } else if (data.kind === 'plan') {
    value = data.limit != null ? `${nb(data.used)} / ${nb(data.limit)}` : nb(data.used)
    percent = data.usedPercent
    subline = data.plan || ''
  }
  return jsxs('div', {
    className: 'space-y-1',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-4 text-xs',
        children: [
          jsx('span', { className: 'text-(--ui-text-secondary)', children: labels[name] || name }),
          jsx('strong', { className: 'font-medium text-(--ui-text-primary)', children: value })
        ]
      }),
      percent != null ? jsx(Gauge, { remaining: 100 - percent }) : null,
      subline ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: subline }) : null
    ]
  })
}

function UsageMeter() {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef(null)
  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setOpen(true)
  }
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 70)
  }
  const usage = useQuery({
    queryKey: [ID, 'usage'],
    queryFn: () => rest('/usage', { timeoutMs: 20000 }),
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 1
  })
  const providers = useQuery({
    queryKey: [ID, 'providers'],
    queryFn: () => rest('/providers', { timeoutMs: 20000 }),
    refetchInterval: 120_000,
    staleTime: 90_000,
    retry: 1
  })
  const data = usage.data
  const windows = Array.isArray(data?.windows) ? data.windows : []
  const remaining = windows.length ? Math.min(...windows.map(item => clampPercent(item.remainingPercent))) : null
  const monthly = windows.find(item => item.key.startsWith('monthly'))
  const providerData = providers.data && typeof providers.data === 'object' ? providers.data : {}
  const providerNames = ['openrouter', 'exa', 'kagi', 'firecrawl', 'tavily']
  const label = usage.isError
    ? 'OpenCode —'
    : remaining == null
      ? 'OpenCode …'
      : `Go ${Math.round(remaining)}%`
  const tone = usage.isError || (remaining != null && remaining <= 20)
    ? 'text-(--ui-warning)'
    : 'text-(--ui-text-tertiary)'

  return jsx(Popover, {
    open,
    onOpenChange: setOpen,
    children: jsxs('div', {
      onMouseEnter: keepOpen,
      onMouseLeave: closeSoon,
      children: [
        jsx(PopoverTrigger, {
          asChild: true,
          children: jsx('button', {
            type: 'button',
            className: `inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] ${tone} hover:text-(--ui-text-primary)`,
            title: usage.isError ? 'OpenCode indisponible' : 'Usage Go + soldes des autres comptes',
            children: [jsx(OpenCodeMark, {}), label]
          })
        }),
        jsx(PopoverContent, {
          align: 'end',
          sideOffset: 6,
          onMouseEnter: keepOpen,
          onMouseLeave: closeSoon,
          className: 'relative w-80 overflow-hidden space-y-3 p-3',
          children: usage.isError
            ? jsxs('div', {
                className: 'space-y-1 text-xs',
                children: [
                  jsx('div', { className: 'font-medium text-(--ui-warning)', children: 'OpenCode indisponible' }),
                  jsx('div', { className: 'text-(--ui-text-tertiary)', children: usage.error?.message || 'Nouvel essai automatique.' })
                ]
              })
            : jsxs('div', {
                className: 'space-y-3',
                children: [
                  jsxs('div', {
                    className: 'flex items-center justify-between',
                    children: [
                      jsx('div', { className: 'text-xs font-medium', children: 'Limites Go' }),
                      jsx('div', { className: 'text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: 'GO' })
                    ]
                  }),
                  ...windows.map(item => jsx(UsageRow, { window: item }, item.key)),
                  monthly ? jsx(PacingCard, { window: monthly }) : null,
                  jsxs('div', {
                    className: 'space-y-2',
                    children: [
                      jsx('div', { className: 'text-xs font-medium', children: 'Autres comptes' }),
                      providers.isError
                        ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-warning)', children: 'Soldes indisponibles' })
                        : providerNames.map(name => jsx(ProviderRow, { name, data: providerData[name] }, name))
                    ]
                  }),
                  jsxs('div', {
                    className: 'text-[0.625rem] text-(--ui-text-quaternary)',
                    children: ['Soldes rafraîchis toutes les 2 min · ', providers.dataUpdatedAt ? new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit' }).format(new Date(providers.dataUpdatedAt)) : '—']
                  })
                ]
              })
        })
      ]
    })
  })
}

export default {
  id: ID,
  name: 'OpenCode Usage Meter',
  register(ctx) {
    rest = ctx.rest
    ctx.register({
      id: 'status',
      area: STATUSBAR_AREAS.right,
      order: 113,
      render: () => jsx(UsageMeter, {})
    })
  }
}
