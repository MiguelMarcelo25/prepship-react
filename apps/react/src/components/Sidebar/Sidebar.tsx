import { useEffect, useMemo, useState } from 'react'
import type { ReactNode, MouseEventHandler } from 'react'
import { apiClient } from '../../api/client'
import type { InitCountsDto, InitStoreDto } from '../../types/api'
import { buildSidebarSections, SIDEBAR_STATUSES, type SidebarOrderStatus } from './sidebar-data'
import {
  IconBarChart,
  IconBoxes,
  IconCheckCircle,
  IconChevronRight,
  IconDollarSign,
  IconFileText,
  IconHome,
  IconInbox,
  IconMapPin,
  IconMoon,
  IconPackage,
  IconReceipt,
  IconSearch,
  IconSettings,
  IconSun,
  IconX,
  IconXCircle,
} from './sidebar-icons'

/* ──────────────────────────────────────────────────────────────────────────
   ▲ CONFIGURATION — edit these to add/remove items
   ────────────────────────────────────────────────────────────────────────── */

type ViewType =
  | 'orders'
  | 'inventory'
  | 'locations'
  | 'packages'
  | 'rates'
  | 'analysis'
  | 'settings'
  | 'billing'
  | 'manifests'

const STATUS_META: Record<SidebarOrderStatus, { label: string; icon: ReactNode }> = {
  awaiting_shipment: { label: 'Awaiting', icon: <IconInbox /> },
  shipped: { label: 'Shipped', icon: <IconCheckCircle /> },
  cancelled: { label: 'Cancelled', icon: <IconXCircle /> },
}

const WORKSPACE_ITEMS: Array<{ view: ViewType; icon: ReactNode; label: string }> = [
  { view: 'inventory', icon: <IconBoxes />, label: 'Inventory' },
  { view: 'locations', icon: <IconMapPin />, label: 'Locations' },
  { view: 'packages', icon: <IconPackage />, label: 'Packages' },
  { view: 'rates', icon: <IconDollarSign />, label: 'Rate Shop' },
  { view: 'analysis', icon: <IconBarChart />, label: 'Analytics' },
  { view: 'settings', icon: <IconSettings />, label: 'Settings' },
  { view: 'billing', icon: <IconReceipt />, label: 'Billing' },
  { view: 'manifests', icon: <IconFileText />, label: 'Manifests' },
]

/* ──────────────────────────────────────────────────────────────────────────
   ▲ STYLES — single source of truth for all classNames. Tweak these to
   restyle the entire sidebar without touching JSX. Colors and sizes below.
   ────────────────────────────────────────────────────────────────────────── */

