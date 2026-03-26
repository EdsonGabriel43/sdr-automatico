export type UserRole = 'admin' | 'operator' | 'closer'

export interface UserProfile {
    id: string
    tenant_id: string
    email: string
    name: string
    role: UserRole
}

const CLOSER_ROUTES = ['/kanban', '/chat']

export function canAccess(role: UserRole, href: string): boolean {
    if (role === 'admin') return true
    if (role === 'operator') return true
    if (role === 'closer') return href === '/' || CLOSER_ROUTES.some(r => href.startsWith(r))
    return false
}

export function canWrite(role: UserRole): boolean {
    return role === 'admin'
}
