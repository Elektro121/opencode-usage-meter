/** OpenCode Usage Meter v0.2.0 — OpenCodex visual language, account-level windows. */
import { Popover, PopoverContent, PopoverTrigger, STATUSBAR_AREAS, useQuery } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useRef, useState } from 'react'

const ID = 'opencode-usage-meter'
const PINNED_WINDOW_KEY = `${ID}:pinned-window`
const SHOW_STATUS_LABELS_KEY = `${ID}:show-status-labels`
let rest

const CSS = `
.ocg-panel{width:296px;max-height:min(680px,calc(100vh - 56px));overflow-y:auto;scrollbar-width:none;color:var(--ui-text-primary);font-size:12.5px;line-height:1.42}
.ocg-panel::-webkit-scrollbar{display:none}
.ocg-panel *{box-sizing:border-box}
.ocg-shell{padding:12px 14px}
.ocg-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.ocg-brand{display:flex;min-width:0;align-items:center;gap:7px;font-size:12.5px;font-weight:600}
.ocg-source{display:flex;align-items:center;gap:5px;color:var(--ui-text-quaternary);font-size:10px;font-weight:400;white-space:nowrap}
.ocg-dot{width:6px;height:6px;border-radius:999px;background:var(--ui-success,var(--ui-green))}
.ocg-dot.stale{background:var(--ui-yellow)}
.ocg-header-actions{display:flex;align-items:center;gap:4px;color:var(--ui-text-quaternary)}
.ocg-label-toggle{display:grid;min-width:20px;height:19px;place-items:center;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--ui-text-quaternary);font-size:8.5px;font-weight:650;cursor:pointer}
.ocg-label-toggle:hover{border-color:var(--ui-stroke-tertiary);background:var(--ui-control-hover-background);color:var(--ui-text-primary)}
.ocg-label-toggle.is-active{border-color:var(--ui-stroke-secondary);background:var(--ui-bg-quaternary);color:var(--ui-accent-secondary)}
.ocg-refresh{display:grid;width:19px;height:19px;place-items:center;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--ui-text-tertiary);cursor:pointer}
.ocg-refresh:hover{border-color:var(--ui-stroke-tertiary);background:var(--ui-control-hover-background);color:var(--ui-text-primary)}
.ocg-refresh:disabled{cursor:default;opacity:.45}
.ocg-refresh.is-loading svg{animation:ocg-spin .8s linear infinite}
@keyframes ocg-spin{to{transform:rotate(360deg)}}
.ocg-focus-main{display:flex;align-items:flex-end;justify-content:space-between;gap:10px}
.ocg-focus-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ui-text-primary);font-size:13px;font-weight:600}
.ocg-focus-context{margin-top:2px;color:var(--ui-text-tertiary);font-size:9.5px;font-weight:400}
.ocg-focus-number{display:flex;flex-shrink:0;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums}
.ocg-focus-number strong{font-size:22px;line-height:1;font-weight:650;letter-spacing:-.02em}
.ocg-focus-number span{color:var(--ui-text-tertiary);font-size:10px}
.ocg-gauge{height:4px;margin-top:10px;overflow:hidden;border-radius:999px;background:var(--ui-bg-primary)}
.ocg-gauge-fill{height:100%;border-radius:999px;transition:width .25s ease}
.ocg-focus-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;color:var(--ui-text-tertiary);font-size:10px}
.ocg-window-switch{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.ocg-window-chip{display:inline-flex;align-items:center;height:18px;padding:0 7px;border:1px solid var(--ui-stroke-secondary);border-radius:999px;background:transparent;color:var(--ui-text-tertiary);font-size:9.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.ocg-window-chip:hover{border-color:var(--ui-stroke-primary);color:var(--ui-text-primary)}
.ocg-window-chip.is-active{border-color:var(--ui-accent-secondary);background:var(--ui-bg-quaternary);color:var(--ui-accent-secondary);font-weight:600}
.ocg-window-list{margin-top:8px}
.ocg-window-row{padding:9px 0;border-bottom:1px solid var(--ui-stroke-quaternary)}
.ocg-window-row:last-child{border-bottom:0;padding-bottom:0}
.ocg-window-row:first-child{padding-top:6px}
.ocg-window-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.ocg-window-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600}
.ocg-window-value{display:flex;flex-shrink:0;align-items:baseline;gap:3px;font-variant-numeric:tabular-nums}
.ocg-window-value strong{font-size:13px;font-weight:650}
.ocg-window-value span{color:var(--ui-text-quaternary);font-size:9px}
.ocg-window-row .ocg-gauge{height:3px;margin-top:6px}
.ocg-window-meta{margin-top:4px;color:var(--ui-text-quaternary);font-size:10px}
.ocg-note{margin-top:8px;color:var(--ui-yellow);font-size:9.5px}
.ocg-empty{padding:22px 8px;text-align:center;color:var(--ui-text-tertiary)}
.ocg-empty strong{display:block;margin-bottom:5px;color:var(--ui-text-secondary);font-size:12px}
.ocg-retry{margin-top:10px;padding:5px 9px;border:1px solid var(--ui-stroke-secondary);border-radius:6px;background:var(--ui-bg-secondary);color:var(--ui-text-secondary);font-size:10px;cursor:pointer}
.ocg-retry:hover{color:var(--ui-text-primary);border-color:var(--ui-stroke-primary)}
.ocg-skeleton{padding:14px}
.ocg-skeleton-line{height:8px;margin:8px 0;border-radius:999px;background:var(--ui-bg-secondary);animation:ocg-pulse 1.2s ease-in-out infinite alternate}
@keyframes ocg-pulse{to{opacity:.45}}
`

