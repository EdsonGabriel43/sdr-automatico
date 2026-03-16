import { getCampaignDetails } from "@/app/actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Users, MessageSquare, CheckCircle, XCircle, Clock } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import Link from "next/link"
import { notFound } from "next/navigation"

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const data = await getCampaignDetails(id)

    if (!data) return notFound()

    const { campaign, conversations, metrics } = data

    const statusMap: Record<string, { label: string; color: string }> = {
        pending: { label: "Pendente", color: "bg-zinc-500/20 text-zinc-400" },
        contacted: { label: "Contatado", color: "bg-blue-500/20 text-blue-400" },
        active: { label: "Ativo", color: "bg-emerald-500/20 text-emerald-400" },
        nurturing: { label: "Nurturing", color: "bg-purple-500/20 text-purple-400" },
        responded: { label: "Respondeu", color: "bg-amber-500/20 text-amber-400" },
        qualified: { label: "Qualificado", color: "bg-green-500/20 text-green-400" },
        blocked: { label: "Bloqueado", color: "bg-red-500/20 text-red-400" },
        not_interested: { label: "Sem Interesse", color: "bg-zinc-600/20 text-zinc-500" },
        handed_off: { label: "Handoff", color: "bg-indigo-500/20 text-indigo-400" },
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link href="/campaigns"><ArrowLeft className="h-5 w-5" /></Link>
                </Button>
                <div className="flex-1">
                    <h1 className="text-3xl font-bold tracking-tight text-white">{campaign.name}</h1>
                    <p className="text-muted-foreground mt-1">{campaign.description || 'Sem descrição'}</p>
                </div>
                <Badge variant="outline" className={`text-sm px-3 py-1 ${campaign.status === 'active' ? 'border-green-500 text-green-500' :
                        campaign.status === 'completed' ? 'border-blue-500 text-blue-500' :
                            'border-yellow-500 text-yellow-500'
                    }`}>
                    {campaign.status === 'active' ? '🟢 Rodando' :
                        campaign.status === 'completed' ? '🔵 Finalizada' : '🟡 Pausada'}
                </Badge>
            </div>

            {/* Métricas */}
            <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
                <Card className="bg-card/40 border-border/50">
                    <CardContent className="p-4 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Users className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-white">{metrics.total}</p>
                            <p className="text-xs text-muted-foreground">Total Leads</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-card/40 border-border/50">
                    <CardContent className="p-4 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                            <MessageSquare className="h-5 w-5 text-blue-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-white">{metrics.contacted}</p>
                            <p className="text-xs text-muted-foreground">Contatados</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-card/40 border-border/50">
                    <CardContent className="p-4 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                            <Clock className="h-5 w-5 text-amber-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-white">{metrics.responded}</p>
                            <p className="text-xs text-muted-foreground">Responderam</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-card/40 border-border/50">
                    <CardContent className="p-4 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                            <CheckCircle className="h-5 w-5 text-emerald-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-white">{metrics.qualified}</p>
                            <p className="text-xs text-muted-foreground">Qualificados</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-card/40 border-border/50">
                    <CardContent className="p-4 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
                            <XCircle className="h-5 w-5 text-red-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-white">{metrics.blocked}</p>
                            <p className="text-xs text-muted-foreground">Bloqueados</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Lista de Conversas */}
            <Card className="bg-card/40 border-border/50">
                <CardHeader>
                    <CardTitle className="text-white">Conversas da Campanha</CardTitle>
                </CardHeader>
                <CardContent>
                    {conversations.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">Nenhuma conversa iniciada nesta campanha.</p>
                    ) : (
                        <div className="divide-y divide-border/30">
                            {conversations.map((conv: any) => {
                                const lead = conv.leads || {}
                                const st = statusMap[conv.status] || { label: conv.status, color: "bg-zinc-500/20 text-zinc-400" }
                                return (
                                    <div key={conv.id} className="flex items-center justify-between py-3 px-2 hover:bg-card/60 rounded transition-colors">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-white truncate">{lead.nome || 'Lead Desconhecido'}</p>
                                            <p className="text-xs text-muted-foreground truncate">{lead.empresa} • {lead.telefone}</p>
                                        </div>
                                        <div className="flex items-center gap-3 ml-4 shrink-0">
                                            <Badge variant="secondary" className={`text-[11px] ${st.color}`}>
                                                {st.label}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground hidden md:block">
                                                {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true, locale: ptBR })}
                                            </span>
                                            <Button variant="ghost" size="sm" className="text-primary h-8" asChild>
                                                <Link href="/chat">Ver Chat</Link>
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Info */}
            <div className="text-xs text-muted-foreground text-center">
                Campanha criada {formatDistanceToNow(new Date(campaign.created_at), { addSuffix: true, locale: ptBR })}
                {campaign.updated_at && ` • Última atualização ${formatDistanceToNow(new Date(campaign.updated_at), { addSuffix: true, locale: ptBR })}`}
            </div>
        </div>
    )
}
