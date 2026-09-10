/** OpenCode Usage Meter v0.1.4-iris — Go usage ($ + pacing) + soldes autres comptes, layout uniforme. */
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

/** En-tête de section : titre à gauche, badge discret à droite. */
function SectionHeader({ title, badge }) {
  return jsxs('div', {
    className: 'flex items-center justify-between',
    children: [
      jsx('div', { className: 'text-xs font-medium', children: title }),
      badge ? jsx('div', { className: 'text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: badge }) : null
    ]
  })
}

/** Ligne meta : petit texte gris aligné sous le label (jamais flottant). */
function MetaLine({ children }) {
  return jsx('div', { className: 'pl-0.5 text-[0.6875rem] leading-4 text-(--ui-text-quaternary)', children })
}

/**
 * Fenêtre Go : usage en dollars (cap fixe) + %, jauge restante, reset.
 *  5h        0,12 $ / 12,00 $ · 1 %
 *  ▓▓░░░░░░░░░░░░░░░░░░
 *  Reset jeu. 10 · 14:03
 */
function UsageRow({ window }) {
  const key = window.key.split('-')[0]
  const cap = CAPS[key] || null
  const usedPct = clampPercent(window.usedPercent)
  const usedUsd = cap ? cap * usedPct / 100 : null
  const low = 100 - usedPct <= 20
  return jsxs('div', {
    className: 'space-y-1',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-4 text-xs',
        children: [
          jsx('span', { className: 'text-(--ui-text-secondary)', children: LABELS[key] || window.label }),
          jsxs('strong', { className: 'font-medium text-(--ui-text-primary)', children: [
            usedUsd != null ? `${usd(usedUsd)} / ${usd(cap)}` : `${Math.round(usedPct)}\u00A0%`,
            usedUsd != null ? jsxs('span', { className: 'ml-1 font-normal text-(--ui-text-quaternary)', children: `${Math.round(usedPct)}\u00A0%` }) : null
          ] })
        ]
      }),
      jsx(Gauge, { remaining: window.remainingPercent, warning: low }),
      jsx(MetaLine, { children: `Reset ${formatReset(window.resetsAt)}` })
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
  return jsxs('div', {
    className: 'space-y-0.5 rounded-md bg-(--ui-fill-tertiary) p-2',
    children: [
      jsx('div', { className: 'text-[0.6875rem] font-medium text-(--ui-text-secondary)', children: `📅 Pacing · cible ${usd(target)}` }),
      jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-secondary)', children: `${verdict} ${verdictText}` }),
      jsx('div', {
        className: 'text-[0.6875rem] text-(--ui-text-tertiary)',
        children: margin >= 0
          ? `Projection : ${usd(projected)} → marge ${usd(margin)}`
          : `Projection : ${usd(projected)} → dépassement ${usd(Math.abs(margin))}`
      })
    ]
  })
}

/**
 * Autre compte : métrique unique = RESTANT, partout.
 *  Exa           9,21 $ / 10,00 $
 *  ▓▓▓▓▓▓░░░░░░░░░░░░░░
 *  Budget mensuel · 0,79 $ utilisés
 */
function ProviderRow({ name, data }) {
  if (!data || data.status === 'not_configured' || data.status === 'unavailable') return null
  const labels = { openrouter: 'OpenRouter', exa: 'Exa', kagi: 'Kagi', firecrawl: 'Firecrawl', tavily: 'Tavily' }
  if (data.status === 'error') {
    return jsxs('div', {
      className: 'space-y-1',
      children: [
        jsxs('div', {
          className: 'flex items-center justify-between gap-4 text-xs',
          children: [
            jsx('span', { className: 'text-(--ui-text-secondary)', children: labels[name] || name }),
            jsx('strong', { className: 'font-medium text-(--ui-warning)', title: data.error || '', children: '—' })
          ]
        }),
        jsx(MetaLine, { children: 'Indisponible' })
      ]
    })
  }
  let value = ''
  let remainingPct = null
  let meta = ''
  if (data.kind === 'balance') {
    value = usd(data.balance)
    meta = name === 'openrouter'
      ? `Mois ${usd(data.monthlyUsage)} · semaine ${usd(data.weeklyUsage)}`
      : 'Solde prépayé'
  } else if (data.kind === 'budget') {
    value = `${usd(data.remaining)} / ${usd(data.budget)}`
    remainingPct = data.budget ? 100 - 100 * data.spent / data.budget : null
    meta = `Budget mensuel · ${usd(data.spent)} utilisés`
  } else if (data.kind === 'credits') {
    value = `${nb(data.remaining)} / ${nb(data.total)}`
    remainingPct = data.usedPercent != null ? 100 - data.usedPercent : null
    meta = 'Crédits restants'
  } else if (data.kind === 'plan') {
    value = data.remaining != null ? `${nb(data.remaining)} / ${nb(data.limit)}` : nb(data.used)
    remainingPct = data.usedPercent != null ? 100 - data.usedPercent : null
    meta = `${data.plan || 'Plan'} · ${nb(data.used)} utilisés`
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
      remainingPct != null ? jsx(Gauge, { remaining: remainingPct }) : null,
      jsx(MetaLine, { children: meta })
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
  const providersUpdated = providers.dataUpdatedAt
    ? new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit' }).format(new Date(providers.dataUpdatedAt))
    : null

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
          className: 'relative w-80 space-y-3 p-3',
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
                    className: 'space-y-2',
                    children: [
                      jsx(SectionHeader, { title: 'Limites Go', badge: 'GO' }),
                      ...windows.map(item => jsx(UsageRow, { window: item }, item.key)),
                      monthly ? jsx(PacingCard, { window: monthly }) : null
                    ]
                  }),
                  jsx('div', { className: 'border-t border-(--ui-stroke-secondary)', role: 'separator' }),
                  jsxs('div', {
                    className: 'space-y-2',
                    children: [
                      jsx(SectionHeader, { title: 'Autres comptes', badge: providersUpdated ? `maj ${providersUpdated}` : null }),
                      providers.isError
                        ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-warning)', children: 'Soldes indisponibles' })
                        : providerNames.map(name => jsx(ProviderRow, { name, data: providerData[name] }, name))
                    ]
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
