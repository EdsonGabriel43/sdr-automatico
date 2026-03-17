"use server"

import { supabaseAdmin } from "@/lib/supabase-admin"

export async function getDashboardMetrics() {
    const { count: totalLeads } = await supabaseAdmin.from('leads').select('*', { count: 'exact', head: true })
    const { count: contactedLeads } = await supabaseAdmin.from('conversations').select('*', { count: 'exact', head: true }).neq('status', 'pending')
    const { count: qualifiedLeads } = await supabaseAdmin.from('conversations').select('*', { count: 'exact', head: true }).in('status', ['qualified', 'handed_off'])
    const { count: respondingLeads } = await supabaseAdmin.from('conversations').select('*', { count: 'exact', head: true }).in('status', ['responded', 'nurturing', 'qualified', 'handed_off'])
    const responseRate = contactedLeads ? ((respondingLeads || 0) / contactedLeads) * 100 : 0
    const { data: recentActivity } = await supabaseAdmin.from('messages').select(`
      id, content, created_at, conversation_id, conversations ( leads (nome, empresa) )
    `).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(5)
    return { totalLeads: totalLeads || 0, contactedLeads: contactedLeads || 0, qualifiedLeads: qualifiedLeads || 0, responseRate: responseRate.toFixed(1), recentActivity: recentActivity || [] }
}

export async function getKanbanLeads() {
    const { data: conversations } = await supabaseAdmin.from('conversations').select(`
      id, status, current_step, follow_up_count, updated_at, intent_classification,
      leads ( id, nome, empresa, telefone, valor_divida, cargo )
    `)
    .not('status', 'eq', 'blocked')
    .order('updated_at', { ascending: false })
    .limit(500)
    const convs = conversations || []
    const seenLeads = new Set<string>()
    const unique = convs.filter((c: any) => {
        const lid = c.leads?.id
        if (!lid || seenLeads.has(lid)) return false
        seenLeads.add(lid)
        return true
    })
    const isGK = (c: any) => c.intent_classification && ['gatekeeper', 'referral'].includes(c.intent_classification)
    const fup = (c: any) => c.follow_up_count ?? 0
    const columns = {
        para_contactar:      unique.filter((c: any) => c.status === 'pending'),
        nao_resp_0:          unique.filter((c: any) => c.status === 'contacted' && fup(c) === 0),
        nao_resp_1:          unique.filter((c: any) => c.status === 'contacted' && fup(c) === 1),
        nao_resp_2:          unique.filter((c: any) => c.status === 'contacted' && fup(c) === 2),
        nao_resp_3:          unique.filter((c: any) => (c.status === 'contacted' && fup(c) >= 3) || c.status === 'no_response'),
        desqualificado:      unique.filter((c: any) => ['not_interested', 'wrong_person'].includes(c.status)),
        handoff_humano:      unique.filter((c: any) => c.status === 'handed_off'),
        em_conversa_gk:      unique.filter((c: any) => ['responded', 'nurturing'].includes(c.status) && isGK(c)),
        em_conversa_decisor: unique.filter((c: any) => ['responded', 'nurturing'].includes(c.status) && !isGK(c)),
        reuniao_marcada:     unique.filter((c: any) => c.status === 'meeting_scheduled'),
        nao_compareceu:      unique.filter((c: any) => c.status === 'meeting_no_show'),
        em_negociacao:       unique.filter((c: any) => c.status === 'qualified'),
    }
    return columns
}

export async function getLeadDetails(leadId: string) {
    const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', leadId).single()
    if (!lead) return null
    const { data: conversation } = await supabaseAdmin.from('conversations').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1).single()
    let messages: any[] = []
    if (conversation) {
        const { data: msgs } = await supabaseAdmin.from('messages').select('*').eq('conversation_id', conversation.id).order('created_at', { ascending: true })
        messages = msgs || []
    }
    return { lead, conversation, messages }
}

export async function getAllLeads(page = 1, pageSize = 20) {
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const { data: leads, count } = await supabaseAdmin
        .from('leads')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)
    return { leads: leads || [], total: count || 0, totalPages: count ? Math.ceil(count / pageSize) : 0 }
}

const DISPATCHER_API_URL = process.env.DISPATCHER_API_URL || 'http://localhost:5000'

export async function importLeadsCsv(formData: FormData) {
    try {
        const response = await fetch(`${DISPATCHER_API_URL}/leads/import`, { method: 'POST', body: formData })
        if (!response.ok) throw new Error(`Erro na API: ${response.statusText}`)
        return { success: true, data: await response.json() }
    } catch (e: any) { return { success: false, error: e.message } }
}

export async function createAndStartCampaign(name: string, description: string, filters: any = null) {
    try {
        const createRes = await fetch(`${DISPATCHER_API_URL}/campaigns/create`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, filters })
        })
        if (!createRes.ok) throw new Error("Falha ao criar campanha")
        const { campaign } = await createRes.json()
        const startRes = await fetch(`${DISPATCHER_API_URL}/campaigns/start`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaign_id: campaign.id })
        })
        if (!startRes.ok) throw new Error("Falha ao iniciar disparo")
        return { success: true, campaign }
    } catch (error) { return { success: false, error: "Erro interno." } }
}

