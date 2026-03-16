"use client"

import { useEffect, useState } from "react"
import { getConversations, getMessages } from "@/app/actions"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Search, Bot, User, Phone, Briefcase, FileText } from "lucide-react"

export default function ChatPage() {
    const [conversations, setConversations] = useState<any[]>([])
    const [messages, setMessages] = useState<any[]>([])
    const [selectedConv, setSelectedConv] = useState<any>(null)
    const [loadingConvs, setLoadingConvs] = useState(true)
    const [loadingMsgs, setLoadingMsgs] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")

    useEffect(() => {
        loadConversations()
    }, [])

    async function loadConversations() {
        setLoadingConvs(true)
        const data = await getConversations()
        setConversations(data || [])
        setLoadingConvs(false)
    }

    async function handleSelectConversation(conv: any) {
        setSelectedConv(conv)
        setLoadingMsgs(true)
        const msgs = await getMessages(conv.id)
        setMessages(msgs || [])
        setLoadingMsgs(false)
    }

    const filteredConvs = conversations.filter(c => {
        const text = `${c.leads?.nome} ${c.leads?.empresa} ${c.leads?.telefone}`.toLowerCase()
        return text.includes(searchTerm.toLowerCase())
    })

    const statusColors: any = {
        nurturing: "bg-blue-500/20 text-blue-400",
        qualified: "bg-emerald-500/20 text-emerald-400",
        responded: "bg-amber-500/20 text-amber-400",
        contacted: "bg-purple-500/20 text-purple-400",
        blocked: "bg-red-500/20 text-red-400",
        not_interested: "bg-zinc-500/20 text-zinc-400",
        wrong_person: "bg-rose-500/20 text-rose-400",
        handed_off: "bg-indigo-500/20 text-indigo-400"
    }

    return (
        <div className="h-[calc(100vh-2rem)] flex gap-4">

            {/* Esquerda: Lista de Conversas */}
            <Card className="w-1/3 flex flex-col bg-zinc-900 border-zinc-800 overflow-hidden">
                <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
                    <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2 mb-4">
                        <User className="h-5 w-5" /> Contatos
                    </h2>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <Input
                            placeholder="Buscar nome, empresa ou telefone..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="pl-9 bg-zinc-950 border-zinc-800 text-zinc-200"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-zinc-700">
                    {loadingConvs ? (
                        <div className="text-center p-4 text-zinc-500 text-sm">Carregando contatos...</div>
                    ) : filteredConvs.length === 0 ? (
                        <div className="text-center p-4 text-zinc-500 text-sm">Nenhum contato encontrado.</div>
                    ) : (
                        <div className="space-y-1">
                            {filteredConvs.map(conv => (
                                <div
                                    key={conv.id}
                                    onClick={() => handleSelectConversation(conv)}
                                    className={`p-3 rounded-md cursor-pointer transition-colors border ${selectedConv?.id === conv.id
                                            ? 'bg-zinc-800 border-zinc-700'
                                            : 'bg-transparent border-transparent hover:bg-zinc-800/50'
                                        }`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className="font-medium text-zinc-200 truncate pr-2">{conv.leads?.nome}</h3>
                                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusColors[conv.status] || 'bg-zinc-800 text-zinc-300'}`}>
                                            {conv.status.replace('_', ' ')}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-zinc-400 truncate flex items-center gap-1">
                                        <Briefcase className="h-3 w-3" /> {conv.leads?.empresa || 'Empresa desconhecida'}
                                    </p>
                                    <p className="text-xs text-zinc-500 truncate mt-1">
                                        Última ação: {new Date(conv.updated_at).toLocaleDateString('pt-BR')}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </Card>

            {/* Direita: Mensagens (Inbox) */}
            <Card className="flex-1 flex flex-col bg-zinc-900 border-zinc-800 overflow-hidden relative">
                {!selectedConv ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 p-8 text-center bg-zinc-950/20">
                        <MessageSquare className="h-12 w-12 text-zinc-800 mb-4" />
                        <h3 className="text-xl font-medium text-zinc-400 mb-2">Caixa de Entrada</h3>
                        <p className="max-w-md">Selecione um contato na lista ao lado para visualizar o histórico completo da conversa e as métricas do Lead.</p>
                    </div>
                ) : (
                    <>
                        {/* Header do Lead Selecionado */}
                        <div className="p-4 border-b border-zinc-800 bg-zinc-900 flex justify-between items-center shadow-sm z-10">
                            <div>
                                <h2 className="text-lg font-semibold text-zinc-100">{selectedConv.leads?.nome}</h2>
                                <div className="flex items-center gap-4 mt-1 text-sm text-zinc-400">
                                    <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {selectedConv.leads?.empresa}</span>
                                    <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {selectedConv.leads?.telefone}</span>
                                </div>
                            </div>
                            <div className="text-right flex flex-col items-end gap-2">
                                <Badge variant="outline" className="border-primary/50 text-primary">
                                    Passivo: R$ {selectedConv.leads?.valor_divida?.toLocaleString('pt-BR')}
                                </Badge>
                                <span className="text-xs text-zinc-500">
                                    Intenção AI: <strong className="text-zinc-300">{selectedConv.intent_classification || 'N/A'}</strong>
                                </span>
                            </div>
                        </div>

                        {/* Área de Mensagens */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-950/50 scrollbar-thin scrollbar-thumb-zinc-700">
                            {loadingMsgs ? (
                                <div className="text-center p-4 text-zinc-500 text-sm">Carregando histórico...</div>
                            ) : messages.length === 0 ? (
                                <div className="text-center p-4 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-lg bg-zinc-900/40">
                                    Nenhuma mensagem trocada com este lead ainda.
                                </div>
                            ) : (
                                messages.map(msg => {
                                    const isBot = msg.direction === 'outbound';
                                    return (
                                        <div key={msg.id} className={`flex ${isBot ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`flex max-w-[70%] gap-3 ${isBot ? 'flex-row-reverse' : 'flex-row'}`}>

                                                {/* Avatar */}
                                                <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${isBot ? 'bg-primary/20 text-primary' : 'bg-zinc-800 text-zinc-400'}`}>
                                                    {isBot ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                                                </div>

                                                {/* Balao de Mensagem */}
                                                <div className={`p-3 rounded-2xl text-sm whitespace-pre-wrap ${isBot
                                                        ? 'bg-primary/90 text-primary-foreground rounded-tr-sm shadow-md'
                                                        : 'bg-zinc-800 text-zinc-200 rounded-tl-sm border border-zinc-700/50 shadow-sm'
                                                    }`}>
                                                    {msg.content}
                                                    <div className={`text-[10px] mt-1.5 text-right w-full ${isBot ? 'text-primary-foreground/70' : 'text-zinc-500'}`}>
                                                        {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>

                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </>
                )}
            </Card>

        </div>
    )
}

function MessageSquare(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
    )
}
