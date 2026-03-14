import { h } from 'preact'
import { ListIcon, MousePointerIcon, GearIcon } from './icons'

export type TabId = 'actions' | 'selection' | 'settings'

interface TabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

interface TabProps {
  id: TabId
  label: string
  active: boolean
  icon: (color: string) => h.JSX.Element
  onTabChange: (tab: TabId) => void
}

function Tab({ id, label, active, icon, onTabChange }: TabProps) {
  return (
    <div
      class={'flex flex-row items-center justify-center gap-1 flex-1 py-2.5 cursor-pointer select-none transition-colors relative' + (active ? ' bg-card tab-active-bar' : '')}
      onClick={function () { onTabChange(id) }}
    >
      {icon(active ? 'var(--color-primary)' : 'var(--color-muted-foreground)')}
      <span class={'text-xs font-medium' + (active ? ' text-primary font-semibold' : ' text-muted-foreground')}>{label}</span>
    </div>
  )
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div class="flex items-center bg-muted shrink-0">
      <Tab
        id="actions"
        label="Actions"
        active={activeTab === 'actions'}
        icon={function (c) { return <ListIcon color={c} size={13} /> }}
        onTabChange={onTabChange}
      />
      <Tab
        id="selection"
        label="Selection"
        active={activeTab === 'selection'}
        icon={function (c) { return <MousePointerIcon color={c} size={13} /> }}
        onTabChange={onTabChange}
      />
      <Tab
        id="settings"
        label="Settings"
        active={activeTab === 'settings'}
        icon={function (c) { return <GearIcon color={c} size={13} /> }}
        onTabChange={onTabChange}
      />
    </div>
  )
}
