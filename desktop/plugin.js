/** OpenCode Usage Meter v0.1.2 — live OpenCode Go usage windows in Hermes Desktop. */
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

/** OpenCode brand mark — official favicon "O" glyph at 14x16, recolored via currentColor. */
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

function formatReset(epochSeconds) {
  const value = Number(epochSeconds)
  if (!Number.isFinite(value) || value <= 0) return 'Reset time unavailable'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date(value * 1000))
}

function Gauge({ remaining }) {
  const value = clampPercent(remaining)
  return jsx('div', {
    className: 'h-1.5 overflow-hidden rounded-full bg-(--ui-fill-secondary)',
    children: jsx('div', {
      className: 'h-full rounded-full bg-(--ui-accent) transition-[width]',
      style: { width: `${value}%` }
    })
  })
}

function UsageRow({ window }) {
  return jsxs('div', {
    className: 'space-y-1.5',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-4 text-xs',
        children: [
          jsx('span', { className: 'text-(--ui-text-secondary)', children: window.label }),
          jsx('strong', { className: 'font-medium text-(--ui-text-primary)', children: `${Math.round(window.remainingPercent)}% left` })
        ]
      }),
      jsx(Gauge, { remaining: window.remainingPercent }),
      jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: `Resets ${formatReset(window.resetsAt)}` })
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
  const query = useQuery({
    queryKey: [ID, 'usage'],
    queryFn: () => rest('/usage', { timeoutMs: 20000 }),
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 1
  })
  const data = query.data
  const windows = Array.isArray(data?.windows) ? data.windows : []
  const remaining = windows.length ? Math.min(...windows.map(item => clampPercent(item.remainingPercent))) : null
  const stale = data?.fetchedAt ? Date.now() - data.fetchedAt > 180_000 : false
  const label = query.isError
    ? 'OpenCode —'
    : remaining == null
      ? 'OpenCode …'
      : `OpenCode ${Math.round(remaining)}%`
  const tone = query.isError || stale || (remaining != null && remaining <= 20)
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
          children: jsxs('button', {
            type: 'button',
            className: `inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] ${tone} hover:text-(--ui-text-primary)`,
            title: query.isError ? 'OpenCode usage unavailable' : 'Hover or click for OpenCode usage windows',
            children: [jsx(OpenCodeMark, {}), label]
          })
        }),
        jsx(PopoverContent, {
          align: 'end',
          sideOffset: 6,
          onMouseEnter: keepOpen,
          onMouseLeave: closeSoon,
          className: 'relative w-80 overflow-hidden space-y-3 p-3',
          children: query.isError
            ? jsxs('div', {
                className: 'space-y-1 text-xs',
                children: [
                  jsx('div', { className: 'font-medium text-(--ui-warning)', children: 'OpenCode usage unavailable' }),
                  jsx('div', { className: 'text-(--ui-text-tertiary)', children: query.error?.message || 'Refresh will retry automatically.' })
                ]
              })
            : jsxs('div', {
                className: 'space-y-3',
                children: [
                  jsxs('div', {
                    className: 'flex items-center justify-between',
                    children: [
                      jsx('div', { className: 'text-xs font-medium', children: 'OpenCode limits' }),
                      jsx('div', { className: 'text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: data?.planType || 'GO' })
                    ]
                  }),
                  ...windows.map(item => jsx(UsageRow, { window: item }, item.key)),
                  stale ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-warning)', children: 'Data is stale; retrying automatically.' }) : null
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
