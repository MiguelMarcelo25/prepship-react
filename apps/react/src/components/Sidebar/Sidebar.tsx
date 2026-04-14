import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../../api/client'
import type { InitCountsDto, InitStoreDto } from '../../types/api'
import { buildSidebarSections, SIDEBAR_STATUSES, type SidebarOrderStatus } from './sidebar-data'

type ViewType = 'orders' | 'inventory' | 'locations' | 'packages' | 'rates' | 'analysis' | 'settings' | 'billing' | 'manifests'

interface SidebarProps {
  currentStatus: SidebarOrderStatus
  currentView: ViewType
  stores: InitStoreDto[]
  onShowView: (view: ViewType) => void
  onSelectStatus: (status: SidebarOrderStatus) => void
  mobileMenuOpen: boolean
  onCloseMobileMenu?: () => void
  onSearch?: (query: string) => void
  onSelectStore?: (storeId: number | null) => void
  activeStore?: number | null
}

const STATUS_LABELS: Record<SidebarOrderStatus, string> = {
  awaiting_shipment: 'Awaiting Shipment',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
}

const STATUS_DOT: Record<SidebarOrderStatus, string> = {
  awaiting_shipment: 'bg-amber-500',
  shipped: 'bg-emerald-500',
  cancelled: 'bg-slate-400',
}

const TOOL_ITEMS: Array<{ view: ViewType; icon: string; label: string }> = [
  { view: 'inventory', icon: '📦', label: 'Inventory' },
  { view: 'locations', icon: '📍', label: 'Locations' },
  { view: 'packages', icon: '📐', label: 'Packages' },
  { view: 'rates', icon: '💰', label: 'Rate Shop' },
  { view: 'analysis', icon: '📊', label: 'Analysis' },
  { view: 'settings', icon: '⚙️', label: 'Settings' },
  { view: 'billing', icon: '🧾', label: 'Billing' },
  { view: 'manifests', icon: '📋', label: 'Manifests' },
]

