import { getKanbanLeads } from "@/app/actions"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

const COLUMNS = [
    { id: 'para_contactar',      title: 'Para Contactar',           color: 'border-slate-500/30 bg-slate-500/5' },
    { id: 'nao_resp_0',          title: 'Não Respondeu (1º)',        color: 'border-orange-400/30 bg-orange-400/5' },
    { id: 'nao_resp_1',          title: 'Não Respondeu (Follow 1)',  color: 'border-orange-500/30 bg-orange-500/5' },
    { id: 'nao_resp_2',          title: 'Não Respondeu (Follow 2)',  color: 'border-amber-500/30 bg-amber-500/5' },
    { id: 'nao_resp_3',          title: 'Não Respondeu (Follow 3)',  color: 'border-red-500/30 bg-red-500/5' },
    { id: 'desqualificado',      title: 'Desqualificado',            color: 'border-red-700/30 bg-red-700/5' },
    { id: 'handoff_humano',      title: 'Handoff Humano',            color: 'border-indigo-500/30 bg-indigo-500/5' },
    { id: 'em_conversa_gk',      title: 'Em Conversa (GK)',          color: 'border-blue-500/30 bg-blue-500/5' },
    { id: 'em_conversa_decisor', title: 'Em Conversa (Decisor)',     color: 'border-purple-500/30 bg-purple-500/5' },
    { id: 'reuniao_marcada',     title: 'Reunião Marcada',           color: 'border-green-500/30 bg-green-500/5' },
    { id: 'nao_compareceu',      title: 'Não Compareceu',            color: 'border-rose-500/30 bg-rose-500/5' },
    { id: 'em_negociacao',       title: 'Em Negociação',             color: 'border-emerald-500/30 bg-emerald-500/5' },
]

export default async function KanbanPage() {
    const columns = await getKanbanLeads() as any

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold tracking-tight text-white">Pipeline de Leads</h1>
                <span className="text-sm text-muted-foreground">{COLUMNS.length} etapas</span>
            </div>

            <div className="flex-1 overflow-x-auto pb-4">
                <div className="flex gap-3 h-full" style={{ minWidth: `${COLUMNS.length * 250}px` }}>
                    {COLUMNS.map((col) => {
                        const leads: any[] = columns[col.id] || []
                        return (
                            <div
                                key={col.id}
                                className={`flex flex-col h-full rounded-xl border ${col.color} backdrop-blur-sm`}
                                style={{ minWidth: '230px', width: '230px' }}
                            >
                                <div className="p-3 border-b border-border/40 flex justify-between items-center sticky top-0 bg-inherit rounded-t-xl z-10">
                                    <h3 className="font-semibold text-white text-[11px] uppercase tracking-wide leading-tight">
                                        {col.title}
                                    </h3>
                                    <Badge variant="secondary" className="bg-white/10 text-white border-0 text-xs min-w-[22px] justify-center">
                                        {leads.length}
                                    </Badge>
                                </div>

                                <div className="flex-1 p-2 overflow-y-auto space-y-2">
                                    {leads.map((conv: any) => (
                                        <Link key={conv.id} href={`/leads/${conv.leads?.id}`} className="block">
                                            <Card className="bg-card/70 border-border/40 hover:border-primary/50 hover:bg-card/90 transition-all cursor-pointer shadow-sm">
                                                <CardContent className="p-3">
                                                    <div className="flex justify-between items-start gap-1 mb-1">
                                                        <div className="font-semibold text-white text-sm truncate leading-tight">
                                                            {conv.leads?.nome || '—'}
                                                        </div>
                                                        {(conv.current_step ?? 0) > 0 && (
                                                            <Badge variant="outline" className="text-[10px] h-4 px-1 border-primary/40 text-primary shrink-0">
                                                                S{conv.current_step}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground truncate">{conv.leads?.empresa}</div>
                                                    {conv.leads?.cargo && (
                                                        <div className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{conv.leads.cargo}</div>
                                                    )}
                                                    {conv.leads?.valor_divida && (
                                                        <div className="text-[11px] text-emerald-400 font-medium mt-1">
                                                            R$ {Number(conv.leads.valor_divida).toLocaleString('pt-BR')}
                                                        </div>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        </Link>
                                    ))}
                                    {leads.length === 0 && (
                                        <div className="text-center py-10 text-xs text-muted-foreground/50 italic select-none">
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
