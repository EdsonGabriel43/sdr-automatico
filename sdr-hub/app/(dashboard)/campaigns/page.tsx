import { getCampaigns } from "@/app/actions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PlusCircle, PlayCircle, BarChart3, Users } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import Link from "next/link"

export default async function CampaignsPage() {
    const { campaigns } = await getCampaigns()

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Campanhas</h1>
                    <p className="text-muted-foreground">Crie e gerencie seus conjuntos de disparos pelo robô do WhatsApp.</p>
                </div>

                <Button className="gap-2" asChild>
                    <Link href="/campaigns/new">
                        <PlusCircle className="h-4 w-4" />
                        Nova Campanha
                    </Link>
                </Button>
            </div>

            {campaigns && campaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 glass-card rounded-xl text-center">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                        <MegaphoneSlash className="h-8 w-8 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold text-white mb-2">Nenhuma campanha criada</h2>
                    <p className="text-muted-foreground max-w-sm mb-6">Você ainda não tem campanhas ativas. Comece importando uma lista de leads e configurando o robô.</p>
                    <Button asChild>
                        <Link href="/campaigns/new">Criar Primeira Campanha</Link>
                    </Button>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {campaigns?.map((campaign: any) => (
                        <Card key={campaign.id} className="bg-card/40 border-border/50 backdrop-blur hover:bg-card/60 transition-colors">
                            <CardContent className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <h3 className="text-lg font-semibold text-white">{campaign.name}</h3>
                                    <div className={`px-2 py-1 rounded text-xs font-medium 
                                        ${campaign.status === 'active' ? 'bg-green-500/10 text-green-500' :
                                            campaign.status === 'completed' ? 'bg-blue-500/10 text-blue-500' :
                                                'bg-yellow-500/10 text-yellow-500'}`}>
                                        {campaign.status === 'active' ? 'Rodando' :
                                            campaign.status === 'completed' ? 'Finalizada' : 'Pausada'}
                                    </div>
                                </div>

                                <p className="text-sm text-muted-foreground mb-6 h-10 line-clamp-2">
                                    {campaign.description || 'Sem descrição.'}
                                </p>

                                <div className="grid grid-cols-2 gap-4 mb-6">
                                    <div className="space-y-1">
                                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                                            <Users className="h-3 w-3" />
                                            Contatados
                                        </p>
                                        <p className="text-lg font-medium text-white">{campaign.leads_contacted || 0}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                                            <Users className="h-3 w-3" />
                                            Qualificados
                                        </p>
                                        <p className="text-lg font-medium text-emerald-400">{campaign.leads_qualified || 0}</p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/50 pt-4">
                                    <span>Criado {formatDistanceToNow(new Date(campaign.created_at), { addSuffix: true, locale: ptBR })}</span>
                                    <Button variant="ghost" size="sm" className="h-8 text-primary hover:text-primary/80 hover:bg-primary/10" asChild>
                                        <Link href={`/campaigns/${campaign.id}`}>
                                            <BarChart3 className="h-4 w-4 mr-2" />
                                            Detalhes
                                        </Link>
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}

function MegaphoneSlash(props: any) {
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
            <path d="m2 2 20 20" />
            <path d="M12.98 9.54a5 5 0 0 0-4.66-2.61l-3.23.47a1 1 0 0 0-.82 1.25l.8 5.61A2.5 2.5 0 0 0 7.53 16h.79" />
            <path d="M11 11.5v3.15c0 .73-.42 1.39-1.07 1.68l-3.32 1.5A1.5 1.5 0 0 1 4.5 16.5" />
            <path d="M17 14.15V14a5 5 0 0 0-3.34-4.71" />
            <path d="M22 6a2 2 0 0 0-2-2 2 2 0 0 0-2 2c0 .48.17.92.45 1.27l-4.5 5.58" />
            <path d="M18.8 11.2a2 2 0 0 0 2.8 1.6" />
            <path d="M12 6a2 2 0 1 0 0 4" />
        </svg>
    )
}
