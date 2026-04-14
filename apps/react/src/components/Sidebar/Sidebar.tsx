import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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

/* ─── Inline SVG icon primitives (Lucide-style 1.8 stroke) ─────────────── */

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const Icon = {
  Search: () => (
    <svg {...iconProps}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
  ),
  ChevronRight: () => (
    <svg {...iconProps} width={13} height={13}><path d="m9 18 6-6-6-6" /></svg>
  ),
  X: () => (
    <svg {...iconProps} width={13} height={13}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
  ),
  Package: () => (
    <svg {...iconProps}><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="m7.5 4.27 9 5.15" /></svg>
  ),
  Inbox: () => (
    <svg {...iconProps}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
  ),
  CheckCircle: () => (
    <svg {...iconProps}><path d="M21.801 10A10 10 0 1 1 17 3.335" /><path d="m9 11 3 3L22 4" /></svg>
  ),
  XCircle: () => (
    <svg {...iconProps}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>
  ),
  Boxes: () => (
    <svg {...iconProps}><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" /><path d="m7 16.5-4.74-2.85" /><path d="m7 16.5 5-3" /><path d="M7 16.5v5.17" /><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" /><path d="m17 16.5-5-3" /><path d="m17 16.5 4.74-2.85" /><path d="M17 16.5v5.17" /><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" /><path d="M12 8 7.26 5.15" /><path d="m12 8 4.74-2.85" /><path d="M12 13.5V8" /></svg>
  ),
  MapPin: () => (
    <svg {...iconProps}><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></svg>
  ),
  DollarSign: () => (
    <svg {...iconProps}><line x1="12" y1="2" x2="12" y2="22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
  ),
  BarChart: () => (
    <svg {...iconProps}><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>
  ),
  Settings: () => (
    <svg {...iconProps}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
  ),
  Receipt: () => (
    <svg {...iconProps}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" /></svg>
  ),
  FileText: () => (
    <svg {...iconProps}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" /></svg>
  ),
  Sun: () => (
    <svg {...iconProps}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
  ),
  Moon: () => (
    <svg {...iconProps}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
  ),
  Home: () => (
    <svg {...iconProps}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 22V12h6v10" /></svg>
  ),
}

const STATUS_LABELS: Record<SidebarOrderStatus, string> = {
  awaiting_shipment: 'Awaiting',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
}

const STATUS_ICONS: Record<SidebarOrderStatus, ReactNode> = {
  awaiting_shipment: <Icon.Inbox />,
  shipped: <Icon.CheckCircle />,
  cancelled: <Icon.XCircle />,
}