export default function Sidebar({
  currentStatus,
  currentView,
  stores,
  onSelectStatus,
  onShowView,
  mobileMenuOpen,
  onCloseMobileMenu,
  onSearch,
  onSelectStore,
  activeStore,
}: SidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Set<SidebarOrderStatus>>(new Set(['awaiting_shipment']))
  const [counts, setCounts] = useState<InitCountsDto | null>(null)
  const [searchValue, setSearchValue] = useState('')
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.classList.contains('dark')
  })

  useEffect(() => {
    const loadCounts = async () => {
      try {
        setCounts(await apiClient.fetchCounts())
      } catch (error) {
        console.error('Failed to fetch sidebar counts:', error)
      }
    }

    void loadCounts()
    const intervalId = window.setInterval(() => {
      void loadCounts()
    }, 30000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (dark) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }, [dark])

  const sidebarSections = useMemo(() => buildSidebarSections(stores, counts), [stores, counts])

  return (
    <aside
      className={[
        'flex flex-col',
        'h-full w-[260px] flex-shrink-0',
        'bg-[var(--color-bg-surface)] border-r border-[var(--color-border-default)]',
        'font-sans text-[13px]',
        'transition-transform duration-200 ease-out',
        mobileMenuOpen ? 'translate-x-0' : 'max-md:-translate-x-full',
        'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40',
      ].join(' ')}
    >
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 border-b border-[var(--color-border-default)]">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 grid place-items-center text-white font-black text-sm shadow-sm">
            P
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold tracking-tight text-[var(--color-text-primary)]">
              PrepShip
            </span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
              DR PREPPER · Fulfillment
            </span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 pt-4 pb-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </span>
          <input
            type="text"
            placeholder="Search orders…"
            value={searchValue}
            onChange={(event) => {
              setSearchValue(event.target.value)
              onSearch?.(event.target.value)
            }}
            className={[
              'w-full h-9 pl-9 pr-8 rounded-lg',
              'bg-[var(--color-bg-muted)] border border-transparent',
              'text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]',
              'outline-none focus:border-indigo-400 focus:bg-[var(--color-bg-surface)] focus:shadow-sm',
              'transition',
            ].join(' ')}
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => {
                setSearchValue('')
                onSearch?.('')
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Status sections + tools */}
      <nav className="flex-1 overflow-y-auto modern-scroll px-2 pb-3">
        <div className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Orders
        </div>
        {SIDEBAR_STATUSES.map((status) => {
          const isActive = currentView === 'orders' && currentStatus === status && activeStore == null
          const isExpanded = expandedSections.has(status)
          return (
            <div key={status} className="mb-0.5">
              <button
                type="button"
                onClick={() => {
                  onSelectStore?.(null)
                  onSelectStatus(status)
                  onCloseMobileMenu?.()
                }}
                className={[
                  'group w-full flex items-center gap-2 px-3 py-2 rounded-lg',
                  'text-left transition',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
                ].join(' ')}
              >
                <span
                  onClick={(event) => {
                    event.stopPropagation()
                    setExpandedSections((current) => {
                      const next = new Set(current)
                      if (next.has(status)) next.delete(status)
                      else next.add(status)
                      return next
                    })
                  }}
                  className={[
                    'grid place-items-center h-4 w-4 text-[10px]',
                    'transition-transform',
                    isExpanded ? 'rotate-90' : '',
                  ].join(' ')}
                >
                  ▶
                </span>
                <span className={['h-1.5 w-1.5 rounded-full', STATUS_DOT[status]].join(' ')} />
                <span className="flex-1 text-[13px] font-medium truncate">
                  {STATUS_LABELS[status]}
                </span>
                <span
                  className={[
                    'inline-flex items-center justify-center',
                    'min-w-[28px] h-5 px-1.5 rounded-full text-[10px] font-semibold',
                    isActive
                      ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                      : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]',
                  ].join(' ')}
                >
                  {counts ? sidebarSections[status].total.toLocaleString() : '—'}
                </span>
              </button>

              {isExpanded && (
                <div className="mt-0.5 ml-5 pl-3 border-l border-[var(--color-border-default)] flex flex-col">
                  {sidebarSections[status].stores.map((store) => {
                    const storeActive = currentView === 'orders' && activeStore === store.storeId && currentStatus === status
                    const isZero = store.cnt === 0
                    return (
                      <button
                        key={`${status}-${store.storeId}`}
                        type="button"
                        onClick={() => {
                          onSelectStore?.(store.storeId)
                          onSelectStatus(status)
                          onCloseMobileMenu?.()
                        }}
                        className={[
                          'w-full flex items-center gap-2 pl-2 pr-2 py-1.5 rounded-md text-left',
                          'text-[12px] transition',
                          storeActive
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium'
                            : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
                          isZero ? 'opacity-50' : '',
                        ].join(' ')}
                      >
                        <span className="flex-1 truncate">{store.name}</span>
                        {store.cnt > 0 && (
                          <span className="text-[10px] font-semibold tabular-nums">
                            {store.cnt.toLocaleString()}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        <div className="mx-3 my-3 h-px bg-[var(--color-border-default)]" />

        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Tools
        </div>
        <div className="flex flex-col gap-0.5">
          {TOOL_ITEMS.map((tool) => {
            const isActive = currentView === tool.view
            return (
              <button
                key={tool.view}
                type="button"
                onClick={() => {
                  onShowView(tool.view)
                  onCloseMobileMenu?.()
                }}
                className={[
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
                ].join(' ')}
              >
                <span className="text-[15px] leading-none">{tool.icon}</span>
                <span className="text-[13px]">{tool.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* Bottom status */}
      <div className="px-4 py-3 border-t border-[var(--color-border-default)] flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-primary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            ShipStation connected
          </div>
          <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 truncate">
            DR PREPPER USA · Gardena CA
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          aria-label="Toggle dark mode"
          className={[
            'h-8 w-8 grid place-items-center rounded-lg',
            'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            'hover:bg-[var(--color-bg-muted)] transition',
          ].join(' ')}
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
          )}
        </button>
      </div>
    </aside>
  )
}
