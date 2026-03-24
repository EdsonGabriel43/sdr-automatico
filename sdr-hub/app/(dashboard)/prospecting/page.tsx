"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Search, Loader2, Phone, Mail, Globe, MapPin, CheckSquare, Sparkles, Zap, X } from "lucide-react"
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
}

export default function ProspectingPage() {
    const router = useRouter()

    // Search state
    const [activeTab, setActiveTab] = useState<"smart" | "advanced">("smart")
    const [smartQuery, setSmartQuery] = useState("")
    const [keywords, setKeywords] = useState("")
    const [location, setLocation] = useState("")
    const [selectedPlatforms, setSelectedPlatforms] = useState(["linkedin", "instagram", "google", "google_places"])

    // Results state
    const [searchId, setSearchId] = useState<string | null>(null)
    const [searchStatus, setSearchStatus] = useState<string | null>(null)
    const [results, setResults] = useState<ProspectResult[]>([])
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    // UI state
    const [isSearching, setIsSearching] = useState(false)
    const [isEnriching, setIsEnriching] = useState(false)
    const [showCampaignDialog, setShowCampaignDialog] = useState(false)
    const [campaignName, setCampaignName] = useState("")
    const [campaignDesc, setCampaignDesc] = useState("")
    const [isCreatingCampaign, setIsCreatingCampaign] = useState(false)

    // Polling for results
    useEffect(() => {
        if (!searchId || searchStatus === "completed" || searchStatus === "failed") return

        const interval = setInterval(async () => {
            const res = await getProspectingResults(searchId)
            if (res.success && res.data) {
                setResults(res.data.results || [])
                setSearchStatus(res.data.search?.status)

                if (res.data.search?.status === "completed") {
                    setIsSearching(false)
                    toast.success(`${res.data.results?.length || 0} prospectos encontrados!`)
                } else if (res.data.search?.status === "failed") {
                    setIsSearching(false)
                    toast.error("Erro na busca. Tente novamente.")
                }
            }
        }, 2000)

        return () => clearInterval(interval)
    }, [searchId, searchStatus])

    const handleSearch = async () => {
        const query = activeTab === "smart" ? smartQuery : keywords
        if (!query.trim()) {
            toast.error("Digite uma busca")
            return
        }

        setIsSearching(true)
        setResults([])
        setSelectedIds(new Set())
        setSearchStatus("pending")

        const mode = activeTab === "smart" ? "natural_language" : "structured"
        const loc = location.trim() || null

        const res = await startProspectingSearch(query, mode, selectedPlatforms, loc)
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

    const selectAll = () => {
        setSelectedIds(new Set(results.map(r => r.id)))
    }

    const selectWithPhone = () => {
        setSelectedIds(new Set(results.filter(r => r.phone).map(r => r.id)))
    }

    const handleEnrich = async () => {
        if (selectedIds.size === 0) return
        setIsEnriching(true)
        const res = await enrichProspects(Array.from(selectedIds))
        if (res.success) {
            toast.success(`${res.data?.enriched || 0} prospectos enriquecidos!`)
            // Refresh results
            if (searchId) {
                const updated = await getProspectingResults(searchId)
                if (updated.success) setResults(updated.data.results || [])
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
        setSelectedPlatforms(prev =>
            prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
        )
    }

    const stats = {
        total: results.length,
        withPhone: results.filter(r => r.phone).length,
        withEmail: results.filter(r => r.email).length,
        byPlatform: PLATFORMS.map(p => ({
            ...p,
            count: results.filter(r => r.source_platform === p.id).length,
        })).filter(p => p.count > 0),
    }

    const platformBadge = (platform: string) => {
        const p = PLATFORMS.find(p => p.id === platform)
        return p ? (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${p.color}`}>
                {p.label}
            </span>
        ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500 text-white">
                {platform}
            </span>
        )
    }

    const selectedWithPhone = results.filter(r => selectedIds.has(r.id) && r.phone).length

    return (
        <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-foreground">Prospectar</h1>
                <p className="text-sm text-muted-foreground mt-1">Busque prospectos em LinkedIn, Instagram, Google e mais</p>
            </div>

            {/* Search Form */}
            <div className="bg-card border border-border rounded-xl p-6">
                {/* Tabs */}
                <div className="flex gap-1 p-1 bg-secondary rounded-lg w-fit mb-6">
                    <button
                        onClick={() => setActiveTab("smart")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                            activeTab === "smart" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Sparkles className="inline h-4 w-4 mr-1.5 -mt-0.5" />
                        Busca Inteligente
                    </button>
                    <button
                        onClick={() => setActiveTab("advanced")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                            activeTab === "advanced" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Busca Avançada
                    </button>
                </div>

                {activeTab === "smart" ? (
                    <div className="space-y-4">
                        <textarea
                            value={smartQuery}
                            onChange={(e) => setSmartQuery(e.target.value)}
                            placeholder="Ex: Personal trainers em São Paulo, Diretores de marketing de fintechs em Curitiba, Mentores de negócios no Instagram..."
                            className="w-full h-28 px-4 py-3 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                        />
                        <div className="flex items-center gap-3">
                            <input
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
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Palavras-chave</label>
                                <input
                                    type="text"
                                    value={keywords}
                                    onChange={(e) => setKeywords(e.target.value)}
                                    placeholder="Ex: Personal Trainer, Nutricionista, CEO"
                                    className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Localização</label>
                                <input
                                    type="text"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                    placeholder="Ex: São Paulo, Curitiba, Brasil"
                                    className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Plataformas</label>
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
                    </div>
                )}

                {/* Search Button */}
                <div className="mt-6">
                    <button
                        onClick={handleSearch}
                        disabled={isSearching}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                        {isSearching ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Buscando prospectos...
                            </>
                        ) : (
                            <>
                                <Search className="h-4 w-4" />
                                Buscar Prospectos
                            </>
                        )}
                    </button>
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
                    <div className="flex items-center gap-4 flex-wrap">
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
                        {stats.byPlatform.map(p => (
                            <div key={p.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-sm">
                                <span className={`h-2 w-2 rounded-full ${p.color}`} />
                                <span className="font-semibold text-foreground">{p.count}</span>
                                <span className="text-muted-foreground text-xs">{p.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Quick Actions */}
                    <div className="flex items-center gap-2">
                        <button onClick={selectAll} className="px-3 py-1.5 text-xs font-medium bg-secondary text-foreground rounded-md hover:bg-secondary/80 transition-all">
                            Selecionar Todos ({results.length})
                        </button>
                        <button onClick={selectWithPhone} className="px-3 py-1.5 text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md hover:bg-emerald-500/20 transition-all">
                            Selecionar Com Telefone ({stats.withPhone})
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
                                                checked={selectedIds.size === results.length && results.length > 0}
                                                onChange={() => selectedIds.size === results.length ? setSelectedIds(new Set()) : selectAll()}
                                                className="rounded border-border"
                                            />
                                        </th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Nome</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Cargo / Snippet</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Empresa</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Telefone</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Email</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Plataforma</th>
                                        <th className="text-right p-3 font-semibold text-muted-foreground">Score</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((r) => (
                                        <tr
                                            key={r.id}
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
                                                <div className="font-medium text-foreground">{r.name || "—"}</div>
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
                                            <td className="p-3 text-foreground">{r.company || "—"}</td>
                                            <td className="p-3">
                                                {r.phone ? (
                                                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">{r.phone}</span>
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
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* Empty state after search completed with 0 results */}
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
                            {selectedIds.size} prospectos selecionados
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

            {/* Campaign Creation Dialog */}
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
                                    {isCreatingCampaign ? (
                                        <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                                    ) : null}
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
