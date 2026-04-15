import type { ReactNode } from 'react'
import type { ViewType } from './sidebar-data'
import {
  IconBarChart,
  IconBoxes,
  IconChevronRight,
  IconDollarSign,
  IconFileText,
  IconMapPin,
  IconPackage,
  IconReceipt,
  IconSettings,
} from './sidebar-icons'

interface WorkspaceItem {
  view: ViewType
  icon: ReactNode
  label: string
}

const WORKSPACE_ITEMS: WorkspaceItem[] = [
  { view: 'inventory', icon: <IconBoxes />, label: 'Inventory' },
  { view: 'locations', icon: <IconMapPin />, label: 'Locations' },
  { view: 'packages', icon: <IconPackage />, label: 'Packages' },
  { view: 'rates', icon: <IconDollarSign />, label: 'Rate Shop' },
  { view: 'analysis', icon: <IconBarChart />, label: 'Analytics' },
  { view: 'settings', icon: <IconSettings />, label: 'Settings' },
  { view: 'billing', icon: <IconReceipt />, label: 'Billing' },
  { view: 'manifests', icon: <IconFileText />, label: 'Manifests' },
]

interface SidebarWorkspaceProps {
  currentView: ViewType
  onSelect: (view: ViewType) => void
  filter?: string
}

export function SidebarWorkspace({ currentView, onSelect, filter = '' }: SidebarWorkspaceProps) {
  const filteredItems = filter
    ? WORKSPACE_ITEMS.filter((item) => item.label.toLowerCase().includes(filter.toLowerCase()))
    : WORKSPACE_ITEMS

  if (filter && filteredItems.length === 0 && !'Workspace'.toLowerCase().includes(filter.toLowerCase())) {
    return null
  }

  return (
    <div>
      <div className="mx-4 mb-3 h-px bg-[var(--color-border-strong)]" />

      <div className="flex flex-col gap-1">
        {filteredItems.map((tool) => {
          const isActive = currentView === tool.view
          return (
            <button
              key={tool.view}
              type="button"
              onClick={() => onSelect(tool.view)}
              className={[
                'flex h-9 w-full items-center justify-start gap-3 rounded-lg pl-14 pr-3 text-[13px] transition-colors',
                isActive
                  ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
              ].join(' ')}
            >
              <span
                className={[
                  'shrink-0 transition-all',
                  isActive ? 'opacity-100 text-indigo-600' : 'opacity-60',
                ].join(' ')}
              >
                {tool.icon}
              </span>
              <span className="flex-1 truncate text-left">{tool.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
