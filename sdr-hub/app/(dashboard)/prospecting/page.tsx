"use client"

import { useState, useEffect, useMemo, Fragment, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
    Search, Loader2, Phone, Mail, Globe, CheckSquare, Zap, X, Filter,
    ArrowUpDown, Info, MessageCircle, Download, Clock, Trash2, Pencil,
    ChevronLeft, Plus, Tag, RotateCw, ExternalLink
} from "lucide-react"
import { toast } from "sonner"
import {
    startProspectingSearch, getProspectingResults, enrichProspects,
    createCampaignFromProspects, listSavedSearches, renameSearch,
    deleteSearch, deleteProspectResult, updateProspectResult,
    startCnpjEnrichment, startSocialEnrichment
} from "@/app/actions"

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
    tags?: string | null
    notes?: string | null
}

interface SavedSearch {
    id: string
    query_text: string
    search_type: string
    filters: { platforms?: string[]; location?: string | null }
    status: string
    total_results: number
    platforms_searched: string[] | null
    created_at: string
    completed_at: string | null
}

type PageView = "new_search" | "saved_searches" | "view_search" | "cnpj_enrich" | "social_enrich"

export default function ProspectingPage() {
    const router = useRouter()

    // View state
    const [view, setView] = useState<PageView>("new_search")
    const [viewingSearchId, setViewingSearchId] = useState<string | null>(null)

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

    // Saved searches
    const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
    const [loadingSaved, setLoadingSaved] = useState(false)

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
    const [editingNote, setEditingNote] = useState<string | null>(null)
    const [editNoteValue, setEditNoteValue] = useState("")
    const [renamingSearch, setRenamingSearch] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState("")

    // CNPJ enrichment state
    const [cnpjRows, setCnpjRows] = useState<{ cnpj: string; name: string }[]>([{ cnpj: "", name: "" }])
    const [cnpjPlatforms, setCnpjPlatforms] = useState(["linkedin", "google"])

    // Social enrichment state
    const [socialUrls, setSocialUrls] = useState<string[]>([""])
    const [useApify, setUseApify] = useState(false)

    // Filtered results
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
                (r.role_snippet || "").toLowerCase().includes(q) ||
                (r.tags || "").toLowerCase().includes(q)
            )
        }
        return [...filtered].sort((a, b) => {
            if (sortBy === "priority_score") return sortDesc ? b.priority_score - a.priority_score : a.priority_score - b.priority_score
            if (sortBy === "name") return sortDesc ? (b.name || "").localeCompare(a.name || "") : (a.name || "").localeCompare(b.name || "")
            return sortDesc ? (b.source_platform || "").localeCompare(a.source_platform || "") : (a.source_platform || "").localeCompare(b.source_platform || "")
        })
    }, [results, filterPlatform, filterHasPhone, filterHasEmail, filterWhatsApp, searchText, sortBy, sortDesc])

    // Load saved searches
    const loadSavedSearches = useCallback(async () => {
        setLoadingSaved(true)
        const res = await listSavedSearches()
        if (res.success) setSavedSearches(res.data || [])
        setLoadingSaved(false)
    }, [])

    useEffect(() => { loadSavedSearches() }, [loadSavedSearches])

    // Polling
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
                        const nr = res.data.results || []
                        const ns = res.data.search?.status || "running"
                        if (nr.length > 0) setResults(nr)
                        if (ns === "completed") {
                            setResults(nr)
                            setSearchStatus("completed")
                            setIsSearching(false)
                            toast.success(`${nr.length} prospectos encontrados!`)
                            loadSavedSearches()
                            break
                        } else if (ns === "failed") {
                            setSearchStatus("failed")
                            setIsSearching(false)
                            toast.error("Erro na busca.")
                            break
                        }
                    }
                } catch (e) { console.error("[Prospecting] Poll error:", e) }
            }
        }
        poll()
        return () => { active = false }
    }, [searchId, searchStatus, loadSavedSearches])

    // --- Handlers ---

    const handleSearch = async () => {
        if (!smartQuery.trim()) { toast.error("Digite uma busca"); return }
        setIsSearching(true)
        setSearchId(null)
        setResults([])
        setSelectedIds(new Set())
        setSearchStatus("pending")
        setView("new_search")

        const res = await startProspectingSearch(smartQuery, "natural_language", selectedPlatforms, location.trim() || null, deepScraping)
        if (res.success && res.data) {
            setSearchId(res.data.search_id)
            setSearchStatus("running")
            toast.info("Busca iniciada!")
        } else {
            setIsSearching(false)
            toast.error(res.error || "Erro ao iniciar busca")
        }
    }

    const handleCnpjEnrich = async () => {
        const validRows = cnpjRows.filter(r => r.cnpj.replace(/\D/g, "").length >= 11)
        if (validRows.length === 0) { toast.error("Adicione pelo menos um CNPJ válido"); return }

        setIsSearching(true)
        setSearchId(null)
        setResults([])
        setSelectedIds(new Set())
        setSearchStatus("pending")

        const items = validRows.map(r => ({ cnpj: r.cnpj, decision_maker_name: r.name || undefined }))
        const res = await startCnpjEnrichment(items, cnpjPlatforms)
        if (res.success && res.data) {
            setSearchId(res.data.search_id)
            setSearchStatus("running")
            setView("new_search")
            toast.info(`Enriquecendo ${validRows.length} CNPJs...`)
        } else {
            setIsSearching(false)
            toast.error(res.error || "Erro ao iniciar enriquecimento")
        }
    }

    const addCnpjRow = () => setCnpjRows(prev => [...prev, { cnpj: "", name: "" }])
    const removeCnpjRow = (idx: number) => setCnpjRows(prev => prev.filter((_, i) => i !== idx))
    const updateCnpjRow = (idx: number, field: "cnpj" | "name", value: string) => {
        setCnpjRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
    }

    const parseCnpjPaste = (text: string) => {
        const lines = text.split("\n").filter(l => l.trim())
        const rows = lines.map(line => {
            const parts = line.split(/[;\t,]/).map(p => p.trim())
            return { cnpj: parts[0] || "", name: parts[1] || "" }
        }).filter(r => r.cnpj)
        if (rows.length > 1) {
            setCnpjRows(rows)
            toast.success(`${rows.length} CNPJs importados`)
        }
    }

    // Social enrichment handlers
    const handleSocialEnrich = async () => {
        const validUrls = socialUrls.filter(u => u.trim())
        if (validUrls.length === 0) { toast.error("Adicione pelo menos um link"); return }

        setIsSearching(true)
        setSearchId(null)
        setResults([])
        setSelectedIds(new Set())
        setSearchStatus("pending")

        const items = validUrls.map(u => ({ url: u.trim() }))
        const res = await startSocialEnrichment(items, useApify)
        if (res.success && res.data) {
            setSearchId(res.data.search_id)
            setSearchStatus("running")
            setView("new_search")
            toast.info(`Buscando contatos de ${validUrls.length} perfis...`)
        } else {
            setIsSearching(false)
            toast.error(res.error || "Erro ao iniciar enriquecimento")
        }
    }

    const addSocialUrl = () => setSocialUrls(prev => [...prev, ""])
    const removeSocialUrl = (idx: number) => setSocialUrls(prev => prev.filter((_, i) => i !== idx))
    const updateSocialUrl = (idx: number, value: string) => setSocialUrls(prev => prev.map((u, i) => i === idx ? value : u))

    const parseSocialPaste = (text: string) => {
        const lines = text.split("\n").map(l => l.trim()).filter(l => l)
        if (lines.length > 1) {
            setSocialUrls(lines)
            toast.success(`${lines.length} links importados`)
        }
    }

    const openSavedSearch = async (s: SavedSearch) => {
        setViewingSearchId(s.id)
        setSearchId(s.id)
        setView("view_search")
        const res = await getProspectingResults(s.id)
        if (res.success && res.data) {
            setResults(res.data.results || [])
            setSearchStatus(res.data.search?.status || "completed")
        }
    }

    const handleDeleteSearch = async (id: string) => {
        if (!confirm("Excluir esta pesquisa e todos os resultados?")) return
        const res = await deleteSearch(id)
        if (res.success) {
            toast.success("Pesquisa excluída")
            loadSavedSearches()
            if (viewingSearchId === id) { setView("saved_searches"); setResults([]) }
        }
    }

    const handleRenameSearch = async (id: string) => {
        if (!renameValue.trim()) return
        await renameSearch(id, renameValue.trim())
        setRenamingSearch(null)
        loadSavedSearches()
        toast.success("Pesquisa renomeada")
    }

    const handleDeleteProspect = async (id: string) => {
        await deleteProspectResult(id)
        setResults(prev => prev.filter(r => r.id !== id))
        setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
        toast.success("Prospecto removido")
    }

    const handleUpdateNote = async (id: string) => {
        await updateProspectResult(id, { notes: editNoteValue })
        setResults(prev => prev.map(r => r.id === id ? { ...r, notes: editNoteValue } : r))
        setEditingNote(null)
        toast.success("Nota salva")
    }

    const handleAddTag = async (id: string, tag: string) => {
        const r = results.find(r => r.id === id)
        const existing = r?.tags ? r.tags.split(",").map(t => t.trim()) : []
        if (existing.includes(tag)) return
        const newTags = [...existing, tag].join(", ")
        await updateProspectResult(id, { tags: newTags })
        setResults(prev => prev.map(r => r.id === id ? { ...r, tags: newTags } : r))
    }

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
    }
    const selectAll = () => setSelectedIds(new Set(filteredResults.map(r => r.id)))
    const selectWithPhone = () => setSelectedIds(new Set(filteredResults.filter(r => r.phone).map(r => r.id)))

    const handleEnrich = async () => {
        if (selectedIds.size === 0) return
        setIsEnriching(true)
        const res = await enrichProspects(Array.from(selectedIds))
        if (res.success) {
            toast.success(`${res.data?.enriched || 0} prospectos enriquecidos!`)
            const sid = searchId || viewingSearchId
            if (sid) { const u = await getProspectingResults(sid); if (u.success) setResults(u.data?.results || []) }
        } else toast.error("Erro ao enriquecer")
        setIsEnriching(false)
    }

    const handleCreateCampaign = async () => {
        const sid = searchId || viewingSearchId
        if (!campaignName.trim() || !sid) return
        setIsCreatingCampaign(true)
        const res = await createCampaignFromProspects(sid, Array.from(selectedIds), campaignName, campaignDesc)
        if (res.success) {
            toast.success(`Campanha criada com ${res.data?.leads_imported || 0} leads!`)
            setShowCampaignDialog(false)
            router.push("/campaigns")
        } else toast.error(res.error || "Erro ao criar campanha")
        setIsCreatingCampaign(false)
    }

    const togglePlatform = (id: string) => setSelectedPlatforms(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
    const toggleSort = (col: "priority_score" | "name" | "platform") => {
        if (sortBy === col) setSortDesc(!sortDesc); else { setSortBy(col); setSortDesc(true) }
    }

    // CSV Export
    const exportCSV = () => {
        const rows = filteredResults.filter(r => selectedIds.has(r.id))
        if (rows.length === 0) { toast.error("Selecione prospectos para exportar"); return }
        const header = "Nome,Telefone,Email,Empresa,Plataforma,WhatsApp\n"
        const csv = header + rows.map(r =>
            [r.name, r.phone, r.email, r.company, r.source_platform, r.whatsapp_status]
                .map(v => `"${(v || "").replace(/"/g, '""')}"`)
                .join(",")
        ).join("\n")
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `prospectos_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`${rows.length} prospectos exportados`)
    }

    const stats = {
        total: results.length,
        withPhone: results.filter(r => r.phone).length,
        withEmail: results.filter(r => r.email).length,
        whatsappConfirmed: results.filter(r => r.whatsapp_status === "confirmed").length,
        byPlatform: PLATFORMS.map(p => ({ ...p, count: results.filter(r => r.source_platform === p.id).length })).filter(p => p.count > 0),
    }

    const platformBadge = (platform: string) => {
        const p = PLATFORMS.find(p => p.id === platform)
        return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${p?.color || "bg-gray-500"}`}>{p?.label || platform}</span>
    }

    const whatsappBadge = (status: string) => {
        if (status === "confirmed") return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><MessageCircle className="h-3 w-3" />WhatsApp</span>
        if (status === "not_whatsapp") return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-500">Sem WhatsApp</span>
        return null
    }

    const selectedWithPhone = results.filter(r => selectedIds.has(r.id) && r.phone).length
    const formatDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

    // ============== RENDER ==============

    return (
        <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Prospectar</h1>
                    <p className="text-sm text-muted-foreground mt-1">Busque e gerencie prospectos</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => { setView("new_search"); setResults([]); setSearchId(null); setSearchStatus(null) }}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            view === "new_search" ? "bg-primary text-primary-foreground shadow-sm" : "bg-secondary text-foreground hover:bg-secondary/80"
                        }`}
                    >
                        <Plus className="h-4 w-4" /> Nova Busca
                    </button>
                    <button
                        onClick={() => { setView("saved_searches"); loadSavedSearches() }}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            view === "saved_searches" ? "bg-primary text-primary-foreground shadow-sm" : "bg-secondary text-foreground hover:bg-secondary/80"
                        }`}
                    >
                        <Clock className="h-4 w-4" /> Buscas Anteriores
                    </button>
                    <button
                        onClick={() => setView("cnpj_enrich")}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            view === "cnpj_enrich" ? "bg-primary text-primary-foreground shadow-sm" : "bg-secondary text-foreground hover:bg-secondary/80"
                        }`}
                    >
                        <Info className="h-4 w-4" /> Enriquecer CNPJ
                    </button>
                    <button
                        onClick={() => setView("social_enrich")}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            view === "social_enrich" ? "bg-primary text-primary-foreground shadow-sm" : "bg-secondary text-foreground hover:bg-secondary/80"
                        }`}
                    >
                        <Globe className="h-4 w-4" /> Redes Sociais
                    </button>
                </div>
            </div>

            {/* =================== NEW SEARCH VIEW =================== */}
            {view === "new_search" && (
                <>
                    <div className="bg-card border border-border rounded-xl p-6">
                        <div className="space-y-4">
                            <textarea
                                value={smartQuery}
                                onChange={e => setSmartQuery(e.target.value)}
                                placeholder="Ex: Personal trainers em São Paulo, CTOs de fintechs em Curitiba..."
                                className="w-full h-24 px-4 py-3 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                            />
                            <div className="flex items-center gap-3 flex-wrap">
                                <input id="location" name="location" type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="Localização (opcional)" className="flex-1 max-w-xs px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
                                <div className="flex items-center gap-2 flex-wrap">
                                    {PLATFORMS.map(p => (
                                        <button key={p.id} onClick={() => togglePlatform(p.id)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${selectedPlatforms.includes(p.id) ? `${p.color} text-white border-transparent` : "bg-secondary text-muted-foreground border-border hover:text-foreground"}`}>
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center justify-between pt-2">
                                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                                    <input type="checkbox" checked={deepScraping} onChange={e => setDeepScraping(e.target.checked)} className="rounded border-border" />
                                    <Zap className="h-3.5 w-3.5" /> Extrair dados adicionais (mais lento)
                                </label>
                                <button onClick={handleSearch} disabled={isSearching} className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm">
                                    {isSearching ? <><Loader2 className="h-4 w-4 animate-spin" /> Buscando...</> : <><Search className="h-4 w-4" /> Buscar Prospectos</>}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Loading */}
                    {isSearching && searchStatus === "running" && (
                        <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Buscando prospectos...</p>
                            {results.length > 0 && <p className="text-xs text-muted-foreground">{results.length} encontrados até agora</p>}
                        </div>
                    )}

                    {/* Empty state */}
                    {searchStatus === "completed" && results.length === 0 && !isSearching && (
                        <div className="bg-card border border-border rounded-xl p-8 text-center">
                            <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground">Nenhum prospecto encontrado. Tente refinar sua busca.</p>
                        </div>
                    )}
                </>
            )}

            {/* =================== SAVED SEARCHES VIEW =================== */}
            {view === "saved_searches" && (
                <div className="space-y-4">
                    {loadingSaved ? (
                        <div className="bg-card border border-border rounded-xl p-8 flex items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                    ) : savedSearches.length === 0 ? (
                        <div className="bg-card border border-border rounded-xl p-8 text-center">
                            <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground">Nenhuma busca salva ainda.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {savedSearches.map(s => (
                                <div key={s.id} className="bg-card border border-border rounded-xl p-5 hover:border-primary/40 transition-all cursor-pointer group" onClick={() => openSavedSearch(s)}>
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1 min-w-0">
                                            {renamingSearch === s.id ? (
                                                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                    <input type="text" value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => e.key === "Enter" && handleRenameSearch(s.id)} className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                                                    <button onClick={() => handleRenameSearch(s.id)} className="text-primary text-xs font-medium">Salvar</button>
                                                    <button onClick={() => setRenamingSearch(null)} className="text-muted-foreground text-xs">Cancelar</button>
                                                </div>
                                            ) : (
                                                <h3 className="font-semibold text-foreground text-sm truncate">{s.query_text}</h3>
                                            )}
                                            <p className="text-xs text-muted-foreground mt-1">{formatDate(s.created_at)}</p>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                            <button onClick={() => { setRenamingSearch(s.id); setRenameValue(s.query_text) }} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Renomear">
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                            <button onClick={() => handleDeleteSearch(s.id)} className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500" title="Excluir">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${s.status === "completed" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-500"}`}>
                                            {s.total_results} resultados
                                        </span>
                                        {(s.filters?.platforms || []).slice(0, 3).map(pid => {
                                            const p = PLATFORMS.find(pp => pp.id === pid)
                                            return p ? <span key={pid} className={`h-2 w-2 rounded-full ${p.color}`} title={p.label} /> : null
                                        })}
                                        {s.filters?.location && <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{s.filters.location}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* =================== SOCIAL ENRICHMENT VIEW =================== */}
            {view === "social_enrich" && (
                <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                    <div>
                        <h2 className="text-sm font-semibold text-foreground mb-1">Enriquecer por Redes Sociais</h2>
                        <p className="text-xs text-muted-foreground">Cole links de Instagram, TikTok, Facebook ou X/Twitter. O sistema busca telefone, WhatsApp, email e nome real.</p>
                    </div>

                    <div className="bg-secondary/30 border border-border rounded-lg p-3 text-xs text-muted-foreground">
                        Dica: cole múltiplos links (um por linha) no primeiro campo para importar em lote.
                    </div>

                    {/* URL Rows */}
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {socialUrls.map((url, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={url}
                                    onChange={e => updateSocialUrl(idx, e.target.value)}
                                    onPaste={e => {
                                        const text = e.clipboardData.getData("text")
                                        if (text.includes("\n")) { e.preventDefault(); parseSocialPaste(text) }
                                    }}
                                    placeholder="https://instagram.com/username"
                                    className="flex-1 px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                                />
                                {socialUrls.length > 1 && (
                                    <button onClick={() => removeSocialUrl(idx)} className="p-2 text-muted-foreground hover:text-red-500 transition-colors">
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <button onClick={addSocialUrl} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-secondary text-foreground rounded-md hover:bg-secondary/80">
                        <Plus className="h-3 w-3" /> Adicionar link
                    </button>

                    {/* Options + Submit */}
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={useApify}
                                onChange={e => setUseApify(e.target.checked)}
                                className="rounded border-border"
                            />
                            <Zap className="h-3.5 w-3.5" />
                            Busca profunda (Apify — mais dados, mais lento)
                        </label>
                        <button
                            onClick={handleSocialEnrich}
                            disabled={isSearching || socialUrls.every(u => !u.trim())}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                            {isSearching ? <><Loader2 className="h-4 w-4 animate-spin" /> Buscando...</> : <><Search className="h-4 w-4" /> Buscar Contatos ({socialUrls.filter(u => u.trim()).length})</>}
                        </button>
                    </div>
                </div>
            )}

            {/* =================== CNPJ ENRICHMENT VIEW =================== */}
            {view === "cnpj_enrich" && (
                <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                    <div>
                        <h2 className="text-sm font-semibold text-foreground mb-1">Enriquecer por CNPJ</h2>
                        <p className="text-xs text-muted-foreground">Cole CNPJs e nomes dos decisores. O sistema consulta Receita Federal, busca contatos no Google/LinkedIn e tenta encontrar email e telefone.</p>
                    </div>

                    {/* Paste area hint */}
                    <div className="bg-secondary/30 border border-border rounded-lg p-3 text-xs text-muted-foreground">
                        Dica: cole direto do Excel/planilha no formato <strong>CNPJ ; Nome do Decisor</strong> (um por linha) no primeiro campo CNPJ.
                    </div>

                    {/* CNPJ Rows */}
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {cnpjRows.map((row, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={row.cnpj}
                                    onChange={e => updateCnpjRow(idx, "cnpj", e.target.value)}
                                    onPaste={e => {
                                        const text = e.clipboardData.getData("text")
                                        if (text.includes("\n") || text.includes(";") || text.includes("\t")) {
                                            e.preventDefault()
                                            parseCnpjPaste(text)
                                        }
                                    }}
                                    placeholder="00.000.000/0001-00"
                                    className="flex-1 max-w-[220px] px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                                />
                                <input
                                    type="text"
                                    value={row.name}
                                    onChange={e => updateCnpjRow(idx, "name", e.target.value)}
                                    placeholder="Nome do decisor (opcional)"
                                    className="flex-1 px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                                />
                                {cnpjRows.length > 1 && (
                                    <button onClick={() => removeCnpjRow(idx)} className="p-2 text-muted-foreground hover:text-red-500 transition-colors">
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <button onClick={addCnpjRow} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-secondary text-foreground rounded-md hover:bg-secondary/80">
                        <Plus className="h-3 w-3" /> Adicionar linha
                    </button>

                    {/* Platforms + Submit */}
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Buscar em:</span>
                            {PLATFORMS.filter(p => ["linkedin", "instagram", "google"].includes(p.id)).map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => setCnpjPlatforms(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                                        cnpjPlatforms.includes(p.id) ? `${p.color} text-white border-transparent` : "bg-secondary text-muted-foreground border-border"
                                    }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={handleCnpjEnrich}
                            disabled={isSearching || cnpjRows.every(r => !r.cnpj.trim())}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                            {isSearching ? <><Loader2 className="h-4 w-4 animate-spin" /> Enriquecendo...</> : <><Zap className="h-4 w-4" /> Enriquecer {cnpjRows.filter(r => r.cnpj.trim()).length} CNPJs</>}
                        </button>
                    </div>
                </div>
            )}

            {/* =================== VIEW SEARCH (viewing saved search) =================== */}
            {view === "view_search" && (
                <div className="flex items-center gap-3">
                    <button onClick={() => { setView("saved_searches"); setResults([]) }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-all">
                        <ChevronLeft className="h-4 w-4" /> Voltar
                    </button>
                    <h2 className="text-lg font-semibold text-foreground">{savedSearches.find(s => s.id === viewingSearchId)?.query_text || "Pesquisa"}</h2>
                    <button onClick={() => { const s = savedSearches.find(s => s.id === viewingSearchId); if (s) { setSmartQuery(s.query_text); setLocation(s.filters?.location || ""); setSelectedPlatforms(s.filters?.platforms || ["linkedin", "instagram", "google", "google_places"]); setView("new_search") } }} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-secondary text-foreground rounded-md hover:bg-secondary/80">
                        <RotateCw className="h-3 w-3" /> Refazer busca
                    </button>
                </div>
            )}

            {/* =================== RESULTS TABLE (shared) =================== */}
            {results.length > 0 && !isSearching && (view === "new_search" || view === "view_search" || view === "cnpj_enrich" || view === "social_enrich") && (
                <>
                    {/* Stats */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-sm">
                            <Globe className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold text-foreground">{stats.total}</span>
                            <span className="text-muted-foreground">resultados</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-sm">
                            <Phone className="h-4 w-4 text-emerald-500" />
                            <span className="font-semibold">{stats.withPhone}</span>
                            <span className="text-muted-foreground">com telefone</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-sm">
                            <Mail className="h-4 w-4 text-blue-500" />
                            <span className="font-semibold">{stats.withEmail}</span>
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
                                <span className="font-semibold">{p.count}</span>
                                <span className="text-muted-foreground text-xs">{p.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Filter Bar */}
                    <div className="flex items-center gap-2 flex-wrap bg-card border border-border rounded-xl p-3">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        <input id="search-filter" name="search-filter" type="text" value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Buscar nome, empresa, tag..." className="flex-1 max-w-[240px] px-3 py-1.5 bg-secondary/50 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30" />
                        <select value={filterPlatform || ""} onChange={e => setFilterPlatform(e.target.value || null)} className="px-3 py-1.5 bg-secondary/50 border border-border rounded-md text-xs text-foreground focus:outline-none">
                            <option value="">Todas plataformas</option>
                            {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        {[
                            { active: filterHasPhone, toggle: () => setFilterHasPhone(!filterHasPhone), label: "Com Telefone", color: "emerald" },
                            { active: filterHasEmail, toggle: () => setFilterHasEmail(!filterHasEmail), label: "Com Email", color: "blue" },
                            { active: filterWhatsApp, toggle: () => setFilterWhatsApp(!filterWhatsApp), label: "WhatsApp", color: "emerald" },
                        ].map(f => (
                            <button key={f.label} onClick={f.toggle} className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${f.active ? `bg-${f.color}-500/10 text-${f.color}-600 dark:text-${f.color}-400 border-${f.color}-500/30` : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground"}`}>
                                {f.label}
                            </button>
                        ))}
                        <div className="ml-auto text-xs text-muted-foreground">
                            Mostrando {filteredResults.length} de {results.length}
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={selectAll} className="px-3 py-1.5 text-xs font-medium bg-secondary text-foreground rounded-md hover:bg-secondary/80">
                            Selecionar Todos ({filteredResults.length})
                        </button>
                        <button onClick={selectWithPhone} className="px-3 py-1.5 text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md hover:bg-emerald-500/20">
                            Com Telefone ({filteredResults.filter(r => r.phone).length})
                        </button>
                        {selectedIds.size > 0 && (
                            <>
                                <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">Limpar</button>
                                <button onClick={exportCSV} className="px-3 py-1.5 text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-500/20 inline-flex items-center gap-1">
                                    <Download className="h-3 w-3" /> Exportar CSV ({selectedIds.size})
                                </button>
                            </>
                        )}
                    </div>

                    {/* Table */}
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border bg-secondary/50">
                                        <th className="w-10 p-3"><input type="checkbox" checked={selectedIds.size === filteredResults.length && filteredResults.length > 0} onChange={() => selectedIds.size === filteredResults.length ? setSelectedIds(new Set()) : selectAll()} className="rounded border-border" /></th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("name")}>Nome {sortBy === "name" && <ArrowUpDown className="inline h-3 w-3 ml-1" />}</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Cargo / Snippet</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Telefone</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground">Email</th>
                                        <th className="text-left p-3 font-semibold text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("platform")}>Plataforma {sortBy === "platform" && <ArrowUpDown className="inline h-3 w-3 ml-1" />}</th>
                                        <th className="text-right p-3 font-semibold text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("priority_score")}>Score {sortBy === "priority_score" && <ArrowUpDown className="inline h-3 w-3 ml-1" />}</th>
                                        <th className="w-10 p-3"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredResults.map(r => (
                                        <Fragment key={r.id}>
                                            <tr onClick={() => toggleSelect(r.id)} className={`border-b border-border/50 cursor-pointer transition-colors ${selectedIds.has(r.id) ? "bg-primary/5" : "hover:bg-secondary/30"}`}>
                                                <td className="p-3"><input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} className="rounded border-border" /></td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-medium text-foreground">{r.name || "—"}</span>
                                                        {r.cnpj_data && <button onClick={e => { e.stopPropagation(); setExpandedCnpj(expandedCnpj === r.id ? null : r.id) }} className="text-primary hover:text-primary/80" title="Dados CNPJ"><Info className="h-3.5 w-3.5" /></button>}
                                                    </div>
                                                    {r.profile_url && <a href={r.profile_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"><ExternalLink className="h-3 w-3" />Perfil</a>}
                                                    {r.tags && <div className="flex gap-1 mt-1 flex-wrap">{r.tags.split(",").map(t => <span key={t.trim()} className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium">{t.trim()}</span>)}</div>}
                                                    {r.notes && <p className="text-[10px] text-muted-foreground mt-0.5 italic truncate max-w-[200px]">{r.notes}</p>}
                                                </td>
                                                <td className="p-3 text-muted-foreground max-w-[180px] truncate">{r.role_snippet || "—"}</td>
                                                <td className="p-3">{r.phone ? <div className="flex items-center gap-1.5"><span className="text-emerald-600 dark:text-emerald-400 font-medium">{r.phone}</span>{whatsappBadge(r.whatsapp_status)}</div> : <span className="text-muted-foreground">—</span>}</td>
                                                <td className="p-3">{r.email ? <span className="text-blue-600 dark:text-blue-400">{r.email}</span> : <span className="text-muted-foreground">—</span>}</td>
                                                <td className="p-3">{platformBadge(r.source_platform)}</td>
                                                <td className="p-3 text-right"><span className={`font-semibold ${r.priority_score >= 1000 ? "text-emerald-600 dark:text-emerald-400" : r.priority_score >= 100 ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`}>{r.priority_score}</span></td>
                                                <td className="p-3" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity">
                                                        <button onClick={() => { setEditingNote(r.id); setEditNoteValue(r.notes || "") }} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Nota"><Pencil className="h-3 w-3" /></button>
                                                        <button onClick={() => handleAddTag(r.id, prompt("Tag:") || "")} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Tag"><Tag className="h-3 w-3" /></button>
                                                        <button onClick={() => handleDeleteProspect(r.id)} className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500" title="Remover"><Trash2 className="h-3 w-3" /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                            {/* CNPJ Expanded */}
                                            {expandedCnpj === r.id && r.cnpj_data && (
                                                <tr className="bg-secondary/20">
                                                    <td colSpan={8} className="p-4">
                                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                                            {[
                                                                { label: "Razão Social", val: r.cnpj_data.razao_social },
                                                                { label: "CNAE", val: r.cnpj_data.cnae_fiscal_descricao },
                                                                { label: "Porte", val: r.cnpj_data.porte },
                                                                { label: "Capital Social", val: r.cnpj_data.capital_social ? `R$ ${Number(r.cnpj_data.capital_social).toLocaleString("pt-BR")}` : null },
                                                                { label: "Localização", val: [r.cnpj_data.municipio, r.cnpj_data.uf].filter(Boolean).join(" - ") },
                                                                { label: "Situação", val: r.cnpj_data.descricao_situacao_cadastral },
                                                            ].map(d => (
                                                                <div key={d.label}><span className="text-muted-foreground block">{d.label}</span><span className="font-medium text-foreground">{d.val || "—"}</span></div>
                                                            ))}
                                                            {r.cnpj_data.qsa?.length > 0 && (
                                                                <div className="col-span-2"><span className="text-muted-foreground block">Sócios</span><span className="font-medium text-foreground">{r.cnpj_data.qsa.map((s: any) => s.nome_socio || s.nome).join(", ")}</span></div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                            {/* Note Editing */}
                                            {editingNote === r.id && (
                                                <tr className="bg-secondary/10">
                                                    <td colSpan={8} className="p-3">
                                                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                            <input type="text" value={editNoteValue} onChange={e => setEditNoteValue(e.target.value)} placeholder="Adicionar nota..." className="flex-1 px-3 py-1.5 bg-secondary border border-border rounded-md text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" autoFocus onKeyDown={e => e.key === "Enter" && handleUpdateNote(r.id)} />
                                                            <button onClick={() => handleUpdateNote(r.id)} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium">Salvar</button>
                                                            <button onClick={() => setEditingNote(null)} className="px-3 py-1.5 text-xs text-muted-foreground">Cancelar</button>
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

            {/* Action Bar */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-sm border-t border-border p-4 z-50">
                    <div className="max-w-[1400px] mx-auto flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">
                            <CheckSquare className="inline h-4 w-4 mr-1.5 text-primary -mt-0.5" />
                            {selectedIds.size} selecionados
                            {selectedWithPhone > 0 && <span className="text-muted-foreground ml-1">({selectedWithPhone} com telefone)</span>}
                        </span>
                        <div className="flex items-center gap-3">
                            <button onClick={exportCSV} className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-all">
                                <Download className="h-4 w-4" /> CSV
                            </button>
                            <button onClick={handleEnrich} disabled={isEnriching} className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-all disabled:opacity-50">
                                {isEnriching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Enriquecer
                            </button>
                            <button onClick={() => setShowCampaignDialog(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all shadow-sm">
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
                            <button onClick={() => setShowCampaignDialog(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Nome da Campanha *</label>
                                <input id="campaign-name" name="campaign-name" type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="Ex: Personal Trainers SP - Março 2026" className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Descrição (opcional)</label>
                                <textarea id="campaign-desc" name="campaign-desc" value={campaignDesc} onChange={e => setCampaignDesc(e.target.value)} placeholder="Descrição..." className="w-full h-20 px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                            </div>
                            <div className="bg-secondary/50 rounded-lg p-3 text-xs text-muted-foreground">
                                <Phone className="inline h-3.5 w-3.5 mr-1 text-emerald-500 -mt-0.5" />
                                {selectedWithPhone} prospectos com telefone serão importados
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setShowCampaignDialog(false)} className="flex-1 px-4 py-2.5 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80">Cancelar</button>
                                <button onClick={handleCreateCampaign} disabled={!campaignName.trim() || isCreatingCampaign} className="flex-1 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
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
