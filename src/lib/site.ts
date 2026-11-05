/**
 * Where the product links out to. The social links below point at each
 * network's home page until the real accounts exist: replace the `href`s.
 */
export const socials = [
  { id: 'x', label: 'X', href: 'https://x.com' },
  { id: 'discord', label: 'Discord', href: 'https://discord.com' },
  { id: 'youtube', label: 'YouTube', href: 'https://youtube.com' },
  { id: 'github', label: 'GitHub', href: 'https://github.com' },
] as const

export type SocialId = (typeof socials)[number]['id']