const CHIP_STYLE = {
  display: 'inline-flex',
  height: '100%',
  alignItems: 'center',
  gap: '5px',
  padding: '0 6px',
  border: 0,
  background: 'transparent',
  color: 'var(--ui-text-secondary)',
  cursor: 'pointer'
}

function OpenCodeMark({ size = 13 } = {}) {
  return jsx('svg', {
    viewBox: '0 0 14 16',
    style: { width: `${size}px`, height: `${size}px`, flexShrink: 0 },
    fill: 'currentColor',
    'aria-hidden': true,
    children: jsx('path', {
      fillRule: 'evenodd',
      d: 'M13.4 16H0.6V0H13.4V16ZM10.2 12.8H3.8V3.2H10.2V12.8Z'
    })
  })
}

function RefreshIcon() {
  return jsx('svg', {
    viewBox: '0 0 16 16',
    width: 10,
    height: 10,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    'aria-hidden': true,
    children: jsx('path', { d: 'M13.3 5.8A5.5 5.5 0 102.8 9.4M13.4 2.7v3.4H10' })
  })
}

const t = (_en, zh) => zh
const LABEL_ZH = { 'Rolling limit': '滚动限额', 'Weekly limit': '每周限额', 'Monthly limit': '每月限额' }
const ERR_ZH = { 'OpenCode usage is temporarily unavailable.': 'OpenCode 用量暂时不可用。' }

function clampPercent(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0
}

