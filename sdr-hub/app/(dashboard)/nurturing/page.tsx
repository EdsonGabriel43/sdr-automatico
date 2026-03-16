"use client"

import { useEffect, useState, useTransition } from "react"
import { getNurturingLeads, triggerNurturingFollowup, closeNurturingLead } from "@/app/actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RefreshCw, Send, X, Clock, Building2, Phone, MessageSquare } from "lucide-react"
import Link from "next/link"

const stepLabels: Record<number, string> = {
    1: "Identificação",
    2: "Autoridade",
    3: "Pitch",
    4: "Qualificação",
    5: "Handoff",
}

const statusColors: Record<string, string> = {
    responded: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    nurturing: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    qualified: "bg-green-500/20 text-green-300 border-green-500/30",
}

function urgencyColor(hours: number) {
    if (hours >= 48) return "text-red-400"
    if (hours >= 24) return "text-orange-400"
    if (hours >= 2) return "text-yellow-400"
    return "text-green-400"
}

function formatHours(h: number) {
    if (h < 1) return "< 1h"
    if (h < 24) return `${h}h`
    const days = Math.floor(h / 24)
    const rem = h % 24
    return rem > 0 ? `${days}d ${rem}h` : `${days}d`
}

export default function NurturingPage() {
    const [leads, setLeads] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [actionMap, setActionMap] = useState<Record<string, "triggering" | "closing" | null>>({})
    const [, startTransition] = useTransition()

    async function load() {
        setLoading(true)
        const data = await getNurturingLeads()
        setLeads(data as any[])
        setLoading(false)
    }

    useEffect(() => { load() }, [])

    async function handleTrigger(convId: string) {
        setActionMap(m => ({ ...m, [convId]: "triggering" }))
        await triggerNurturingFollowup(convId)
        setActionMap(m => ({ ...m, [convId]: null }))
        await load()
    }

    async function handleClose(convId: string) {
        setActionMap(m => ({ ...m, [convId]: "closing" }))
        await closeNurturingLead(convId)
        setActionMap(m => ({ ...m, [convId]: null }))
        setLeads(l => l.filter(c => c.id !== convId))
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Nurturing</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Leads em conversa ativa que pararam de responder
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                    Atualizar
                </Button>
            </div>

            {/* Resumo */}
            <div className="grid grid-cols-3 gap-4">
                {(["responded", "nurturing", "qualified"] as const).map(status => {
                    const count = leads.filter(l => l.status === status).length
                    return (
                        <Card key={status} className="glass border-border/50">
                            <CardContent className="pt-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground capitalize">{status}</span>
                                    <Badge className={statusColors[status]}>{count}</Badge>
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            {/* Lista de leads */}
            {loading ? (
                <div className="text-center text-muted-foreground py-12">Carregando...</div>
            ) : leads.length === 0 ? (
                <Card className="glass border-border/50">
                    <CardContent className="py-12 text-center text-muted-foreground">
                        Nenhum lead em nurturing no momento.
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {leads.map((conv) => {
                        const lead = conv.leads as any
                        const action = actionMap[conv.id]
                        const followupCount = conv.follow_up_count ?? 0
                        const nextFollowup = conv.next_follow_up_at
                            ? new Date(conv.next_follow_up_at)
                            : null
                        const isPastDue = nextFollowup && nextFollowup < new Date()

                        return (
                            <Card key={conv.id} className="glass border-border/50 hover:border-primary/30 transition-colors">
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-white">
                                                    {lead?.nome ?? "—"}
                                                </span>
                                                <Badge className={statusColors[conv.status]}>
                                                    {conv.status}
                                                </Badge>
                                                <Badge variant="outline" className="text-xs">
                                                    {stepLabels[conv.current_step] ?? `Step ${conv.current_step}`}
                                                </Badge>
                                                <Badge variant="outline" className="text-xs">
                                                    FU {followupCount}/4
                                                </Badge>
                                            </div>

                                            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    <Building2 className="h-3 w-3" />
                                                    {lead?.empresa ?? "—"}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Phone className="h-3 w-3" />
                                                    {lead?.telefone ?? "—"}
                                                </span>
                                            </div>

                                            {conv.last_bot_message && (
                                                <div className="mt-2 flex items-start gap-1">
                                                    <MessageSquare className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                                                    <p className="text-xs text-muted-foreground italic truncate">
                                                        "{conv.last_bot_message}"
                                                    </p>
                                                </div>
                                            )}

                                            <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${urgencyColor(conv.hours_waiting)}`}>
                                                <Clock className="h-3 w-3" />
                                                Sem resposta há {formatHours(conv.hours_waiting)}
                                                {isPastDue && (
                                                    <span className="ml-2 text-red-400 font-semibold">• Follow-up atrasado!</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-2 shrink-0">
                                            <Button
                                                size="sm"
                                                className="gap-1"
                                                onClick={() => handleTrigger(conv.id)}
                                                disabled={!!action}
                                            >
                                                <Send className="h-3 w-3" />
                                                {action === "triggering" ? "Enviando..." : "Acionar agora"}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="gap-1 text-muted-foreground"
                                                onClick={() => handleClose(conv.id)}
                                                disabled={!!action}
                                            >
                                                <X className="h-3 w-3" />
                                                {action === "closing" ? "Encerrando..." : "Encerrar"}
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