const TOOL_ITEMS: Array<{ view: ViewType; icon: ReactNode; label: string }> = [
  { view: 'inventory', icon: <Icon.Boxes />, label: 'Inventory' },
  { view: 'locations', icon: <Icon.MapPin />, label: 'Locations' },
  { view: 'packages', icon: <Icon.Package />, label: 'Packages' },
  { view: 'rates', icon: <Icon.DollarSign />, label: 'Rate Shop' },
  { view: 'analysis', icon: <Icon.BarChart />, label: 'Analytics' },
  { view: 'settings', icon: <Icon.Settings />, label: 'Settings' },
  { view: 'billing', icon: <Icon.Receipt />, label: 'Billing' },
  { view: 'manifests', icon: <Icon.FileText />, label: 'Manifests' },
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
  const [expandedSections, setExpandedSections] = useState<Set<SidebarOrderStatus>>(
    new Set(['awaiting_shipment']),
  )
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
        'flex flex-col w-[268px] flex-shrink-0',
        // Floating sidebar — lifted off the edges with margin, rounded, soft shadow
        'my-4 ml-4',
        'h-[calc(100%-2rem)]',
        'bg-[var(--color-bg-surface)]',
        'border border-[var(--color-border-default)]',
        'rounded-2xl shadow-sm',
        'overflow-hidden',
        'font-sans',
        'transition-transform duration-200 ease-out',
        mobileMenuOpen ? 'translate-x-0' : 'max-md:-translate-x-full',
        'max-md:fixed max-md:inset-y-4 max-md:left-4 max-md:z-40',
      ].join(' ')}
    >
      {/* Brand header */}
      <div className="h-[60px] px-5 flex items-center border-b border-[var(--color-border-default)]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
            <Icon.Home />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]">
              PrepShip
            </span>
            <span className="text-[10.5px] text-[var(--color-text-tertiary)] mt-1">
              DR PREPPER
            </span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 pt-4 pb-1">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none">
            <Icon.Search />
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
              'w-full h-[38px] pl-10 pr-9 rounded-[8px]',
              'bg-[var(--color-bg-muted)] border border-transparent',
              'text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]',
              'outline-none transition',
              'focus:border-indigo-500 focus:bg-[var(--color-bg-surface)] focus:shadow-[0_0_0_3px_rgb(99_102_241/0.12)]',
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
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition"
            >
              <Icon.X />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto modern-scroll px-3 pt-5 pb-5">
        {/* Section: Orders */}
        <div className="px-3 pb-2 text-[10.5px] font-medium text-[var(--color-text-muted)]">
          Orders
        </div>
        <div className="flex flex-col gap-0.5">
          {SIDEBAR_STATUSES.map((status) => {
            const isActive =
              currentView === 'orders' && currentStatus === status && activeStore == null
            const isExpanded = expandedSections.has(status)
            const storeList = sidebarSections[status].stores

            return (
              <div key={status}>
                <div className="group relative">
                  {/* Chevron (absolute so it stacks over the main button click area) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedSections((current) => {
                        const next = new Set(current)
                        if (next.has(status)) next.delete(status)
                        else next.add(status)
                        return next
                      })
                    }}
                    className={[
                      'absolute left-2 top-1/2 -translate-y-1/2 z-10',
                      'h-5 w-5 grid place-items-center rounded',
                      'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
                      'transition',
                    ].join(' ')}
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    <span className={`inline-flex transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                      <Icon.ChevronRight />
                    </span>
                  </button>

                  {/* Main status row */}
                  <button
                    type="button"
                    onClick={() => {
                      onSelectStore?.(null)
                      onSelectStatus(status)
                      onCloseMobileMenu?.()
                    }}
                    className={[
                      'w-full flex items-center gap-2.5 pl-9 pr-3 h-[38px] rounded-[8px]',
                      'text-left transition',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
                    ].join(' ')}
                  >
                    <span className="flex-shrink-0 opacity-90">{STATUS_ICONS[status]}</span>
                    <span className="flex-1 text-[13px] truncate">{STATUS_LABELS[status]}</span>
                    <span
                      className={[
                        'inline-flex items-center justify-center min-w-[26px] h-[20px] px-2',
                        'text-[10.5px] font-semibold tabular-nums rounded-full',
                        isActive
                          ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                          : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]',
                      ].join(' ')}
                    >
                      {counts ? sidebarSections[status].total.toLocaleString() : '—'}
                    </span>
                  </button>
                </div>

                {/* Expanded store list — only render when both stores and counts
                   have loaded so we don't flash raw "Store XXXXX" placeholders */}
                {isExpanded && stores.length > 0 && storeList.length > 0 && (
                  <div className="mt-0.5 mb-1 ml-9 flex flex-col">
                    {storeList.map((store) => {
                      const storeActive =
                        currentView === 'orders' &&
                        activeStore === store.storeId &&
                        currentStatus === status
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
                            'w-full flex items-center gap-2 px-3 h-[30px] rounded-[6px] text-left',
                            'text-[12px] transition',
                            storeActive
                              ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium'
                              : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
                            isZero ? 'opacity-50' : '',
                          ].join(' ')}
                        >
                          <span className="flex-1 truncate">{store.name}</span>
                          {store.cnt > 0 && (
                            <span className="text-[10.5px] font-medium tabular-nums text-[var(--color-text-muted)]">
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
        </div>

        {/* Section: Workspace */}
        <div className="px-3 pt-7 pb-2 text-[10.5px] font-medium text-[var(--color-text-muted)]">
          Workspace
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
                  'w-full flex items-center gap-2.5 px-3 h-[38px] rounded-[8px] text-left transition',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
                ].join(' ')}
              >
                <span className="flex-shrink-0 opacity-80">{tool.icon}</span>
                <span className="text-[13px]">{tool.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* Bottom bar — compact status + theme toggle */}
      <div className="h-[54px] px-4 flex items-center justify-between border-t border-[var(--color-border-default)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative h-2 w-2 flex-shrink-0">
            <span className="absolute inset-0 rounded-full bg-emerald-500" />
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-50" />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-[11px] font-medium text-[var(--color-text-primary)]">Connected</span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] truncate">Gardena, CA</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          aria-label="Toggle theme"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          className={[
            'h-8 w-8 grid place-items-center rounded-[8px] flex-shrink-0',
            'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            'hover:bg-[var(--color-bg-muted)] transition',
          ].join(' ')}
        >
          {dark ? <Icon.Sun /> : <Icon.Moon />}
        </button>
      </div>
    </aside>
  )
}
