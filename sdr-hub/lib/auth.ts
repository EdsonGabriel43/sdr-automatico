import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from './supabase-server'
import { supabaseAdmin } from './supabase-admin'

export type UserRole = 'admin' | 'operator' | 'closer'

export interface UserProfile {
    id: string
    tenant_id: string
    email: string
    name: string
    role: UserRole
}

export async function getAuthUser(): Promise<{ user: any; profile: UserProfile } | null> {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return null

    const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    if (!profile) return null
    return { user, profile: profile as UserProfile }
}

export async function requireAuth(): Promise<{ user: any; profile: UserProfile }> {
    const auth = await getAuthUser()
    if (!auth) redirect('/login')
    return auth
}

const CLOSER_ROUTES = ['/kanban', '/chat']
const ALL_ROUTES = ['/', '/kanban', '/chat', '/leads', '/campaigns', '/nurturing', '/prospecting', '/chips', '/settings']

export function canAccess(role: UserRole, href: string): boolean {
    if (role === 'admin') return true
    if (role === 'operator') return ALL_ROUTES.includes(href)
    if (role === 'closer') return href === '/' || CLOSER_ROUTES.some(r => href.startsWith(r))
    return false
}

export function canWrite(role: UserRole): boolean {
    return role === 'admin'
}