export async function getTemplates() {
    try {
        const res = await fetch(`${DISPATCHER_API_URL}/settings/templates`, { cache: 'no-store' })
        if (!res.ok) throw new Error("Falha ao carregar templates")
        return await res.json()
    } catch (error) { return null }
}

export async function updateTemplates(data: any) {
    try {
        const res = await fetch(`${DISPATCHER_API_URL}/settings/templates`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
        })
        if (!res.ok) throw new Error(`Erro API: ${await res.text()}`)
        return { success: true }
    } catch (error: any) { return { success: false, error: error.message } }
}

export async function getConversations() {
    try {
        const { data, error } = await supabaseAdmin
            .from("conversations")
            .select(`id, status, intent_classification, next_follow_up_at, updated_at, leads ( id, nome, empresa, telefone, valor_divida )`)
            .not('status', 'eq', 'blocked')
            .not('status', 'eq', 'no_response')
            .not('status', 'eq', 'wrong_person')
            .order("updated_at", { ascending: false })
            .limit(200)
        if (error) { console.error("Erro getConversations:", error); return [] }
        return data
    } catch (error) { return [] }
}

export async function getMessages(conversationId: string) {
    try {
        const { data, error } = await supabaseAdmin
            .from("messages")
            .select("id, direction, content, status, created_at, message_type")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })
        if (error) { return [] }
        return data
    } catch (error) { return [] }
}

export async function sendManualMessage(conversationId: string, message: string) {
    try {
        const res = await fetch(`${DISPATCHER_API_URL}/conversations/${conversationId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
        })
        if (!res.ok) throw new Error(`Erro VPS: ${res.statusText}`)
        return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
}

export async function getChipsStatus() {
    try {
        const res = await fetch(`${DISPATCHER_API_URL}/chips`, { cache: 'no-store' })
        if (!res.ok) return { success: false }
        return { success: true, chips: (await res.json()).chips }
    } catch (e) { return { success: false } }
}

export async function getCampaigns() {
    try {
        const { data: campaigns } = await supabaseAdmin.from('campaigns').select('*').order('created_at', { ascending: false })
        return { success: true, campaigns: campaigns || [] }
    } catch (e) { return { success: false, campaigns: [] } }
}

export async function getNurturingLeads() {
    try {
        const { data: convs } = await supabaseAdmin
            .from("conversations")
            .select("id, status, current_step, follow_up_count, next_follow_up_at, updated_at, leads(id, nome, empresa, telefone, valor_divida)")
            .in("status", ["nurturing", "responded", "qualified"])
            .order("updated_at", { ascending: true })
            .limit(100)
        if (!convs) return []
        const enriched = await Promise.all(
            (convs as any[]).map(async (conv) => {
                const { data: msgs } = await supabaseAdmin
                    .from("messages").select("content, created_at")
                    .eq("conversation_id", conv.id).eq("direction", "outbound")
                    .order("created_at", { ascending: false }).limit(1)
                const lastMsg = msgs?.[0] ?? null
                const now = new Date()
                const lastAt = lastMsg ? new Date(lastMsg.created_at) : new Date(conv.updated_at)
                const hoursAgo = Math.round((now.getTime() - lastAt.getTime()) / 3600000)
                return { ...conv, last_bot_message: lastMsg?.content?.slice(0, 150) ?? "", last_bot_at: lastMsg?.created_at ?? conv.updated_at, hours_waiting: hoursAgo }
            })
        )
        return enriched.sort((a: any, b: any) => b.hours_waiting - a.hours_waiting)
    } catch (e) { return [] }
}

export async function triggerNurturingFollowup(conversationId: string) {
    try {
        const res = await fetch(`${DISPATCHER_API_URL}/followups/nurturing/trigger`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversation_id: conversationId }),
        })
        if (!res.ok) throw new Error(`Erro VPS: ${res.statusText}`)
        return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
}

export async function closeNurturingLead(conversationId: string) {
    try {
        const res = await fetch(`${DISPATCHER_API_URL}/followups/nurturing/close/${conversationId}`, { method: "POST" })
        if (!res.ok) throw new Error(`Erro VPS: ${res.statusText}`)
        return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
}

export async function getCampaignDetails(campaignId: string) {
    try {
        const { data: campaign } = await supabaseAdmin.from('campaigns').select('*').eq('id', campaignId).single()
        if (!campaign) return null
        const { data: conversations } = await supabaseAdmin
            .from('conversations')
            .select(`id, status, intent_classification, current_step, updated_at, leads ( id, nome, empresa, telefone )`)
            .eq('campaign_id', campaignId)
            .order('updated_at', { ascending: false })
        const convs = conversations || []
        const metrics = {
            total: convs.length,
            contacted: convs.filter((c: any) => c.status !== 'pending').length,
            responded: convs.filter((c: any) => ['responded', 'nurturing'].includes(c.status)).length,
            qualified: convs.filter((c: any) => ['qualified', 'handed_off'].includes(c.status)).length,
            blocked: convs.filter((c: any) => c.status === 'blocked').length,
        }
        return { campaign, conversations: convs, metrics }
    } catch (error) { return null }
}