const styles = {
  // Outer frame — floating card with margin, rounded corners, soft shadow
  root: [
    'flex flex-col w-[268px] shrink-0',
    'my-4 ml-4 h-[calc(100%-2rem)]',
    'bg-[var(--color-bg-surface)]',
    'border border-[var(--color-border-default)]',
    'rounded-2xl shadow-sm overflow-hidden',
    'font-sans',
    'transition-transform duration-200 ease-out',
    'max-md:fixed max-md:inset-y-4 max-md:left-4 max-md:z-40',
  ].join(' '),

  rootClosedMobile: 'max-md:-translate-x-[110%]',

  // Brand header
  brand: 'h-[60px] px-5 flex items-center border-b border-[var(--color-border-default)]',
  brandInner: 'flex items-center gap-2.5',
  brandLogo:
    'flex h-8 w-8 items-center justify-center rounded-[8px] bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm',
  brandTitle: 'text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]',
  brandSubtitle: 'text-[10.5px] text-[var(--color-text-tertiary)] mt-1',

  // Search
  searchWrap: 'px-4 pt-4 pb-1',
  searchBox: 'relative',
  searchIcon:
    'absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none',
  searchInput: [
    'w-full h-[38px] pl-10 pr-9 rounded-[8px]',
    'bg-[var(--color-bg-muted)] border border-transparent',
    'text-[13px] text-[var(--color-text-primary)]',
    'placeholder:text-[var(--color-text-muted)]',
    'outline-none transition',
    'focus:border-indigo-500 focus:bg-[var(--color-bg-surface)]',
    'focus:shadow-[0_0_0_3px_rgb(99_102_241/0.12)]',
  ].join(' '),
  searchClear:
    'absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition',

  // Nav (scrollable area) + section labels
  nav: 'flex-1 overflow-y-auto modern-scroll px-3 pt-5 pb-5',
  sectionLabel: 'px-3 pb-2 text-[10.5px] font-medium text-[var(--color-text-muted)]',
  sectionLabelWithGap: 'px-3 pt-7 pb-2 text-[10.5px] font-medium text-[var(--color-text-muted)]',
  sectionStack: 'flex flex-col gap-0.5',

  // Nav item (shared by status + workspace rows)
  navItem: {
    base: 'w-full flex items-center gap-2.5 px-3 h-[38px] rounded-[8px] text-left transition',
    active:
      'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium',
    inactive:
      'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
  },
  navItemWithChevron: 'w-full flex items-center gap-2.5 pl-9 pr-3 h-[38px] rounded-[8px] text-left transition',
  navItemIcon: 'shrink-0 opacity-90',
  navItemLabel: 'flex-1 text-[13px] truncate',

  // Chevron (absolute positioned so the parent button click doesn't toggle)
  chevronBtn:
    'absolute left-2 top-1/2 -translate-y-1/2 z-10 h-5 w-5 grid place-items-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition',

  // Count badge
  badge: {
    base: 'inline-flex items-center justify-center min-w-[26px] h-[20px] px-2 text-[10.5px] font-semibold tabular-nums rounded-full',
    active: 'bg-indigo-600 text-white dark:bg-indigo-500',
    inactive: 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]',
  },

  // Store sub-items (nested under expanded status)
  storeList: 'mt-0.5 mb-1 ml-9 flex flex-col',
  storeItem: {
    base: 'w-full flex items-center gap-2 px-3 h-[30px] rounded-[6px] text-left text-[12px] transition',
    active: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium',
    inactive:
      'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
  },
  storeLabel: 'flex-1 truncate',
  storeCount: 'text-[10.5px] font-medium tabular-nums text-[var(--color-text-muted)]',

  // Bottom bar
  bottomBar:
    'h-[54px] px-4 flex items-center justify-between border-t border-[var(--color-border-default)]',
  bottomStatus: 'flex items-center gap-2.5 min-w-0',
  bottomDot: 'relative h-2 w-2 shrink-0',
  bottomDotSolid: 'absolute inset-0 rounded-full bg-emerald-500',
  bottomDotPing: 'absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-50',
  bottomLabelWrap: 'flex flex-col leading-tight min-w-0',
  bottomLabel: 'text-[11px] font-medium text-[var(--color-text-primary)]',
  bottomSub: 'text-[10px] text-[var(--color-text-tertiary)] truncate',
  themeToggle:
    'h-8 w-8 grid place-items-center rounded-[8px] shrink-0 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-muted)] transition',
}

/* ──────────────────────────────────────────────────────────────────────────
   Reusable sub-components (stateless, pure presentational)
   ────────────────────────────────────────────────────────────────────────── */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function SectionLabel({ children, withTopGap = false }: { children: ReactNode; withTopGap?: boolean }) {
  return <div className={withTopGap ? styles.sectionLabelWithGap : styles.sectionLabel}>{children}</div>
}

function CountBadge({ active, children }: { active: boolean; children: ReactNode }) {
  return <span className={cx(styles.badge.base, active ? styles.badge.active : styles.badge.inactive)}>{children}</span>
}

function NavButton({
  icon,
  label,
  isActive,
  onClick,
  badge,
  withChevronSlot = false,
}: {
  icon: ReactNode
  label: ReactNode
  isActive: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
  badge?: ReactNode
  withChevronSlot?: boolean
}) {
  const base = withChevronSlot ? styles.navItemWithChevron : styles.navItem.base
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(base, isActive ? styles.navItem.active : styles.navItem.inactive)}
    >
      <span className={styles.navItemIcon}>{icon}</span>
      <span className={styles.navItemLabel}>{label}</span>
      {badge}
    </button>
  )
}

function ExpandChevronBtn({
  isExpanded,
  onClick,
}: {
  isExpanded: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isExpanded ? 'Collapse' : 'Expand'}
      className={styles.chevronBtn}
    >
      <span className={cx('inline-flex transition-transform', isExpanded && 'rotate-90')}>
        <IconChevronRight />
      </span>
    </button>
  )
}

