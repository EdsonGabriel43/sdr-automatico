import { getKanbanLeads } from "@/app/actions"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

export default async function KanbanPage() {
    const columns = await getKanbanLeads() as any

    const columnConfig = [
        { id: 'to_contact', title: 'Para Contactar', color: 'bg-slate-500/10 border-slate-500/20' },
        { id: 'no_response', title: 'Não Respondeu', color: 'bg-orange-500/10 border-orange-500/20' },
        { id: 'disqualified', title: 'Desqualificado', color: 'bg-red-500/10 border-red-500/20' },
        { id: 'talking_gatekeeper', title: 'Em Conversa (GK)', color: 'bg-blue-500/10 border-blue-500/20' },
        { id: 'talking_decision_maker', title: 'Em Conversa (Decisor)', color: 'bg-purple-500/10 border-purple-500/20' },
        { id: 'meeting_scheduled', title: 'Reunião Marcada', color: 'bg-green-500/10 border-green-500/20' },
        { id: 'meeting_no_show', title: 'Não Compareceu', color: 'bg-rose-500/10 border-rose-500/20' },
        { id: 'closing', title: 'Em Fechamento', color: 'bg-emerald-500/10 border-emerald-500/20' },
    ]

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold tracking-tight text-white">Pipeline de Leads</h1>
            </div>

            <div className="flex-1 overflow-x-auto pb-4">
                <div className="flex gap-4 h-full min-w-[2400px]">
                    {columnConfig.map((col) => {
                        const leads = columns[col.id] || []

                        return (
                            <div key={col.id} className={`flex-1 flex flex-col h-full rounded-xl border ${col.color} backdrop-blur-sm min-w-[280px]`}>
                                <div className="p-4 border-b border-border/50 flex justify-between items-center sticky top-0 bg-inherit rounded-t-xl z-10">
                                    <h3 className="font-medium text-white text-sm uppercase tracking-wide">{col.title}</h3>
                                    <Badge variant="secondary" className="bg-background/40 text-white border-0">
                                        {leads.length}
                                    </Badge>
                                </div>

                                <div className="flex-1 p-2 overflow-y-auto space-y-3">
                                    {leads.map((lead: any) => (
                                        <Link key={lead.id} href={`/leads/${lead.id}`} className="block">
                                            <Card className="bg-card/80 border-border/50 hover:border-primary/50 transition-colors cursor-pointer group shadow-sm">
                                                <CardContent className="p-3">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="font-medium text-white truncate max-w-[180px]">{lead.nome}</div>
                                                        {lead.conversations?.[0]?.current_step && lead.conversations[0].current_step > 0 && (
                                                            <Badge variant="outline" className="text-[10px] h-5 px-1 border-primary/30 text-primary bg-primary/5">
                                                                Step {lead.conversations[0].current_step}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground truncate mb-1">{lead.empresa}</div>
                                                    <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                                        {lead.cargo || 'Cargo não informado'}
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </Link>
                                    ))}
                                    {leads.length === 0 && (
                                        <div className="text-center py-12 text-xs text-muted-foreground italic">
                                            Vazio
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
