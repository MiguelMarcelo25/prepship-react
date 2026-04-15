import type { ReactNode } from 'react'
import type { ViewType } from './sidebar-data'
import {
  IconBadge,
  IconBarChart,
  IconBoxes,
  IconDollarSign,
  IconFileText,
  IconMapPin,
  IconPackage,
  IconReceipt,
  IconSettings,
  type IconTone,
} from './sidebar-icons'

interface WorkspaceItem {
  view: ViewType
  icon: ReactNode
  label: string
  tone: IconTone
}

const WORKSPACE_ITEMS: WorkspaceItem[] = [
  { view: 'inventory', icon: <IconBoxes />, label: 'Inventory', tone: 'indigo' },
  { view: 'locations', icon: <IconMapPin />, label: 'Locations', tone: 'rose' },
  { view: 'packages', icon: <IconPackage />, label: 'Packages', tone: 'amber' },
  { view: 'rates', icon: <IconDollarSign />, label: 'Rate Shop', tone: 'emerald' },
  { view: 'analysis', icon: <IconBarChart />, label: 'Analytics', tone: 'violet' },
  { view: 'settings', icon: <IconSettings />, label: 'Settings', tone: 'slate' },
  { view: 'billing', icon: <IconReceipt />, label: 'Billing', tone: 'sky' },
  { view: 'manifests', icon: <IconFileText />, label: 'Manifests', tone: 'teal' },
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
                'group flex h-10 w-full items-center justify-start gap-3 rounded-lg pl-10 pr-3 text-[13px] transition-colors',
                isActive
                  ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]',
              ].join(' ')}
            >
              <IconBadge tone={tool.tone} active={isActive} size="sm">
                {tool.icon}
              </IconBadge>
              <span className="flex-1 truncate text-left">{tool.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