function StoreItem({
  name,
  count,
  isActive,
  isZero,
  onClick,
}: {
  name: string
  count: number
  isActive: boolean
  isZero: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        styles.storeItem.base,
        isActive ? styles.storeItem.active : styles.storeItem.inactive,
        isZero && 'opacity-50',
      )}
    >
      <span className={styles.storeLabel}>{name}</span>
      {count > 0 && <span className={styles.storeCount}>{count.toLocaleString()}</span>}
    </button>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   Public Sidebar props
   ────────────────────────────────────────────────────────────────────────── */

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

  // Load sidebar counts + poll every 30s
  useEffect(() => {
    const load = async () => {
      try {
        setCounts(await apiClient.fetchCounts())
      } catch (error) {
        console.error('Failed to fetch sidebar counts:', error)
      }
    }
    void load()
    const id = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(id)
  }, [])

  // Keep <html class="dark"> in sync with local toggle state
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (dark) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }, [dark])

  const sections = useMemo(() => buildSidebarSections(stores, counts), [stores, counts])

  const toggleExpanded = (status: SidebarOrderStatus) => {
    setExpandedSections((current) => {
      const next = new Set(current)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const handleSelectStatus = (status: SidebarOrderStatus) => {
    onSelectStore?.(null)
    onSelectStatus(status)
    onCloseMobileMenu?.()
  }

  const handleSelectStore = (status: SidebarOrderStatus, storeId: number) => {
    onSelectStore?.(storeId)
    onSelectStatus(status)
    onCloseMobileMenu?.()
  }

  const handleSelectTool = (view: ViewType) => {
    onShowView(view)
    onCloseMobileMenu?.()
  }

  return (
    <aside className={cx(styles.root, !mobileMenuOpen && styles.rootClosedMobile)}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.brandInner}>
          <div className={styles.brandLogo}>
            <IconHome />
          </div>
          <div className="flex flex-col leading-none">
            <span className={styles.brandTitle}>PrepShip</span>
            <span className={styles.brandSubtitle}>DR PREPPER</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>
            <IconSearch />
          </span>
          <input
            type="text"
            placeholder="Search orders…"
            value={searchValue}
            onChange={(event) => {
              setSearchValue(event.target.value)
              onSearch?.(event.target.value)
            }}
            className={styles.searchInput}
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => {
                setSearchValue('')
                onSearch?.('')
              }}
              aria-label="Clear search"
              className={styles.searchClear}
            >
              <IconX />
            </button>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className={styles.nav}>
        <SectionLabel>Orders</SectionLabel>
        <div className={styles.sectionStack}>
          {SIDEBAR_STATUSES.map((status) => {
            const meta = STATUS_META[status]
            const isActive =
              currentView === 'orders' && currentStatus === status && activeStore == null
            const isExpanded = expandedSections.has(status)
            const storeList = sections[status].stores

            return (
              <div key={status}>
                <div className="relative">
                  <ExpandChevronBtn
                    isExpanded={isExpanded}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpanded(status)
                    }}
                  />
                  <NavButton
                    icon={meta.icon}
                    label={meta.label}
                    isActive={isActive}
                    onClick={() => handleSelectStatus(status)}
                    withChevronSlot
                    badge={
                      <CountBadge active={isActive}>
                        {counts ? sections[status].total.toLocaleString() : '—'}
                      </CountBadge>
                    }
                  />
                </div>

                {isExpanded && stores.length > 0 && storeList.length > 0 && (
                  <div className={styles.storeList}>
                    {storeList.map((store) => (
                      <StoreItem
                        key={`${status}-${store.storeId}`}
                        name={store.name}
                        count={store.cnt}
                        isZero={store.cnt === 0}
                        isActive={
                          currentView === 'orders' &&
                          activeStore === store.storeId &&
                          currentStatus === status
                        }
                        onClick={() => handleSelectStore(status, store.storeId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <SectionLabel withTopGap>Workspace</SectionLabel>
        <div className={styles.sectionStack}>
          {WORKSPACE_ITEMS.map((tool) => (
            <NavButton
              key={tool.view}
              icon={tool.icon}
              label={tool.label}
              isActive={currentView === tool.view}
              onClick={() => handleSelectTool(tool.view)}
            />
          ))}
        </div>
      </nav>

      {/* Bottom bar */}
      <div className={styles.bottomBar}>
        <div className={styles.bottomStatus}>
          <div className={styles.bottomDot}>
            <span className={styles.bottomDotSolid} />
            <span className={styles.bottomDotPing} />
          </div>
          <div className={styles.bottomLabelWrap}>
            <span className={styles.bottomLabel}>Connected</span>
            <span className={styles.bottomSub}>Gardena, CA</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          aria-label="Toggle theme"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          className={styles.themeToggle}
        >
          {dark ? <IconSun /> : <IconMoon />}
        </button>
      </div>
    </aside>
  )
}
