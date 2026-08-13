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

// Lightweight i18n: zh-CN when the UI language is Chinese, English otherwise.
const ZH = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('zh')
const t = (en, zh) => (ZH ? zh : en)
const LABEL_ZH = { 'Rolling limit': '滚动限额', 'Weekly limit': '每周限额', 'Monthly limit': '每月限额' }
const ERR_ZH = { 'OpenCode usage is temporarily unavailable.': 'OpenCode 用量暂时不可用。' }

function clampPercent(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0
}

function formatReset(epochSeconds) {
  const value = Number(epochSeconds)
  if (!Number.isFinite(value) || value <= 0) return t('Reset time unavailable', '重置时间不可用')
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
          jsx('span', { className: 'text-(--ui-text-secondary)', children: LABEL_ZH[window.label] || window.label }),
          jsx('strong', { className: 'font-medium text-(--ui-text-primary)', children: `${Math.round(window.remainingPercent)}% ${t('left', '剩余')}` })
        ]
      }),
      jsx(Gauge, { remaining: window.remainingPercent }),
      jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: `${t('Resets', '重置于')} ${formatReset(window.resetsAt)}` })
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
            title: query.isError ? t('OpenCode usage unavailable', 'OpenCode 用量不可用') : t('Hover or click for OpenCode usage windows', '悬停或点击查看 OpenCode 用量窗口'),
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
                  jsx('div', { className: 'font-medium text-(--ui-warning)', children: t('OpenCode usage unavailable', 'OpenCode 用量不可用') }),
                  jsx('div', { className: 'text-(--ui-text-tertiary)', children: ERR_ZH[query.error?.message] || query.error?.message || t('Refresh will retry automatically.', '刷新将自动重试。') })
                ]
              })
            : jsxs('div', {
                className: 'space-y-3',
                children: [
                  jsxs('div', {
                    className: 'flex items-center justify-between',
                    children: [
                      jsx('div', { className: 'text-xs font-medium', children: t('OpenCode limits', 'OpenCode 限额') }),
                      jsx('div', { className: 'text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: data?.planType || 'GO' })
                    ]
                  }),
                  ...windows.map(item => jsx(UsageRow, { window: item }, item.key)),
                  stale ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-warning)', children: t('Data is stale; retrying automatically.', '数据已过期，正在自动重试。') }) : null
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
