import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from './supabase-server'
import { supabaseAdmin } from './supabase-admin'
import type { UserProfile } from './auth-types'

export type { UserProfile, UserRole } from './auth-types'
export { canAccess, canWrite } from './auth-types'

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
