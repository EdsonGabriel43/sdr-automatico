import { getLeadDetails } from "@/app/actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowLeft, Send } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

export default async function LeadChatPage({ params }: { params: { id: string } }) {
    const data = await getLeadDetails(params.id)

    if (!data) {
        return <div className="text-white">Lead não encontrado</div>
    }

    const { lead, conversation, messages } = data

    return (
        <div className="h-[calc(100vh-8rem)] grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Detalhes do Lead (Lateral) */}
            <div className="md:col-span-1 space-y-6">
                <div className="flex items-center gap-4 mb-4">
                    <Button variant="ghost" size="icon" className="rounded-full" asChild>
                        <Link href="/kanban">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                    </Button>
                    <h2 className="text-xl font-bold text-white">Detalhes</h2>
                </div>

                <Card className="glass-card border-l-4 border-primary">
                    <CardHeader>
                        <CardTitle>{lead.nome}</CardTitle>
                        <p className="text-sm text-muted-foreground">{lead.cargo}</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
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
                                <label className="text-xs font-semibold text-muted-foreground uppercase">Linkedin</label>
                                <a href={lead.linkedin} target="_blank" className="block text-primary text-sm hover:underline truncate">
                                    {lead.linkedin}
                                </a>
                            </div>
                        )}
                        <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase">Passivo Estimado</label>
                            <p className="text-emerald-400 font-bold">
                                {lead.valor_divida ? `R$ ${lead.valor_divida}` : 'Não informado'}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="glass-card">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Status da Conversa</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between mb-4">
                            <Badge variant={conversation?.status === 'active' ? 'default' : 'secondary'}>
                                {conversation?.status || 'Sem conversa'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">Step {conversation?.current_step || 0}</span>
                        </div>
                        <Button className="w-full" variant="outline" disabled>
                            Assumir Conversa (Em Breve)
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {/* Chat (Central) */}
            <div className="md:col-span-2 flex flex-col glass-card rounded-xl overflow-hidden border border-border/50 h-full">
                <div className="p-4 border-b border-border/50 bg-secondary/20 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-white">
                        {lead.nome.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <h3 className="font-bold text-white">{lead.nome} - WhatsApp</h3>
                        <p className="text-xs text-emerald-400 flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            Online (Bot Ativo)
                        </p>
                    </div>
                </div>

                <ScrollArea className="flex-1 p-4 bg-background/50">
                    <div className="space-y-4">
                        {messages.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground text-sm">
                                Nenhuma mensagem trocada ainda.
                            </div>
                        )}

                        {messages.map((msg: any) => {
                            const isOutbound = msg.direction === 'outbound'
                            return (
                                <div key={msg.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[70%] rounded-2xl p-3 px-4 shadow-sm ${isOutbound
                                            ? 'bg-primary text-primary-foreground rounded-br-none'
                                            : 'bg-card border border-border/50 text-white rounded-bl-none'
                                        }`}>
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                                        <span className={`text-[10px] block mt-1 opacity-70 ${isOutbound ? 'text-right' : 'text-left'}`}>
                                            {format(new Date(msg.created_at), "HH:mm • dd/MM", { locale: ptBR })}
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </ScrollArea>

                <div className="p-4 border-t border-border/50 bg-card/30 backdrop-blur-md">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Digite uma mensagem para intervir..."
                            className="flex-1 bg-background/50 border border-border rounded-full px-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                            disabled
                        />
                        <Button size="icon" className="rounded-full" disabled>
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 text-center">
                        Intervenção manual desativada nesta versão.
                    </p>
                </div>
            </div>
        </div>
    )
}
