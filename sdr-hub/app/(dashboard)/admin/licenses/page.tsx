"use client"

import { useState, useEffect, useCallback } from "react"
import { Shield, Plus, Search, Key, Users, Calendar, Ban, RefreshCw, ChevronDown, ChevronRight, Trash2, Copy, Check } from "lucide-react"
import { toast } from "sonner"
import { listLicenses, createLicense, revokeLicense, reactivateLicense, extendLicense, getTenantUsers, deleteTenantUser } from "./actions"

interface License {
    id: string
    key: string
    tenant_id: string
    tenant_name: string
    tenant_slug: string
    plan: string
    status: string
    max_users: number
    user_count: number
    valid_until: string
    activated_at: string | null
    created_at: string
}

interface TenantUser {
    id: string
    name: string
    email: string
    role: string
    created_at: string
}

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
    starter: { label: "Starter", color: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
    pro: { label: "Pro", color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
    enterprise: { label: "Enterprise", color: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    active: { label: "Ativa", color: "bg-emerald-500/10 text-emerald-500" },
    revoked: { label: "Revogada", color: "bg-red-500/10 text-red-500" },
    expired: { label: "Expirada", color: "bg-yellow-500/10 text-yellow-500" },
}

export default function AdminLicensesPage() {
    const [licenses, setLicenses] = useState<License[]>([])
    const [loading, setLoading] = useState(true)
    const [showCreate, setShowCreate] = useState(false)
    const [filterStatus, setFilterStatus] = useState("")
    const [filterPlan, setFilterPlan] = useState("")
    const [searchQuery, setSearchQuery] = useState("")
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([])
    const [loadingUsers, setLoadingUsers] = useState(false)
    const [copiedKey, setCopiedKey] = useState<string | null>(null)

    // Create form
    const [newTenantName, setNewTenantName] = useState("")
    const [newPlan, setNewPlan] = useState("pro")
    const [newValidity, setNewValidity] = useState(12)
    const [creating, setCreating] = useState(false)

    // Extend
    const [extendingId, setExtendingId] = useState<string | null>(null)
    const [extendMonths, setExtendMonths] = useState(6)

    const fetchLicenses = useCallback(async () => {
        setLoading(true)
        const res = await listLicenses({ status: filterStatus || undefined, plan: filterPlan || undefined, search: searchQuery || undefined })
        if (res.success) setLicenses(res.data as License[])
        else toast.error(res.error)
        setLoading(false)
    }, [filterStatus, filterPlan, searchQuery])

    useEffect(() => { fetchLicenses() }, [fetchLicenses])

    const handleCreate = async () => {
        if (!newTenantName.trim()) { toast.error("Nome da empresa obrigatório"); return }
        setCreating(true)
        const res = await createLicense(newTenantName.trim(), newPlan, newValidity)
        if (res.success) {
            toast.success(`Licença criada: ${res.data?.key}`)
            setShowCreate(false)
            setNewTenantName("")
            fetchLicenses()
        } else {
            toast.error(res.error)
        }
        setCreating(false)
    }

    const handleRevoke = async (id: string) => {
        const res = await revokeLicense(id)
        if (res.success) { toast.success("Licença revogada"); fetchLicenses() }
        else toast.error(res.error)
    }

    const handleReactivate = async (id: string) => {
        const res = await reactivateLicense(id)
        if (res.success) { toast.success("Licença reativada"); fetchLicenses() }
        else toast.error(res.error)
    }

    const handleExtend = async (id: string) => {
        const res = await extendLicense(id, extendMonths)
        if (res.success) { toast.success(`Licença estendida por ${extendMonths} meses`); setExtendingId(null); fetchLicenses() }
        else toast.error(res.error)
    }

    const handleExpand = async (licenseId: string, tenantId: string) => {
        if (expandedId === licenseId) { setExpandedId(null); return }
        setExpandedId(licenseId)
        setLoadingUsers(true)
        const res = await getTenantUsers(tenantId)
        if (res.success) setTenantUsers(res.data as TenantUser[])
        setLoadingUsers(false)
    }

    const handleDeleteUser = async (userId: string) => {
        const res = await deleteTenantUser(userId)
        if (res.success) {
            toast.success("Usuário removido")
            setTenantUsers(prev => prev.filter(u => u.id !== userId))
            fetchLicenses()
        } else toast.error(res.error)
    }

    const copyKey = (key: string) => {
        navigator.clipboard.writeText(key)
        setCopiedKey(key)
        toast.success("Chave copiada!")
        setTimeout(() => setCopiedKey(null), 2000)
    }

    const isExpired = (date: string) => new Date(date) < new Date()

    const stats = {
        total: licenses.length,
        active: licenses.filter(l => l.status === "active" && !isExpired(l.valid_until)).length,
        expired: licenses.filter(l => isExpired(l.valid_until)).length,
        totalUsers: licenses.reduce((sum, l) => sum + l.user_count, 0),
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <Shield className="h-6 w-6 text-primary" /> Gerenciar Licenças
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Crie, gerencie e monitore chaves de licença dos clientes</p>
                </div>
                <button
                    onClick={() => setShowCreate(!showCreate)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all shadow-sm"
                >
                    <Plus className="h-4 w-4" /> Nova Licença
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: "Total", value: stats.total, icon: Key },
                    { label: "Ativas", value: stats.active, icon: Check },
                    { label: "Expiradas", value: stats.expired, icon: Calendar },
                    { label: "Usuários", value: stats.totalUsers, icon: Users },
                ].map((s, i) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-lg"><s.icon className="h-4 w-4 text-primary" /></div>
                            <div>
                                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                                <p className="text-xs text-muted-foreground">{s.label}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Create Form */}
            {showCreate && (
                <div className="bg-card border border-primary/30 rounded-xl p-6 space-y-4">
                    <h2 className="text-sm font-semibold text-foreground">Criar Nova Licença</h2>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Nome da Empresa</label>
                            <input
                                type="text"
                                value={newTenantName}
                                onChange={e => setNewTenantName(e.target.value)}
                                placeholder="Ex: Clínica Dr. Silva"
                                className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Plano</label>
                            <select
                                value={newPlan}
                                onChange={e => setNewPlan(e.target.value)}
                                className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                                <option value="starter">Starter (2 usuários)</option>
                                <option value="pro">Pro (4 usuários)</option>
                                <option value="enterprise">Enterprise (10 usuários)</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Validade</label>
                            <select
                                value={newValidity}
                                onChange={e => setNewValidity(Number(e.target.value))}
                                className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                                <option value={3}>3 meses</option>
                                <option value={6}>6 meses</option>
                                <option value={12}>1 ano</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                        <button
                            onClick={handleCreate}
                            disabled={creating}
                            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
                        >
                            {creating ? "Gerando..." : "Gerar Licença"}
                        </button>
                        <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 bg-secondary text-foreground rounded-lg text-sm hover:bg-secondary/80">
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Buscar por chave ou empresa..."
                        className="w-full pl-9 pr-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                </div>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm text-foreground">
                    <option value="">Todos os status</option>
                    <option value="active">Ativas</option>
                    <option value="revoked">Revogadas</option>
                    <option value="expired">Expiradas</option>
                </select>
                <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} className="px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm text-foreground">
                    <option value="">Todos os planos</option>
                    <option value="starter">Starter</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                </select>
            </div>

            {/* Licenses Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">Carregando...</div>
                ) : licenses.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma licença encontrada</div>
                ) : (
                    <div className="divide-y divide-border">
                        {licenses.map(license => {
                            const expired = isExpired(license.valid_until)
                            const effectiveStatus = expired && license.status === "active" ? "expired" : license.status
                            const statusInfo = STATUS_LABELS[effectiveStatus] || STATUS_LABELS.active
                            const planInfo = PLAN_LABELS[license.plan] || PLAN_LABELS.pro

                            return (
                                <div key={license.id}>
                                    <div className="flex items-center gap-4 px-5 py-4 hover:bg-secondary/30 transition-colors">
                                        {/* Expand */}
                                        <button onClick={() => handleExpand(license.id, license.tenant_id)} className="text-muted-foreground hover:text-foreground">
                                            {expandedId === license.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                        </button>

                                        {/* Key */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <code className="text-sm font-mono font-semibold text-foreground">{license.key}</code>
                                                <button onClick={() => copyKey(license.key)} className="text-muted-foreground hover:text-foreground">
                                                    {copiedKey === license.key ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                                                </button>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-0.5">{license.tenant_name}</p>
                                        </div>

                                        {/* Plan */}
                                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold border ${planInfo.color}`}>
                                            {planInfo.label}
                                        </span>

                                        {/* Status */}
                                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusInfo.color}`}>
                                            {statusInfo.label}
                                        </span>

                                        {/* Users */}
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground w-20">
                                            <Users className="h-3.5 w-3.5" />
                                            {license.user_count}/{license.max_users}
                                        </div>

                                        {/* Expiry */}
                                        <div className="text-xs text-muted-foreground w-24">
                                            {new Date(license.valid_until).toLocaleDateString("pt-BR")}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1">
                                            {license.status === "active" ? (
                                                <button onClick={() => handleRevoke(license.id)} className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors" title="Revogar">
                                                    <Ban className="h-4 w-4" />
                                                </button>
                                            ) : (
                                                <button onClick={() => handleReactivate(license.id)} className="p-1.5 text-muted-foreground hover:text-emerald-500 transition-colors" title="Reativar">
                                                    <RefreshCw className="h-4 w-4" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => setExtendingId(extendingId === license.id ? null : license.id)}
                                                className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                                                title="Estender"
                                            >
                                                <Calendar className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Extend inline */}
                                    {extendingId === license.id && (
                                        <div className="px-12 py-3 bg-secondary/20 flex items-center gap-3">
                                            <span className="text-xs text-muted-foreground">Estender por:</span>
                                            <select value={extendMonths} onChange={e => setExtendMonths(Number(e.target.value))} className="px-2 py-1 bg-secondary border border-border rounded text-xs text-foreground">
                                                <option value={3}>3 meses</option>
                                                <option value={6}>6 meses</option>
                                                <option value={12}>1 ano</option>
                                            </select>
                                            <button onClick={() => handleExtend(license.id)} className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-semibold hover:bg-primary/90">
                                                Confirmar
                                            </button>
                                            <button onClick={() => setExtendingId(null)} className="px-3 py-1 bg-secondary text-foreground rounded text-xs hover:bg-secondary/80">
                                                Cancelar
                                            </button>
                                        </div>
                                    )}

                                    {/* Users panel */}
                                    {expandedId === license.id && (
                                        <div className="px-12 py-3 bg-secondary/10 border-t border-border">
                                            <p className="text-xs font-semibold text-muted-foreground mb-2">Usuários ({license.user_count})</p>
                                            {loadingUsers ? (
                                                <p className="text-xs text-muted-foreground">Carregando...</p>
                                            ) : tenantUsers.length === 0 ? (
                                                <p className="text-xs text-muted-foreground">Nenhum usuário registrado</p>
                                            ) : (
                                                <div className="space-y-1.5">
                                                    {tenantUsers.map(u => (
                                                        <div key={u.id} className="flex items-center gap-3 text-xs">
                                                            <span className="font-medium text-foreground w-40 truncate">{u.name}</span>
                                                            <span className="text-muted-foreground w-48 truncate">{u.email}</span>
                                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                                                u.role === "admin" ? "bg-purple-500/10 text-purple-500" :
                                                                u.role === "closer" ? "bg-blue-500/10 text-blue-500" :
                                                                "bg-gray-500/10 text-gray-500"
                                                            }`}>{u.role}</span>
                                                            <span className="text-muted-foreground">{new Date(u.created_at).toLocaleDateString("pt-BR")}</span>
                                                            <button onClick={() => handleDeleteUser(u.id)} className="p-1 text-muted-foreground hover:text-red-500">
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