function readStoredValue(key, fallback) {
  try {
    const value = globalThis.localStorage?.getItem(key)
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

function writeStoredValue(key, value) {
  try { globalThis.localStorage?.setItem(key, value) } catch {}
}

function windowLabel(window) {
  return LABEL_ZH[window.label] || window.label
}

function windowChipLabel(window) {
  return windowLabel(window).replace(/限额$/, '')
}

function urgencyColor(remaining) {
  const value = clampPercent(remaining)
  if (value <= 10) return 'var(--ui-red)'
  if (value <= 25) return 'var(--ui-yellow)'
  return 'var(--ui-accent-secondary)'
}

function formatFetchedAt(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(number))
}

function resetInfo(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  const milliseconds = number < 100000000000 ? number * 1000 : number
  const delta = milliseconds - Date.now()
  const absolute = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(milliseconds))
  if (delta <= 0) return { relative: '即将重置', absolute }
  const totalMinutes = Math.ceil(delta / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const relative = days ? `${days}天${hours ? ` ${hours}小时` : ''}后` : hours ? `${hours}小时${minutes ? ` ${minutes}分` : ''}后` : `${minutes}分钟后`
  return { relative, absolute }
}

function Gauge({ remaining, label }) {
  const value = clampPercent(remaining)
  return jsx('div', {
    className: 'ocg-gauge',
    role: 'progressbar',
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round(value),
    children: jsx('div', { className: 'ocg-gauge-fill', style: { width: `${value}%`, background: urgencyColor(value) } })
  })
}

function EmptyState({ error, loading, onRetry }) {
  if (loading) return jsxs('div', { className: 'ocg-skeleton', children: [
    jsx('div', { className: 'ocg-skeleton-line', style: { width: '42%' } }),
    jsx('div', { className: 'ocg-skeleton-line', style: { width: '100%', height: '68px' } }),
    jsx('div', { className: 'ocg-skeleton-line', style: { width: '88%' } }),
    jsx('div', { className: 'ocg-skeleton-line', style: { width: '72%' } })
  ] })
  return jsxs('div', { className: 'ocg-empty', children: [
    jsx('strong', { children: error ? '暂时无法读取用量' : '没有可显示的额度' }),
    jsx('span', { children: error ? (ERR_ZH[error] || error || '已保留现有配置，可以立即重试。') : 'OpenCode 当前没有返回额度窗口。' }),
    jsx('button', { type: 'button', className: 'ocg-retry', onClick: onRetry, children: '重新读取' })
  ] })
}

function UsageMeter() {
  const [open, setOpen] = useState(false)
  const [pinnedWindow, setPinnedWindow] = useState(() => readStoredValue(PINNED_WINDOW_KEY, ''))
  const [showStatusLabels, setShowStatusLabels] = useState(() => readStoredValue(SHOW_STATUS_LABELS_KEY, 'true') === 'true')
  const closeTimer = useRef(null)
  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setOpen(true)
  }
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 180)
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
  const weeklyKey = windows.find(item => item.key.startsWith('weekly-'))?.key || null
  // Stored value is a window key, 'auto' (explicit auto choice), or '' (never chosen → default weekly).
  const storedChoice = readStoredValue(PINNED_WINDOW_KEY, '')
  const userPinned = storedChoice && storedChoice !== 'auto' && windows.some(item => item.key === storedChoice)
    ? storedChoice
    : null
  const userAuto = storedChoice === 'auto'
  const effectivePinned = userPinned || (userAuto ? null : weeklyKey)
  const orderedWindows = [...windows].sort((a, b) => {
    const rank = key => key.startsWith('weekly-') ? 0 : key.startsWith('rolling-') ? 1 : key.startsWith('monthly-') ? 2 : 3
    return rank(a.key) - rank(b.key)
  })
  const activePinnedWindow = effectivePinned && windows.some(item => item.key === effectivePinned)
    ? effectivePinned
    : null
  const selectedWindow = activePinnedWindow ? windows.find(item => item.key === activePinnedWindow) || null : null
  const statusWindow = selectedWindow || windows.reduce((lowest, item) => {
    if (!lowest) return item
    return clampPercent(item.remainingPercent) < clampPercent(lowest.remainingPercent) ? item : lowest
  }, null)
  const remaining = statusWindow ? clampPercent(statusWindow.remainingPercent) : null
  const stale = Boolean(data?.stale) || (data?.fetchedAt ? Date.now() - data.fetchedAt > 180_000 : false)
  const automatic = !activePinnedWindow
  const otherWindows = orderedWindows.filter(item => item.key !== statusWindow?.key)
  const plan = data?.planType || 'GO'
  const reset = resetInfo(statusWindow?.resetsAt)
  const toggleStatusLabels = () => {
    const next = !showStatusLabels
    setShowStatusLabels(next)
    writeStoredValue(SHOW_STATUS_LABELS_KEY, String(next))
  }
  const changePinnedWindow = next => {
    const value = next || 'auto'
    setPinnedWindow(value)
    writeStoredValue(PINNED_WINDOW_KEY, value)
  }
  const refresh = () => { query.refetch().catch(() => {}) }
  const hasData = Boolean(statusWindow)
  const chipTitle = query.isError
    ? t('OpenCode usage unavailable', 'OpenCode 用量不可用')
    : statusWindow
      ? `${automatic ? '自动' : '固定'}跟踪：${windowLabel(statusWindow)} ${Math.round(statusWindow.remainingPercent)}%`
      : t('Hover or click for OpenCode usage windows', '悬停或点击查看 OpenCode 用量窗口')

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
            style: CHIP_STYLE,
            title: chipTitle,
            children: [
              jsx(OpenCodeMark, { size: 13 }),
              query.isError
                ? jsx('strong', { style: { color: 'var(--ui-red)' }, children: '—' })
                : remaining == null
                  ? jsx('strong', { children: '…' })
                  : jsxs('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' }, children: [
                      showStatusLabels ? jsx('span', { style: { color: 'var(--ui-text-secondary)', maxWidth: '88px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px' }, children: 'OpenCode' }) : null,
                      jsx('strong', { style: { color: urgencyColor(remaining), fontSize: '12px', lineHeight: 1, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }, children: `${Math.round(remaining)}%` })
                    ] })
            ]
          })
        }),
        jsx(PopoverContent, {
          align: 'end',
          sideOffset: 6,
          onMouseEnter: keepOpen,
          onMouseLeave: closeSoon,
          style: { width: '296px', padding: 0, overflow: 'hidden' },
          children: jsxs('div', { className: 'ocg-panel', children: [
            jsx('style', { children: CSS }),
            hasData
              ? jsxs('div', { className: 'ocg-shell', children: [
                  jsxs('header', { className: 'ocg-header', children: [
                    jsxs('div', { className: 'ocg-brand', children: [
                      jsx(OpenCodeMark, { size: 13 }),
                      jsx('span', { title: 'OpenCode Usage Meter v0.2.0', children: 'OpenCode 用量' }),
                      jsxs('span', { className: 'ocg-source', children: [
                        jsx('i', { className: `ocg-dot${stale ? ' stale' : ''}` }),
                        stale ? '缓存数据' : plan
                      ] })
                    ] }),
                    jsxs('div', { className: 'ocg-header-actions', children: [
                      jsx('span', { style: { fontSize: '10.5px' }, title: `最近成功读取：${formatFetchedAt(data.fetchedAt)}`, children: formatFetchedAt(data.fetchedAt) }),
                      jsx('button', {
                        type: 'button',
                        className: `ocg-label-toggle${showStatusLabels ? ' is-active' : ''}`,
                        onClick: toggleStatusLabels,
                        title: showStatusLabels ? '隐藏状态栏名称' : '显示状态栏名称',
                        'aria-label': showStatusLabels ? '隐藏状态栏名称' : '显示状态栏名称',
                        'aria-pressed': showStatusLabels,
                        children: 'Aa'
                      }),
                      jsx('button', {
                        type: 'button',
                        className: `ocg-refresh${query.isFetching ? ' is-loading' : ''}`,
                        onClick: refresh,
                        disabled: query.isFetching,
                        title: query.isFetching ? '正在读取' : '刷新数据',
                        'aria-label': query.isFetching ? '正在读取' : '刷新数据',
                        children: jsx(RefreshIcon, {})
                      })
                    ] })
                  ] }),
                  jsxs('div', { children: [
                    jsxs('div', { className: 'ocg-focus-main', children: [
                      jsxs('div', { style: { minWidth: 0 }, children: [
                        jsx('div', { className: 'ocg-focus-name', children: windowLabel(statusWindow) }),
                        jsx('div', { className: 'ocg-focus-context', children: plan })
                      ] }),
                      jsxs('div', { className: 'ocg-focus-number', children: [
                        jsx('strong', { style: { color: urgencyColor(statusWindow.remainingPercent) }, children: Math.round(statusWindow.remainingPercent) }),
                        jsx('span', { children: '%' })
                      ] })
                    ] }),
                    jsx(Gauge, { remaining: statusWindow.remainingPercent, label: `${windowLabel(statusWindow)}剩余额度` }),
                    jsxs('div', { className: 'ocg-focus-meta', children: [
                      jsx('span', { title: reset?.absolute, children: reset ? `${reset.relative}重置` : '重置时间不可用' }),
                      jsx('span', { children: '剩余' })
                    ] }),
                    jsxs('div', { className: 'ocg-window-switch', role: 'group', 'aria-label': '固定状态栏显示的窗口', children: [
                      ...orderedWindows.map(item => jsx('button', {
                        type: 'button',
                        className: `ocg-window-chip${item.key === activePinnedWindow ? ' is-active' : ''}`,
                        'aria-pressed': item.key === activePinnedWindow,
                        title: `固定显示为${windowLabel(item)}剩余`,
                        onClick: () => changePinnedWindow(item.key),
                        children: windowChipLabel(item)
                      }, item.key)),
                      jsx('button', {
                        type: 'button',
                        className: `ocg-window-chip${automatic ? ' is-active' : ''}`,
                        'aria-pressed': automatic,
                        title: '状态栏显示最低剩余窗口',
                        onClick: () => changePinnedWindow(null),
                        children: '自动'
                      })
                    ] })
                  ] }),
                  otherWindows.length ? jsx('div', { className: 'ocg-window-list', children: otherWindows.map(item => {
                    const itemReset = resetInfo(item.resetsAt)
                    return jsxs('div', { className: 'ocg-window-row', children: [
                      jsxs('div', { className: 'ocg-window-top', children: [
                        jsx('span', { className: 'ocg-window-name', children: windowLabel(item) }),
                        jsxs('div', { className: 'ocg-window-value', children: [
                          jsx('strong', { style: { color: urgencyColor(item.remainingPercent) }, children: `${Math.round(item.remainingPercent)}%` }),
                          jsx('span', { children: '剩余' })
                        ] })
                      ] }),
                      jsx(Gauge, { remaining: item.remainingPercent, label: `${windowLabel(item)}剩余额度` }),
                      jsx('div', { className: 'ocg-window-meta', title: itemReset?.absolute, children: itemReset ? `${itemReset.relative}重置` : '重置时间不可用' })
                    ] }, item.key)
                  }) }) : null,
                  stale ? jsx('div', { className: 'ocg-note', children: t('Data is stale; retrying automatically.', '数据已过期，正在自动重试。') }) : null
                ] })
              : jsx(EmptyState, {
                  error: query.isError ? (ERR_ZH[query.error?.message] || query.error?.message) : null,
                  loading: !data && !query.isError,
                  onRetry: refresh
                })
          ] })
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
