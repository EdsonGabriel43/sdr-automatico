"use client"

import { useState, useEffect, useMemo, Fragment } from "react"
import { useRouter } from "next/navigation"
import { Search, Loader2, Phone, Mail, Globe, CheckSquare, Sparkles, Zap, X, Filter, ArrowUpDown, Info, MessageCircle } from "lucide-react"
import { toast } from "sonner"
import { startProspectingSearch, getProspectingResults, enrichProspects, createCampaignFromProspects } from "@/app/actions"

const PLATFORMS = [
    { id: "linkedin", label: "LinkedIn", color: "bg-blue-500" },
    { id: "instagram", label: "Instagram", color: "bg-fuchsia-500" },
    { id: "google", label: "Google", color: "bg-yellow-500" },
    { id: "google_places", label: "Google Maps", color: "bg-emerald-500" },
    { id: "facebook", label: "Facebook", color: "bg-blue-600" },
]

interface ProspectResult {
    id: string
    name: string
    email: string | null
    phone: string | null
    role_snippet: string | null
    company: string | null
    profile_url: string | null
    source_platform: string
    cnpj: string | null
    address: string | null
    whatsapp_status: string
    priority_score: number
    selected: boolean
    cnpj_data: Record<string, any> | null
}

export default function ProspectingPage() {
    const router = useRouter()

    // Search state
    const [smartQuery, setSmartQuery] = useState("")
    const [location, setLocation] = useState("")
    const [selectedPlatforms, setSelectedPlatforms] = useState(["linkedin", "instagram", "google", "google_places"])
    const [deepScraping, setDeepScraping] = useState(false)

    // Results state
    const [searchId, setSearchId] = useState<string | null>(null)
    const [searchStatus, setSearchStatus] = useState<string | null>(null)
    const [results, setResults] = useState<ProspectResult[]>([])
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    // Filter state
    const [searchText, setSearchText] = useState("")
    const [filterPlatform, setFilterPlatform] = useState<string | null>(null)
    const [filterHasPhone, setFilterHasPhone] = useState(false)
    const [filterHasEmail, setFilterHasEmail] = useState(false)
    const [filterWhatsApp, setFilterWhatsApp] = useState(false)
    const [sortBy, setSortBy] = useState<"priority_score" | "name" | "platform">("priority_score")
    const [sortDesc, setSortDesc] = useState(true)

    // UI state
    const [isSearching, setIsSearching] = useState(false)
    const [isEnriching, setIsEnriching] = useState(false)
    const [showCampaignDialog, setShowCampaignDialog] = useState(false)
    const [campaignName, setCampaignName] = useState("")
    const [campaignDesc, setCampaignDesc] = useState("")
    const [isCreatingCampaign, setIsCreatingCampaign] = useState(false)
    const [expandedCnpj, setExpandedCnpj] = useState<string | null>(null)

    // Filtered & sorted results
    const filteredResults = useMemo(() => {
        let filtered = results
        if (filterPlatform) filtered = filtered.filter(r => r.source_platform === filterPlatform)
        if (filterHasPhone) filtered = filtered.filter(r => r.phone)
        if (filterHasEmail) filtered = filtered.filter(r => r.email)
        if (filterWhatsApp) filtered = filtered.filter(r => r.whatsapp_status === "confirmed")
        if (searchText.trim()) {
            const q = searchText.toLowerCase()
            filtered = filtered.filter(r =>
                (r.name || "").toLowerCase().includes(q) ||
                (r.company || "").toLowerCase().includes(q) ||
                (r.role_snippet || "").toLowerCase().includes(q)
            )
        }
        return [...filtered].sort((a, b) => {
            if (sortBy === "priority_score") return sortDesc ? b.priority_score - a.priority_score : a.priority_score - b.priority_score
            if (sortBy === "name") return sortDesc ? (b.name || "").localeCompare(a.name || "") : (a.name || "").localeCompare(b.name || "")
            return sortDesc ? (b.source_platform || "").localeCompare(a.source_platform || "") : (a.source_platform || "").localeCompare(b.source_platform || "")
        })
    }, [results, filterPlatform, filterHasPhone, filterHasEmail, filterWhatsApp, searchText, sortBy, sortDesc])

    // Polling for results
    useEffect(() => {
        if (!searchId || searchStatus === "completed" || searchStatus === "failed") return

        let active = true
        const poll = async () => {
            while (active) {
                await new Promise(r => setTimeout(r, 2500))
                if (!active) break
                try {
                    const res = await getProspectingResults(searchId)
                    if (res.success && res.data) {
                        const newResults = res.data.results || []
                        const newStatus = res.data.search?.status || "running"

                        if (newResults.length > 0) setResults(newResults)

                        if (newStatus === "completed") {
                            setResults(newResults)
                            setSearchStatus("completed")
                            setIsSearching(false)
                            toast.success(`${newResults.length} prospectos encontrados!`)
                            break
                        } else if (newStatus === "failed") {
                            setSearchStatus("failed")
                            setIsSearching(false)
                            toast.error("Erro na busca. Tente novamente.")
                            break
                        }
                    }
                } catch (e) {
                    console.error("[Prospecting] Poll error:", e)
                }
            }
        }
        poll()
        return () => { active = false }
    }, [searchId, searchStatus])

    const handleSearch = async () => {
        const query = smartQuery
        if (!query.trim()) { toast.error("Digite uma busca"); return }

        setIsSearching(true)
        setSearchId(null)
        setResults([])
        setSelectedIds(new Set())
        setSearchStatus("pending")
        setSearchText("")
        setFilterPlatform(null)
        setFilterHasPhone(false)
        setFilterHasEmail(false)
        setFilterWhatsApp(false)

        const res = await startProspectingSearch(query, "natural_language", selectedPlatforms, location.trim() || null, deepScraping)
        if (res.success && res.data) {
            setSearchId(res.data.search_id)
            setSearchStatus("running")
            toast.info("Busca iniciada! Aguarde os resultados...")
        } else {
            setIsSearching(false)
            toast.error(res.error || "Erro ao iniciar busca")
        }
    }

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const selectAll = () => setSelectedIds(new Set(filteredResults.map(r => r.id)))
    const selectWithPhone = () => setSelectedIds(new Set(filteredResults.filter(r => r.phone).map(r => r.id)))

    const handleEnrich = async () => {
        if (selectedIds.size === 0) return
        setIsEnriching(true)
        const res = await enrichProspects(Array.from(selectedIds))
        if (res.success) {
            toast.success(`${res.data?.enriched || 0} prospectos enriquecidos!`)
            if (searchId) {
                const updated = await getProspectingResults(searchId)
                if (updated.success) setResults(updated.data?.results || [])
            }
        } else {
            toast.error("Erro ao enriquecer dados")
        }
        setIsEnriching(false)
    }

    const handleCreateCampaign = async () => {
        if (!campaignName.trim() || !searchId) return
        setIsCreatingCampaign(true)
        const res = await createCampaignFromProspects(searchId, Array.from(selectedIds), campaignName, campaignDesc)
        if (res.success) {
            toast.success(`Campanha criada com ${res.data?.leads_imported || 0} leads!`)
            setShowCampaignDialog(false)
            router.push("/campaigns")
        } else {
            toast.error(res.error || "Erro ao criar campanha")
        }
        setIsCreatingCampaign(false)
    }

    const togglePlatform = (id: string) => {
        setSelectedPlatforms(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
    }

    const stats = {
        total: results.length,
        withPhone: results.filter(r => r.phone).length,
        withEmail: results.filter(r => r.email).length,
        whatsappConfirmed: results.filter(r => r.whatsapp_status === "confirmed").length,
        byPlatform: PLATFORMS.map(p => ({
            ...p,
            count: results.filter(r => r.source_platform === p.id).length,
        })).filter(p => p.count > 0),
    }

    const platformBadge = (platform: string) => {
        const p = PLATFORMS.find(p => p.id === platform)
        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${p?.color || "bg-gray-500"}`}>
                {p?.label || platform}
            </span>
        )
    }

    const whatsappBadge = (status: string) => {
        if (status === "confirmed") return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <MessageCircle className="h-3 w-3" /> WhatsApp
            </span>
        )
        if (status === "not_whatsapp") return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-500">
                Sem WhatsApp
            </span>
        )
        return null
    }

    const selectedWithPhone = results.filter(r => selectedIds.has(r.id) && r.phone).length

    const toggleSort = (col: "priority_score" | "name" | "platform") => {
        if (sortBy === col) setSortDesc(!sortDesc)
        else { setSortBy(col); setSortDesc(true) }
    }

    return (
        <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-foreground">Prospectar</h1>
                <p className="text-sm text-muted-foreground mt-1">Busque prospectos em LinkedIn, Instagram, Google e mais</p>
            </div>

            {/* Search Form */}
            <div className="bg-card border border-border rounded-xl p-6">
                <div className="space-y-4">
                    <textarea
                        value={smartQuery}
                        onChange={(e) => setSmartQuery(e.target.value)}
                        placeholder="Ex: Personal trainers em São Paulo, Diretores de marketing de fintechs em Curitiba, Mentores de negócios no Instagram..."
                        className="w-full h-24 px-4 py-3 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    />
                    <div className="flex items-center gap-3 flex-wrap">
                        <input
                            id="location"
                            name="location"
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            placeholder="Localização (opcional)"
                            className="flex-1 max-w-xs px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                            {PLATFORMS.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => togglePlatform(p.id)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                                        selectedPlatforms.includes(p.id)
                                            ? `${p.color} text-white border-transparent`
                                            : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                                    }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Deep Scraping + Search Button */}
                    <div className="flex items-center justify-between pt-2">
                        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={deepScraping}
                                onChange={e => setDeepScraping(e.target.checked)}
                                className="rounded border-border"
                            />
                            <Zap className="h-3.5 w-3.5" />
                            Extrair dados adicionais dos sites (mais lento)
                        </label>
                        <button
                            onClick={handleSearch}
                            disabled={isSearching}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                            {isSearching ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> Buscando...</>
                            ) : (
                                <><Search className="h-4 w-4" /> Buscar Prospectos</>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Loading State */}
            {isSearching && searchStatus === "running" && (
                <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Buscando prospectos em múltiplas plataformas...</p>
                    {results.length > 0 && (
                        <p className="text-xs text-muted-foreground">{results.length} encontrados até agora</p>
                    )}
                </div>
            )}

            {/* Results */}
            {results.length > 0 && !isSearching && (
                <>
                    {/* Stats Bar */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-sm">
                            <Globe className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold text-foreground">{stats.total}</span>
                            <span className="text-muted-foreground">resultados</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-sm">
                            <Phone className="h-4 w-4 text-emerald-500" />
                            <span className="font-semibold text-foreground">{stats.withPhone}</span>
                            <span className="text-muted-foreground">com telefone</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-sm">
                            <Mail className="h-4 w-4 text-blue-500" />
                            <span className="font-semibold text-foreground">{stats.withEmail}</span>
                            <span className="text-muted-foreground">com email</span>
                        </div>
                        {stats.whatsappConfirmed > 0 && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm">
                                <MessageCircle className="h-4 w-4 text-emerald-500" />
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{stats.whatsappConfirmed}</span>
                                <span className="text-emerald-600/70 dark:text-emerald-400/70">WhatsApp</span>
                            </div>
                        )}
                        {stats.byPlatform.map(p => (
                            <div key={p.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-sm">
                                <span className={`h-2 w-2 rounded-full ${p.color}`} />
                                <span className="font-semibold text-foreground">{p.count}</span>
                                <span className="text-muted-foreground text-xs">{p.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Filter Bar */}
                    <div className="flex items-center gap-2 flex-wrap bg-card border border-border rounded-xl p-3">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        <input
                            id="search-filter"
                            name="search-filter"
                            type="text"
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                            placeholder="Buscar por nome, empresa..."
                            className="flex-1 max-w-[240px] px-3 py-1.5 bg-secondary/50 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                        />
                        <select
                            value={filterPlatform || ""}
                            onChange={e => setFilterPlatform(e.target.value || null)}
                            className="px-3 py-1.5 bg-secondary/50 border border-border rounded-md text-xs text-foreground focus:outline-none"
                        >
                            <option value="">Todas plataformas</option>
                            {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        <button
                            onClick={() => setFilterHasPhone(!filterHasPhone)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                                filterHasPhone ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground"
                            }`}
                        >
                            Com Telefone
                        </button>
                        <button
                            onClick={() => setFilterHasEmail(!filterHasEmail)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                                filterHasEmail ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30" : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground"
                            }`}
                        >
                            Com Email
                        </button>
                        <button
                            onClick={() => setFilterWhatsApp(!filterWhatsApp)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                                filterWhatsApp ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground"
                            }`}
                        >
                            <MessageCircle className="inline h-3 w-3 mr-1 -mt-0.5" />
                            WhatsApp
                        </button>
                        <div className="ml-auto text-xs text-muted-foreground">
                            Mostrando {filteredResults.length} de {results.length}
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="flex items-center gap-2">
                        <button onClick={selectAll} className="px-3 py-1.5 text-xs font-medium bg-secondary text-foreground rounded-md hover:bg-secondary/80 transition-all">
                            Selecionar Todos ({filteredResults.length})
                        </button>
                        <button onClick={selectWithPhone} className="px-3 py-1.5 text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md hover:bg-emerald-500/20 transition-all">
                            Selecionar Com Telefone ({filteredResults.filter(r => r.phone).length})
                        </button>
                        {selectedIds.size > 0 && (
                            <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all">
                                Limpar seleção
                            </button>
                        )}
                    </div>

                    {/* Results Table */}
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border bg-secondary/50">
                                        <th className="w-10 p-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.size === filteredResults.length && filteredResults.length > 0}
                                                onChange={() => selectedIds.size === filteredResults.length ? setSelectedIds(new Set()) : selectAll()}
                                                className="rounded border-border"
                                            />
                                        </th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("name")}>
                                            Nome {sortBy === "name" && <ArrowUpDown className="inline h-3 w-3 ml-1" />}
                                        </th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Cargo / Snippet</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Telefone</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Email</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("platform")}>
                                            Plataforma {sortBy === "platform" && <ArrowUpDown className="inline h-3 w-3 ml-1" />}
                                        </th>
                                        <th className="text-right p-3 font-semibold text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("priority_score")}>
                                            Score {sortBy === "priority_score" && <ArrowUpDown className="inline h-3 w-3 ml-1" />}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredResults.map((r) => (
                                        <Fragment key={r.id}>
                                            <tr
                                                onClick={() => toggleSelect(r.id)}
                                                className={`border-b border-border/50 cursor-pointer transition-colors ${
                                                    selectedIds.has(r.id) ? "bg-primary/5" : "hover:bg-secondary/30"
                                                }`}
                                            >
                                                <td className="p-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.has(r.id)}
                                                        onChange={() => toggleSelect(r.id)}
                                                        className="rounded border-border"
                                                    />
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-medium text-foreground">{r.name || "—"}</span>
                                                        {r.cnpj_data && (
                                                            <button
                                                                onClick={e => { e.stopPropagation(); setExpandedCnpj(expandedCnpj === r.id ? null : r.id) }}
                                                                className="text-primary hover:text-primary/80"
                                                                title="Ver dados CNPJ"
                                                            >
                                                                <Info className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    {r.profile_url && (
                                                        <a
                                                            href={r.profile_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={e => e.stopPropagation()}
                                                            className="text-xs text-primary hover:underline"
                                                        >
                                                            Ver perfil
                                                        </a>
                                                    )}
                                                </td>
                                                <td className="p-3 text-muted-foreground max-w-[200px] truncate">{r.role_snippet || "—"}</td>
                                                <td className="p-3">
                                                    {r.phone ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{r.phone}</span>
                                                            {whatsappBadge(r.whatsapp_status)}
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground">—</span>
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    {r.email ? (
                                                        <span className="text-blue-600 dark:text-blue-400">{r.email}</span>
                                                    ) : (
                                                        <span className="text-muted-foreground">—</span>
                                                    )}
                                                </td>
                                                <td className="p-3">{platformBadge(r.source_platform)}</td>
                                                <td className="p-3 text-right">
                                                    <span className={`font-semibold ${r.priority_score >= 1000 ? "text-emerald-600 dark:text-emerald-400" : r.priority_score >= 100 ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`}>
                                                        {r.priority_score}
                                                    </span>
                                                </td>
                                            </tr>
                                            {/* CNPJ Expanded Row */}
                                            {expandedCnpj === r.id && r.cnpj_data && (
                                                <tr key={`${r.id}-cnpj`} className="bg-secondary/20">
                                                    <td colSpan={7} className="p-4">
                                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                                            <div>
                                                                <span className="text-muted-foreground block">Razão Social</span>
                                                                <span className="font-medium text-foreground">{r.cnpj_data.razao_social || "—"}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground block">CNAE</span>
                                                                <span className="font-medium text-foreground">{r.cnpj_data.cnae_fiscal_descricao || "—"}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground block">Porte</span>
                                                                <span className="font-medium text-foreground">{r.cnpj_data.porte || "—"}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground block">Capital Social</span>
                                                                <span className="font-medium text-foreground">
                                                                    {r.cnpj_data.capital_social ? `R$ ${Number(r.cnpj_data.capital_social).toLocaleString("pt-BR")}` : "—"}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground block">Localização</span>
                                                                <span className="font-medium text-foreground">
                                                                    {[r.cnpj_data.municipio, r.cnpj_data.uf].filter(Boolean).join(" - ") || "—"}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground block">Situação</span>
                                                                <span className="font-medium text-foreground">{r.cnpj_data.descricao_situacao_cadastral || "—"}</span>
                                                            </div>
                                                            {r.cnpj_data.qsa && r.cnpj_data.qsa.length > 0 && (
                                                                <div className="col-span-2">
                                                                    <span className="text-muted-foreground block">Sócios</span>
                                                                    <span className="font-medium text-foreground">
                                                                        {r.cnpj_data.qsa.map((s: any) => s.nome_socio || s.nome).join(", ")}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* Empty state */}
            {searchStatus === "completed" && results.length === 0 && !isSearching && (
                <div className="bg-card border border-border rounded-xl p-8 text-center">
                    <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Nenhum prospecto encontrado. Tente refinar sua busca.</p>
                </div>
            )}

            {/* Action Bar */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-sm border-t border-border p-4 z-50">
                    <div className="max-w-[1400px] mx-auto flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">
                            <CheckSquare className="inline h-4 w-4 mr-1.5 text-primary -mt-0.5" />
                            {selectedIds.size} selecionados
                            {selectedWithPhone > 0 && (
                                <span className="text-muted-foreground ml-1">({selectedWithPhone} com telefone)</span>
                            )}
                        </span>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleEnrich}
                                disabled={isEnriching}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-all disabled:opacity-50"
                            >
                                {isEnriching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                                Enriquecer Dados
                            </button>
                            <button
                                onClick={() => setShowCampaignDialog(true)}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all shadow-sm"
                            >
                                Criar Campanha
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Campaign Dialog */}
            {showCampaignDialog && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-lg font-bold text-foreground">Criar Campanha</h2>
                            <button onClick={() => setShowCampaignDialog(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Nome da Campanha *</label>
                                <input
                                    id="campaign-name"
                                    name="campaign-name"
                                    type="text"
                                    value={campaignName}
                                    onChange={(e) => setCampaignName(e.target.value)}
                                    placeholder="Ex: Personal Trainers SP - Março 2026"
                                    className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Descrição (opcional)</label>
                                <textarea
                                    id="campaign-desc"
                                    name="campaign-desc"
                                    value={campaignDesc}
                                    onChange={(e) => setCampaignDesc(e.target.value)}
                                    placeholder="Descrição da campanha..."
                                    className="w-full h-20 px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                                />
                            </div>
                            <div className="bg-secondary/50 rounded-lg p-3 text-xs text-muted-foreground">
                                <Phone className="inline h-3.5 w-3.5 mr-1 text-emerald-500 -mt-0.5" />
                                {selectedWithPhone} prospectos com telefone serão importados como leads
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowCampaignDialog(false)}
                                    className="flex-1 px-4 py-2.5 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleCreateCampaign}
                                    disabled={!campaignName.trim() || isCreatingCampaign}
                                    className="flex-1 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isCreatingCampaign && <Loader2 className="inline h-4 w-4 animate-spin mr-1" />}
                                    Criar e Disparar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
