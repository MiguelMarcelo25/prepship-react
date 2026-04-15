import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { apiClient } from '../../api/client'
import type { InitCountsDto, InitStoreDto } from '../../types/api'
import { buildSidebarSections, SIDEBAR_STATUSES, type SidebarOrderStatus } from './sidebar-data'
import {
  IconBadge,
  IconCheckCircle,
  IconChevronRight,
  IconInbox,
  IconXCircle,
  type IconTone,
} from './sidebar-icons'

const STATUS_META: Record<
  SidebarOrderStatus,
  { label: string; icon: ReactNode; tone: IconTone }
> = {
  awaiting_shipment: { label: 'Awaiting', icon: <IconInbox />, tone: 'amber' },
  shipped: { label: 'Shipped', icon: <IconCheckCircle />, tone: 'emerald' },
  cancelled: { label: 'Cancelled', icon: <IconXCircle />, tone: 'rose' },
}

interface SidebarOrdersProps {
  currentStatus: SidebarOrderStatus
  isOrdersView: boolean
  activeStore: number | null | undefined
  stores: InitStoreDto[]
  onSelectStatus: (status: SidebarOrderStatus) => void
  onSelectStore: (status: SidebarOrderStatus, storeId: number) => void
  filter?: string
}

export function SidebarOrders({
  currentStatus,
  isOrdersView,
  activeStore,
  stores,
  onSelectStatus,
  onSelectStore,
  filter = '',
}: SidebarOrdersProps) {
  const [counts, setCounts] = useState<InitCountsDto | null>(null)
  const [expanded, setExpanded] = useState<Set<SidebarOrderStatus>>(
    () => new Set(['awaiting_shipment']),
  )

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

  const sections = useMemo(() => buildSidebarSections(stores, counts), [stores, counts])

  const toggleExpanded = (status: SidebarOrderStatus) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  return (
    <div>
      <div className="mx-4 mb-3 h-px bg-[var(--color-border-strong)]" />

      <div className="flex flex-col gap-1">
        {SIDEBAR_STATUSES.map((status) => {
          const meta = STATUS_META[status]
          const isStatusActive = isOrdersView && currentStatus === status
          const isFullyActive = isStatusActive && activeStore == null
          const isDrilledIn = isStatusActive && activeStore != null
          const isExpanded = expanded.has(status)
          const allStores = sections[status]?.stores || []
          const storeList = filter
            ? allStores.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
            : allStores

          if (filter && storeList.length === 0 && !meta.label.toLowerCase().includes(filter.toLowerCase())) {
            return null
          }

          return (
            <div key={status}>
              <button
                type="button"
                onClick={() => {
                  onSelectStatus(status)
                  toggleExpanded(status)
                }}
                className={[
                  'group flex h-11 w-full items-center justify-start gap-3 rounded-xl px-3 transition-colors',
                  isFullyActive
                    ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                    : isDrilledIn
                      ? 'bg-indigo-50/50 text-indigo-600 dark:bg-indigo-500/5 dark:text-indigo-300/80'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
                ].join(' ')}
              >
                <div
                  className={[
                    'flex shrink-0 items-center justify-center transition-transform duration-200',
                    isExpanded ? 'rotate-90 text-indigo-600' : 'rotate-0 opacity-40',
                  ].join(' ')}
                >
                  <IconChevronRight />
                </div>
                <IconBadge tone={meta.tone} active={isStatusActive}>
                  {meta.icon}
                </IconBadge>
                <span className="flex-1 truncate text-left text-[14.5px]">{meta.label}</span>
                <span
                  className={[
                    'inline-flex h-[22px] min-w-[40px] items-center justify-center rounded-full px-3 text-[12px] font-bold tabular-nums ml-2',
                    isFullyActive
                      ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                      : isDrilledIn
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                        : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]',
                  ].join(' ')}
                >
                  {counts ? sections[status].total.toLocaleString() : '—'}
                </span>
              </button>

              {isExpanded && stores.length > 0 && storeList.length > 0 && (
                <div className="mt-1 mb-2 flex flex-col gap-0.5">
                  {storeList.map((store) => {
                    const storeActive =
                      isOrdersView && activeStore === store.storeId && currentStatus === status
                    return (
                        <button
                          key={`${status}-${store.storeId}`}
                          type="button"
                          onClick={() => onSelectStore(status, store.storeId)}
                          className={[
                            'flex h-9 w-full items-center justify-start gap-2 rounded-lg pl-14 pr-3 text-[12.5px] transition-colors',
                            storeActive
                              ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                              : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
                          ].join(' ')}
                        >
                          <div
                            className={[
                              'flex shrink-0 items-center justify-center w-4 text-[14px] transition-all',
                              storeActive ? 'opacity-100 text-indigo-600' : 'opacity-30',
                            ].join(' ')}
                          >
                            •
                          </div>
                          <span className="flex-1 truncate text-left text-[13px]">{store.name}</span>
                          {store.cnt > 0 && (
                            <span
                              className={[
                                'ml-2 inline-flex h-[22px] min-w-[40px] items-center justify-center rounded-full px-3 text-[12px] font-bold tabular-nums transition-colors',
                                storeActive
                                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                                  : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]',
                              ].join(' ')}
                            >
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
    </div>
  )
}
