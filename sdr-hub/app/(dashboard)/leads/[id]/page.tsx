"use client"

import { useEffect, useState, useRef } from "react"
import { getLeadDetails, sendManualMessage } from "@/app/actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowLeft, Send, Bot, User, Loader2 } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

const STATUS_LABELS: Record<string, string> = {
    pending: "Pendente", contacted: "Contatado", responded: "Respondeu",
    nurturing: "Nurturing", qualified: "Qualificado", handed_off: "Handoff",
    not_interested: "Nao Interessado", wrong_person: "Pessoa Errada",
    no_response: "Sem Resposta", blocked: "Bloqueado",
    meeting_scheduled: "Reuniao Marcada", meeting_no_show: "Nao Compareceu",
}

export default function LeadChatPage({ params }: { params: { id: string } }) {
    const [data, setData] = useState<any>(null)
    const [messages, setMessages] = useState<any[]>([])
    const [input, setInput] = useState("")
    const [sending, setSending] = useState(false)
    const [error, setError] = useState("")
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        getLeadDetails(params.id).then((d) => {
            if (d) { setData(d); setMessages(d.messages || []) }
        })
    }, [params.id])

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

    async function handleSend() {
        if (!input.trim() || !data?.conversation) return
        setSending(true); setError("")
        const result = await sendManualMessage(data.conversation.id, input.trim())
        if (result.success) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(), direction: "outbound",
                content: input.trim(), message_type: "manual",
                created_at: new Date().toISOString(),
            }])
            setInput("")
        } else { setError(result.error || "Erro ao enviar") }
        setSending(false)
    }

    if (!data) return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...
        </div>
    )

    const { lead, conversation } = data

    return (
        <div className="h-[calc(100vh-8rem)] grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                    <Button variant="ghost" size="icon" className="rounded-full" asChild>
                        <Link href="/kanban"><ArrowLeft className="h-5 w-5" /></Link>
                    </Button>
                    <h2 className="text-xl font-bold text-white">Detalhes</h2>
                </div>
                <Card className="glass-card border-l-4 border-primary">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-white">{lead.nome}</CardTitle>
                        <p className="text-sm text-muted-foreground">{lead.cargo}</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase">Empresa</label>
                            <p className="text-white font-medium">{lead.empresa}</p>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase">Telefone</label>
                            <p className="text-white font-medium">{lead.telefone}</p>
                        </div>
                        {lead.linkedin && (
                            <div>
                                <label className="text-xs font-semibold text-muted-foreground uppercase">LinkedIn</label>
                                <a href={lead.linkedin} target="_blank" className="block text-primary text-sm hover:underline truncate">{lead.linkedin}</a>
                            </div>
                        )}
                        <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase">Passivo Estimado</label>
                            <p className="text-emerald-400 font-bold">
                                {lead.valor_divida ? ("R$ " + Number(lead.valor_divida).toLocaleString("pt-BR")) : "Nao informado"}
                            </p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="glass-card">
                    <CardHeader className="pb-2"><CardTitle className="text-lg">Status</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30">
                                {STATUS_LABELS[conversation?.status] || conversation?.status || "Sem conversa"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">Step {conversation?.current_step ?? 0}</span>
                        </div>
                        {conversation?.intent_classification && (
                            <div>
                                <label className="text-xs font-semibold text-muted-foreground uppercase">Intencao</label>
                                <p className="text-white text-sm">{conversation.intent_classification}</p>
                            </div>
                        )}
                        {(conversation?.follow_up_count ?? 0) > 0 && (
                            <div>
                                <label className="text-xs font-semibold text-muted-foreground uppercase">Follow-ups enviados</label>
                                <p className="text-white text-sm">{conversation.follow_up_count}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="md:col-span-2 flex flex-col glass-card rounded-xl overflow-hidden border border-border/50 h-full">
                <div className="p-4 border-b border-border/50 bg-secondary/20 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-white">
                        {lead.nome?.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <h3 className="font-bold text-white">{lead.nome} - WhatsApp</h3>
                        <p className="text-xs text-emerald-400 flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            {conversation?.status === "handed_off" ? "Handoff - controle humano" : "Agente ativo"}
                        </p>
                    </div>
                </div>

                <ScrollArea className="flex-1 p-4 bg-background/50">
                    <div className="space-y-4">
                        {messages.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground text-sm">Nenhuma mensagem ainda.</div>
                        )}
                        {messages.map((msg: any) => {
                            const isOut = msg.direction === "outbound"
                            const isManual = msg.message_type === "manual"
                            return (
                                <div key={msg.id} className={"flex " + (isOut ? "justify-end" : "justify-start")}>
                                    <div className={"max-w-[70%] rounded-2xl p-3 px-4 shadow-sm " + (
                                        isOut
                                            ? isManual ? "bg-amber-600 text-white rounded-br-none" : "bg-primary text-primary-foreground rounded-br-none"
                                            : "bg-card border border-border/50 text-white rounded-bl-none"
                                    )}>
                                        <div className="flex items-center gap-1 text-[10px] opacity-60 mb-1">
                                            {isOut && isManual && <><User className="h-3 w-3" /><span>Manual</span></>}
                                            {isOut && !isManual && <><Bot className="h-3 w-3" /><span>Nexa</span></>}
                                            {!isOut && <><User className="h-3 w-3" /><span>Lead</span></>}
                                        </div>
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                                        <span className={"text-[10px] block mt-1 opacity-70 " + (isOut ? "text-right" : "text-left")}>
                                            {format(new Date(msg.created_at), "HH:mm - dd/MM", { locale: ptBR })}
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                        <div ref={bottomRef} />
                    </div>
                </ScrollArea>

                <div className="p-4 border-t border-border/50 bg-card/30 backdrop-blur-md">
                    {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
                    <div className="flex gap-2">
                        <input
                            type="text" value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                            placeholder="Intervencao manual - enviado como bot no WhatsApp..."
                            className="flex-1 bg-background/50 border border-border rounded-full px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                            disabled={!conversation}
                        />
                        <Button size="icon" className="rounded-full" onClick={handleSend}
                            disabled={!input.trim() || sending || !conversation}>
                            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                    </div>
                    <p className="text-[10px] text-amber-400/70 mt-2 text-center">
                        Msgs manuais aparecem em amarelo e sao enviadas via bot
                    </p>
                </div>
            </div>
        </div>
    )
}
