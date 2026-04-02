import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth"

const SUPER_TENANT_SLUG = "antigravity"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const { profile } = await requireAuth()

    // Only admin role can access
    if (profile.role !== 'admin') redirect('/')

    // Check if this tenant is the super-admin tenant
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('slug')
        .eq('id', profile.tenant_id)
        .single()

    if (tenant?.slug !== SUPER_TENANT_SLUG) redirect('/')

    return <>{children}</>
}
