import { IconSearch, IconX } from './sidebar-icons'

interface SidebarFilterProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}

export function SidebarFilter({
  value,
  onChange,
  placeholder = 'Search for the store...',
}: SidebarFilterProps) {
  return (
    <div className="px-4 py-4">
        <div className="relative flex h-10 w-full items-center border-white">
          <IconSearch />
          
          <input
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-64 border border-white"
          />

          {value ? (
            <button
              type="button"
              onClick={() => onChange('')}
              className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bg-subtle)]"
            >
              <IconX />
            </button>
          ) : (
            <div className="hidden items-center gap-1 overflow-hidden sm:flex">
              
            </div>
          )}
      </div>
    </div>
  )
}
