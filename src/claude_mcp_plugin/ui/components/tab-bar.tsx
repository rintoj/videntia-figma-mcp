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
      class={'tab' + (active ? ' tab-active' : '')}
      onClick={function () { onTabChange(id) }}
    >
      {icon(active ? '#ffffff' : '#737373')}
      <span class={'tab-label' + (active ? ' tab-label-active' : '')}>{label}</span>
    </div>
  )
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div class="tab-bar">
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
