import { useEffect, useState } from 'react'
import type { InitStoreDto } from '../../types/api'
import type { SidebarOrderStatus, ViewType } from './sidebar-data'
import { SidebarBrand } from './SidebarBrand'
import { SidebarFilter } from './SidebarFilter'
import { SidebarOrders } from './SidebarOrders'
import { SidebarWorkspace } from './SidebarWorkspace'
import { SidebarFooter } from './SidebarFooter'

interface SidebarProps {
  currentStatus: SidebarOrderStatus
  currentView: ViewType
  stores: InitStoreDto[]
  onShowView: (view: ViewType) => void
  onSelectStatus: (status: SidebarOrderStatus) => void
  mobileMenuOpen: boolean
  onCloseMobileMenu?: () => void
  onSelectStore?: (storeId: number | null) => void
  activeStore?: number | null
  dateStart?: string
  dateEnd?: string
}

export default function Sidebar({
  currentStatus,
  currentView,
  stores,
  onSelectStatus,
  onShowView,
  mobileMenuOpen,
  onCloseMobileMenu,
  onSelectStore,
  activeStore,
  dateStart,
  dateEnd,
}: SidebarProps) {
  const [sidebarFilter, setSidebarFilter] = useState('')
  const [peeking, setPeeking] = useState(false)

  const pinned = mobileMenuOpen
  const visible = pinned || peeking

  useEffect(() => {
    if (pinned) setPeeking(false)
  }, [pinned])

  const handleSelectStatus = (status: SidebarOrderStatus) => {
    onSelectStore?.(null)
    onSelectStatus(status)
    onCloseMobileMenu?.()
  }

  const handleSelectStore = (status: SidebarOrderStatus, storeId: number) => {
    onSelectStatus(status)
    onSelectStore?.(storeId)
    onCloseMobileMenu?.()
  }

  const handleSelectTool = (view: ViewType) => {
    onShowView(view)
    onCloseMobileMenu?.()
  }

  return (
    <>
      {/* Spacer that pushes main content right when sidebar is pinned */}
      <div
        className="shrink-0 transition-[width] duration-300 ease-out"
        style={{ width: pinned ? 288 : 0 }}
        aria-hidden
      />

      {/* Hover trigger strip when sidebar is collapsed */}
      {!pinned && (
        <div
          className="fixed left-0 top-0 z-30 h-full w-3"
          aria-hidden
          onMouseEnter={() => setPeeking(true)}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={[
          'fixed left-0 top-0 bottom-0 z-40 flex w-[288px] flex-col overflow-hidden',
          'border-r border-[var(--color-border-default)] bg-[var(--color-bg-surface)]',
          'font-sans transition-[transform,box-shadow] duration-300 ease-out will-change-transform',
          visible ? 'translate-x-0' : '-translate-x-full',
          !pinned && peeking ? 'shadow-2xl' : 'shadow-none',
        ].join(' ')}
        onMouseEnter={() => !pinned && setPeeking(true)}
        onMouseLeave={() => !pinned && setPeeking(false)}
      >
        <SidebarBrand />

        <SidebarFilter
          value={sidebarFilter}
          onChange={setSidebarFilter}
          placeholder="Search stores & tools..."
        />

        <nav className="modern-scroll flex flex-1 flex-col gap-6 overflow-y-auto px-4 pt-2 pb-6">
          <SidebarOrders
            currentStatus={currentStatus}
            isOrdersView={currentView === 'orders'}
            activeStore={activeStore}
            stores={stores}
            onSelectStatus={handleSelectStatus}
            onSelectStore={handleSelectStore}
            filter={sidebarFilter}
            dateStart={dateStart}
            dateEnd={dateEnd}
          />

          <div className="mx-2 h-px bg-[var(--color-border-default)]" />

          <SidebarWorkspace
            currentView={currentView}
            onSelect={handleSelectTool}
            filter={sidebarFilter}
          />
        </nav>

        <SidebarFooter />
      </aside>
    </>
  )
}
