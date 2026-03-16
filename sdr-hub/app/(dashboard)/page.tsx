import { MetricCard } from "@/components/MetricCard"
import { Users, MessageSquare, Zap, Activity } from "lucide-react"
import { getDashboardMetrics } from "@/app/actions"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"

export default async function DashboardPage() {
    const metrics = await getDashboardMetrics()
    console.log("Métricas carregadas:", metrics)

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard</h1>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    title="Total Leads"
                    value={metrics.totalLeads.toLocaleString('pt-BR')}
                    icon={Users}
                    description="Na base de dados"
                    trendUp={true}
                />
                <MetricCard
                    title="Contatados"
                    value={metrics.contactedLeads.toLocaleString('pt-BR')}
                    icon={MessageSquare}
                    description="Leads abordados"
                    trendUp={true}
                />
                <MetricCard
                    title="Qualificados"
                    value={metrics.qualifiedLeads.toLocaleString('pt-BR')}
                    icon={Zap}
                    description="Em negociação (Pitch+)"
                    trendUp={true}
                />
                <MetricCard
                    title="Taxa de Resposta"
                    value={`${metrics.responseRate}%`}
                    icon={Activity}
                    description="Engajamento geral"
                    trendUp={Number(metrics.responseRate) > 10}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <div className="col-span-4 glass-card rounded-xl p-6 min-h-[400px]">
                    <h3 className="text-lg font-medium text-white mb-4">Atividade Semanal</h3>
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        <p>Gráfico temporariamente indisponível</p>
                    </div>
                </div>
                <div className="col-span-3 glass-card rounded-xl p-6 min-h-[400px]">
                    <h3 className="text-lg font-medium text-white mb-4">Feed Recente</h3>
                    <div className="space-y-4">
                        {metrics.recentActivity.length > 0 ? (
                            metrics.recentActivity.map((msg: any) => (
                                <div key={msg.id} className="flex items-center gap-4 border-b border-border/50 pb-4 last:border-0">
                                    <div className="h-9 w-9 rounded-full bg-secondary/50 flex items-center justify-center text-xs font-bold text-white">
                                        {msg.conversations?.leads?.nome?.substring(0, 2).toUpperCase() || 'LD'}
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-white truncate max-w-[200px]">
                                            {msg.content}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {msg.conversations?.leads?.nome} • {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true, locale: ptBR })}
                                        </p>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-muted-foreground">Nenhuma atividade recente.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
