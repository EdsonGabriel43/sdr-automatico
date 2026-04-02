"use server"

import { supabaseAdmin } from "@/lib/supabase-admin"
import crypto from "crypto"

const DISPATCHER_API_URL = process.env.DISPATCHER_API_URL || "http://187.77.48.57:5000"
const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL || "https://sdr-hub.vercel.app"

const PLAN_CONFIG: Record<string, { prefix: string; maxUsers: number }> = {
    starter: { prefix: "STR", maxUsers: 2 },
    pro: { prefix: "PRO", maxUsers: 4 },
    enterprise: { prefix: "ENT", maxUsers: 10 },
}

function generateLicenseKey(plan: string): string {
    const config = PLAN_CONFIG[plan] || PLAN_CONFIG.pro
    const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase()
    return `SDR-${config.prefix}-${randomPart}`
}

export async function listLicenses(filters?: { status?: string; plan?: string; search?: string }) {
    try {
        let query = supabaseAdmin
            .from("licenses")
            .select("*, tenants(name, slug)")
            .order("created_at", { ascending: false })

        if (filters?.status) query = query.eq("status", filters.status)
        if (filters?.plan) query = query.eq("plan", filters.plan)

        const { data: licenses, error } = await query
        if (error) throw error

        // Get user counts per tenant
        const tenantIds = [...new Set((licenses || []).map(l => l.tenant_id))]
        const userCounts: Record<string, number> = {}

        for (const tid of tenantIds) {
            const { count } = await supabaseAdmin
                .from("user_profiles")
                .select("*", { count: "exact", head: true })
                .eq("tenant_id", tid)
            userCounts[tid] = count || 0
        }

        const enriched = (licenses || []).map(l => ({
            ...l,
            tenant_name: l.tenants?.name || "—",
            tenant_slug: l.tenants?.slug || "—",
            user_count: userCounts[l.tenant_id] || 0,
        }))

        // Filter by search
        if (filters?.search) {
            const s = filters.search.toLowerCase()
            return {
                success: true,
                data: enriched.filter(l =>
                    l.key.toLowerCase().includes(s) ||
                    l.tenant_name.toLowerCase().includes(s)
                ),
            }
        }

        return { success: true, data: enriched }
    } catch (e: any) {
        return { success: false, error: e.message, data: [] }
    }
}

export async function createLicense(tenantName: string, plan: string, validityMonths: number) {
    try {
        const config = PLAN_CONFIG[plan]
        if (!config) throw new Error("Plano inválido")

        // Create tenant
        const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")
        const { data: tenant, error: tenantError } = await supabaseAdmin
            .from("tenants")
            .insert({ name: tenantName, slug })
            .select()
            .single()

        if (tenantError) throw tenantError

        // Generate key and calculate expiry
        const key = generateLicenseKey(plan)
        const validUntil = new Date()
        validUntil.setMonth(validUntil.getMonth() + validityMonths)

        const { data: license, error: licenseError } = await supabaseAdmin
            .from("licenses")
            .insert({
                key,
                tenant_id: tenant.id,
                plan,
                max_users: config.maxUsers,
                valid_until: validUntil.toISOString(),
                status: "active",
            })
            .select()
            .single()

        if (licenseError) throw licenseError

        return { success: true, data: { ...license, tenant_name: tenantName } }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

export async function provisionLicense(tenantName: string, plan: string, validityMonths: number, clientPhone: string) {
    try {
        const res = await fetch(`${DISPATCHER_API_URL}/instances/provision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenant_name: tenantName,
                plan,
                validity_months: validityMonths,
                client_phone: clientPhone,
                hub_url: HUB_URL,
            }),
        })

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }))
            throw new Error(err.detail || `Erro ${res.status}`)
        }

        const data = await res.json()
        return { success: true, data }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

export async function revokeLicense(licenseId: string) {
    try {
        const { error } = await supabaseAdmin
            .from("licenses")
            .update({ status: "revoked" })
            .eq("id", licenseId)

        if (error) throw error
        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

export async function reactivateLicense(licenseId: string) {
    try {
        const { error } = await supabaseAdmin
            .from("licenses")
            .update({ status: "active" })
            .eq("id", licenseId)

        if (error) throw error
        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

export async function extendLicense(licenseId: string, additionalMonths: number) {
    try {
        const { data: license } = await supabaseAdmin
            .from("licenses")
            .select("valid_until")
            .eq("id", licenseId)
            .single()

        if (!license) throw new Error("Licença não encontrada")

        const currentExpiry = new Date(license.valid_until)
        const base = currentExpiry > new Date() ? currentExpiry : new Date()
        base.setMonth(base.getMonth() + additionalMonths)

        const { error } = await supabaseAdmin
            .from("licenses")
            .update({ valid_until: base.toISOString(), status: "active" })
            .eq("id", licenseId)

        if (error) throw error
        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

export async function getTenantUsers(tenantId: string) {
    try {
        const { data, error } = await supabaseAdmin
            .from("user_profiles")
            .select("id, name, email, role, created_at")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: true })

        if (error) throw error
        return { success: true, data: data || [] }
    } catch (e: any) {
        return { success: false, error: e.message, data: [] }
    }
}

export async function deleteTenantUser(userId: string) {
    try {
        // Delete from auth
        await supabaseAdmin.auth.admin.deleteUser(userId)
        // Profile will cascade delete
        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}
