"use client"

import { useState, useEffect, useCallback } from "react"
import {
    Smartphone, Wifi, WifiOff, QrCode, RefreshCw, Plus, Pause, Play,
    Power, ArrowLeftRight, Loader2, X, Signal, MessageCircle
} from "lucide-react"
import { toast } from "sonner"
import {
    getChipsStatus, getChipQRData, disconnectChip, reconnectChip,
    swapChip, updateChipStatusAction, createChipAction
} from "@/app/actions"

interface Chip {
    id: string
    instance_name: string
    phone_number: string | null
    status: string
    warming_start_date: string | null
    warming_day: number
    daily_limit: number
    messages_sent_today: number
    total_messages_sent: number
    last_message_at: string | null
    created_at: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: "Ativo", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
    warming: { label: "Aquecendo", color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30" },
    paused: { label: "Pausado", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
    disconnected: { label: "Desconectado", color: "text-red-500", bg: "bg-red-500/10 border-red-500/30" },
    banned: { label: "Banido", color: "text-red-700 dark:text-red-400", bg: "bg-red-500/10 border-red-500/30" },
    auth_failure: { label: "Erro Auth", color: "text-red-500", bg: "bg-red-500/10 border-red-500/30" },
}

export default function ChipsPage() {
    const [chips, setChips] = useState<Chip[]>([])
    const [loading, setLoading] = useState(true)
    const [showQR, setShowQR] = useState(false)
    const [qrData, setQrData] = useState<{ status: string; qr: string | null; number: string | null; name: string | null }>({ status: "disconnected", qr: null, number: null, name: null })
    const [qrAction, setQrAction] = useState<string>("")
    const [showNewChip, setShowNewChip] = useState(false)
    const [newInstanceName, setNewInstanceName] = useState("wa-server")
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    const loadChips = useCallback(async () => {
        const res = await getChipsStatus()
        if (res.success && res.chips) setChips(res.chips)
        setLoading(false)
    }, [])

    useEffect(() => { loadChips() }, [loadChips])

    // Auto-refresh every 10s
    useEffect(() => {
        const interval = setInterval(loadChips, 10000)
        return () => clearInterval(interval)
    }, [loadChips])

    // QR polling when showing QR
    useEffect(() => {
        if (!showQR) return
        let active = true
        const poll = async () => {
            while (active) {
                const data = await getChipQRData()
                if (!active) break
                setQrData(data)
                if (data.status === "connected") {
                    toast.success(`WhatsApp conectado! ${data.number || ""}`)
                    setShowQR(false)
                    loadChips()
                    break
                }
                await new Promise(r => setTimeout(r, 3000))
            }
        }
        poll()
        return () => { active = false }
    }, [showQR, loadChips])

    const handleDisconnect = async (chipId: string) => {
        if (!confirm("Desconectar este chip do WhatsApp?")) return
        setActionLoading(chipId)
        const res = await disconnectChip(chipId)
        if (res.success) { toast.success("Chip desconectado"); loadChips() }
        else toast.error("Erro ao desconectar")
        setActionLoading(null)
    }

    const handleReconnect = async (chipId: string) => {
        setActionLoading(chipId)
        const res = await reconnectChip(chipId)
        if (res.success) {
            toast.info("Reconectando... Escaneie o QR Code")
            setQrAction(`Reconectando chip`)
            setShowQR(true)
        } else toast.error("Erro ao reconectar")
        setActionLoading(null)
    }

    const handleSwap = async (chipId: string) => {
        if (!confirm("Trocar número? O chip será desconectado e um novo QR será gerado para outro telefone.")) return
        setActionLoading(chipId)
        const res = await swapChip(chipId)
        if (res.success) {
            toast.info("Escaneie o QR Code com o novo telefone")
            setQrAction("Escaneie com o novo número")
            setShowQR(true)
            loadChips()
        } else toast.error("Erro ao trocar número")
        setActionLoading(null)
    }

    const handleTogglePause = async (chip: Chip) => {
        const newStatus = chip.status === "paused" ? "active" : "paused"
        setActionLoading(chip.id)
        const res = await updateChipStatusAction(chip.id, newStatus)
        if (res.success) { toast.success(newStatus === "paused" ? "Chip pausado" : "Chip retomado"); loadChips() }
        else toast.error("Erro ao atualizar status")
        setActionLoading(null)
    }

    const handleCreateChip = async () => {
        if (!newInstanceName.trim()) return
        const res = await createChipAction(newInstanceName.trim())
        if (res.success) {
            toast.success("Chip registrado! Escaneie o QR Code")
            setShowNewChip(false)
            setQrAction("Conecte o novo chip")
            setShowQR(true)
            loadChips()
        } else toast.error("Erro ao criar chip")
    }

    const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Chips WhatsApp</h1>
                    <p className="text-sm text-muted-foreground mt-1">Gerencie seus números de disparo</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={loadChips} className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-all">
                        <RefreshCw className="h-4 w-4" /> Atualizar
                    </button>
                    <button onClick={() => setShowNewChip(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all shadow-sm">
                        <Plus className="h-4 w-4" /> Novo Chip
                    </button>
                </div>
            </div>

            {/* QR Code Section */}
            {showQR && (
                <div className="bg-card border-2 border-primary/30 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                                <QrCode className="h-5 w-5 text-primary" /> Conectar WhatsApp
                            </h2>
                            {qrAction && <p className="text-sm text-muted-foreground mt-1">{qrAction}</p>}
                        </div>
                        <button onClick={() => setShowQR(false)} className="text-muted-foreground hover:text-foreground">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="flex flex-col items-center gap-4">
                        {qrData.status === "qr" && qrData.qr ? (
                            <>
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrData.qr)}`}
                                    alt="QR Code"
                                    className="rounded-xl border-4 border-primary/20"
                                    width={280}
                                    height={280}
                                />
                                <p className="text-sm text-muted-foreground">Abra o WhatsApp → Configurações → Dispositivos Conectados → Vincular</p>
                            </>
                        ) : qrData.status === "connected" ? (
                            <div className="text-center py-8">
                                <Wifi className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                                <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">Conectado!</p>
                                <p className="text-sm text-muted-foreground">{qrData.number} — {qrData.name}</p>
                            </div>
                        ) : (
                            <div className="text-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                                <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* New Chip Dialog */}
            {showNewChip && (
                <div className="bg-card border border-border rounded-xl p-6">
                    <h3 className="text-sm font-semibold text-foreground mb-3">Registrar Novo Chip</h3>
                    <div className="flex items-center gap-3">
                        <input
                            id="instance-name"
                            name="instance-name"
                            type="text"
                            value={newInstanceName}
                            onChange={e => setNewInstanceName(e.target.value)}
                            placeholder="Nome da instância"
                            className="flex-1 max-w-xs px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <button onClick={handleCreateChip} className="px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90">
                            Criar e Conectar
                        </button>
                        <button onClick={() => setShowNewChip(false)} className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground">
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {/* Chips Grid */}
            {chips.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                    <Smartphone className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-lg font-semibold text-foreground mb-2">Nenhum chip cadastrado</p>
                    <p className="text-sm text-muted-foreground mb-4">Registre um chip para começar a enviar mensagens</p>
                    <button onClick={() => setShowNewChip(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold">
                        <Plus className="h-4 w-4" /> Novo Chip
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {chips.map(chip => {
                        const cfg = STATUS_CONFIG[chip.status] || STATUS_CONFIG.disconnected
                        const usagePercent = chip.daily_limit > 0 ? Math.min((chip.messages_sent_today / chip.daily_limit) * 100, 100) : 0
                        const isLoading = actionLoading === chip.id

                        return (
                            <div key={chip.id} className={`bg-card border rounded-xl p-5 transition-all ${cfg.bg}`}>
                                {/* Header */}
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${chip.status === "active" || chip.status === "warming" ? "bg-emerald-500/10" : "bg-secondary"}`}>
                                            {chip.status === "active" || chip.status === "warming" ? (
                                                <Wifi className="h-5 w-5 text-emerald-500" />
                                            ) : (
                                                <WifiOff className="h-5 w-5 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-foreground text-sm">{chip.instance_name}</h3>
                                            <p className="text-xs text-muted-foreground">{chip.phone_number || "Não conectado"}</p>
                                        </div>
                                    </div>
                                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${cfg.bg} ${cfg.color}`}>
                                        {cfg.label}
                                    </span>
                                </div>

                                {/* Stats */}
                                <div className="space-y-3 mb-4">
                                    {/* Usage bar */}
                                    <div>
                                        <div className="flex items-center justify-between text-xs mb-1">
                                            <span className="text-muted-foreground flex items-center gap-1">
                                                <MessageCircle className="h-3 w-3" /> Hoje
                                            </span>
                                            <span className="font-medium text-foreground">{chip.messages_sent_today} / {chip.daily_limit}</span>
                                        </div>
                                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all ${usagePercent >= 90 ? "bg-red-500" : usagePercent >= 70 ? "bg-yellow-500" : "bg-emerald-500"}`}
                                                style={{ width: `${usagePercent}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div>
                                            <span className="text-muted-foreground block">Total enviadas</span>
                                            <span className="font-semibold text-foreground">{chip.total_messages_sent}</span>
                                        </div>
                                        {chip.status === "warming" && (
                                            <div>
                                                <span className="text-muted-foreground block">Aquecimento</span>
                                                <span className="font-semibold text-yellow-600 dark:text-yellow-400">Dia {chip.warming_day}/14</span>
                                            </div>
                                        )}
                                        <div>
                                            <span className="text-muted-foreground block">Última msg</span>
                                            <span className="font-medium text-foreground">{formatDate(chip.last_message_at)}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                                    {isLoading ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-primary mx-auto" />
                                    ) : (
                                        <>
                                            {(chip.status === "active" || chip.status === "warming") && (
                                                <>
                                                    <button onClick={() => handleTogglePause(chip)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-secondary text-foreground rounded-lg text-xs font-medium hover:bg-secondary/80 transition-all" title="Pausar">
                                                        <Pause className="h-3.5 w-3.5" /> Pausar
                                                    </button>
                                                    <button onClick={() => handleDisconnect(chip.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-red-500/10 text-red-500 rounded-lg text-xs font-medium hover:bg-red-500/20 transition-all" title="Desconectar">
                                                        <Power className="h-3.5 w-3.5" /> Desconectar
                                                    </button>
                                                    <button onClick={() => handleSwap(chip.id)} className="inline-flex items-center justify-center p-2 bg-secondary text-foreground rounded-lg hover:bg-secondary/80 transition-all" title="Trocar número">
                                                        <ArrowLeftRight className="h-3.5 w-3.5" />
                                                    </button>
                                                </>
                                            )}
                                            {chip.status === "paused" && (
                                                <>
                                                    <button onClick={() => handleTogglePause(chip)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-500/20 transition-all">
                                                        <Play className="h-3.5 w-3.5" /> Retomar
                                                    </button>
                                                    <button onClick={() => handleDisconnect(chip.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-red-500/10 text-red-500 rounded-lg text-xs font-medium hover:bg-red-500/20 transition-all">
                                                        <Power className="h-3.5 w-3.5" /> Desconectar
                                                    </button>
                                                </>
                                            )}
                                            {(chip.status === "disconnected" || chip.status === "auth_failure") && (
                                                <>
                                                    <button onClick={() => handleReconnect(chip.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-all shadow-sm">
                                                        <Signal className="h-3.5 w-3.5" /> Reconectar
                                                    </button>
                                                    <button onClick={() => handleSwap(chip.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-secondary text-foreground rounded-lg text-xs font-medium hover:bg-secondary/80 transition-all">
                                                        <ArrowLeftRight className="h-3.5 w-3.5" /> Trocar Número
                                                    </button>
                                                </>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
