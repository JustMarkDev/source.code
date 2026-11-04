/**
 * Kept out of profile-view.tsx on purpose: routes import this for
 * `validateSearch`, which lives in the entry chunk. Importing it from the view
 * would drag the whole profile page and the chart library into every page load.
 */
export type ProfileTab = 'overview' | 'repositories' | 'activity'
export const profileTabs: Array<[ProfileTab, string]> = [
  ['overview', 'Overview'],
  ['repositories', 'Repositories'],
  ['activity', 'Activity'],
]
