"use server"

import { supabaseAdmin } from "@/lib/supabase-admin"

export async function validateLicenseKey(key: string) {
    try {
        const { data: license } = await supabaseAdmin
            .from('licenses')
            .select('*, tenants(name)')
            .eq('key', key)
            .single()

        if (!license) return { valid: false, error: "Chave de licença não encontrada" }
        if (license.status !== 'active') return { valid: false, error: "Chave revogada ou inativa" }
        if (new Date(license.valid_until) < new Date()) return { valid: false, error: "Chave expirada" }

        // Count existing users for this tenant
        const { count } = await supabaseAdmin
            .from('user_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', license.tenant_id)

        if ((count || 0) >= license.max_users) {
            return { valid: false, error: `Limite de ${license.max_users} usuários atingido para esta licença` }
        }

        return { valid: true, tenantName: license.tenants?.name || license.tenant_id }
    } catch (e: any) {
        return { valid: false, error: e.message }
    }
}

export async function activateWithLicense(key: string, name: string, email: string, password: string) {
    try {
        // Re-validate
        const validation = await validateLicenseKey(key)
        if (!validation.valid) return { success: false, error: validation.error }

        // Get license and tenant_id
        const { data: license } = await supabaseAdmin
            .from('licenses')
            .select('*')
            .eq('key', key)
            .single()

        if (!license) return { success: false, error: "Licença não encontrada" }

        // Check if email already exists
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
        const emailExists = existingUsers?.users?.some(u => u.email === email)
        if (emailExists) return { success: false, error: "Este email já está cadastrado" }

        // Create auth user
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        })

        if (authError || !authData.user) {
            return { success: false, error: authError?.message || "Erro ao criar usuário" }
        }

        // Check if first user for this tenant → admin
        const { count } = await supabaseAdmin
            .from('user_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', license.tenant_id)

        const role = (count || 0) === 0 ? 'admin' : 'operator'

        // Create profile
        await supabaseAdmin.from('user_profiles').insert({
            id: authData.user.id,
            tenant_id: license.tenant_id,
            email,
            name,
            role,
        })

        // Mark license as activated if first time
        if (!license.activated_at) {
            await supabaseAdmin.from('licenses').update({ activated_at: new Date().toISOString() }).eq('id', license.id)
        }

        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}
