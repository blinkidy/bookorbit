import { Permission } from '@bookorbit/types'

export const INTEGRATIONS_TABS = ['kobo', 'koreader', 'hardcover', 'storygraph'] as const

export type IntegrationsTab = (typeof INTEGRATIONS_TABS)[number]

type IntegrationsTabInfo = {
  navLabel: string
  titleLabel: string
  subtitle: string
  permission: Permission
}

export const INTEGRATIONS_TAB_INFO: Record<IntegrationsTab, IntegrationsTabInfo> = {
  kobo: {
    navLabel: 'Kobo',
    titleLabel: 'Kobo Sync',
    subtitle: 'Pair your Kobo device to sync your library.',
    permission: Permission.KoboSync,
  },
  koreader: {
    navLabel: 'KOReader',
    titleLabel: 'KOReader Sync',
    subtitle: 'Sync reading progress between KOReader devices and BookOrbit.',
    permission: Permission.KoreaderSync,
  },
  hardcover: {
    navLabel: 'Hardcover',
    titleLabel: 'Hardcover',
    subtitle: 'Sync your reading progress, status, and ratings to Hardcover.',
    permission: Permission.HardcoverSync,
  },
  storygraph: {
    navLabel: 'StoryGraph',
    titleLabel: 'StoryGraph',
    subtitle: 'Sync your reading progress and status to The StoryGraph.',
    permission: Permission.StorygraphSync,
  },
}

export function normalizeIntegrationsTab(value: unknown, allowedTabs: readonly IntegrationsTab[] = INTEGRATIONS_TABS): IntegrationsTab {
  const fallback = allowedTabs[0] ?? INTEGRATIONS_TABS[0]
  if (typeof value === 'string' && allowedTabs.includes(value as IntegrationsTab)) {
    return value as IntegrationsTab
  }
  return fallback
}
