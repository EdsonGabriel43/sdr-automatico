"use client"

import { useEffect, useState } from "react"
import { getTemplates, updateTemplates } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Loader2, Save, Plus, Trash2 } from "lucide-react"

export default function SettingsPage() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [templates, setTemplates] = useState<any>(null)

    useEffect(() => { loadTemplates() }, [])

    async function loadTemplates() {
        setLoading(true)
        const data = await getTemplates()
        if (data) {
            setTemplates(data)
        } else {
            toast.error("Não foi possível carregar as configurações. O backend está rodando?")
        }
        setLoading(false)
    }

    async function handleSave() {
        setSaving(true)
        const res = await updateTemplates(templates)
        if (res.success) {
            toast.success("Configurações salvas com sucesso.")
        } else {
            toast.error(res.error || "Erro ao salvar configurações.")
        }
        setSaving(false)
    }

    function setMsg(key: string, value: string) {
        setTemplates((prev: any) => ({
            ...prev,
            messages: { ...prev.messages, [key]: { ...prev.messages[key], text: value } }
        }))
    }

    function setResp(key: string, value: string) {
        setTemplates((prev: any) => ({
            ...prev,
            responses: { ...prev.responses, [key]: value }
        }))
    }

    function setInterval(index: number, value: number) {
        setTemplates((prev: any) => {
            const arr = [...prev.followup_intervals_hours]
            arr[index] = value
            return { ...prev, followup_intervals_hours: arr }
        })
    }

    function setField(key: string, value: any) {
        setTemplates((prev: any) => ({ ...prev, [key]: value }))
    }

    function setBusinessHours(key: string, value: any) {
        setTemplates((prev: any) => ({
            ...prev,
            business_hours: { ...prev.business_hours, [key]: value }
        }))
    }

    if (loading) {
        return (
            <div className="flex justify-center items-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            </div>
        )
    }

    if (!templates) {
        return <div className="p-8 text-center text-zinc-400">Não foi possível conectar com as configurações do agente.</div>
    }

    const bh = templates.business_hours || { start: 8, end: 20, days: [1,2,3,4,5] }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Configurações do Agente</h2>
                    <p className="text-zinc-400 mt-1">Script de vendas, prompts, follow-up e horário comercial.</p>
                </div>
                <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Salvar Tudo
                </Button>
            </div>

            <Tabs defaultValue="agente" className="space-y-4">
                <TabsList className="bg-zinc-900 border border-zinc-800 flex-wrap h-auto gap-1 p-1">
                    <TabsTrigger value="agente" className="data-[state=active]:bg-zinc-700 text-zinc-300">Persona do Agente</TabsTrigger>
                    <TabsTrigger value="script" className="data-[state=active]:bg-zinc-700 text-zinc-300">Script de Vendas</TabsTrigger>
                    <TabsTrigger value="objections" className="data-[state=active]:bg-zinc-700 text-zinc-300">Objeções</TabsTrigger>
                    <TabsTrigger value="qualification" className="data-[state=active]:bg-zinc-700 text-zinc-300">Qualificação</TabsTrigger>
                    <TabsTrigger value="followup" className="data-[state=active]:bg-zinc-700 text-zinc-300">Follow-up</TabsTrigger>
                    <TabsTrigger value="handoff" className="data-[state=active]:bg-zinc-700 text-zinc-300">Handoff</TabsTrigger>
                    <TabsTrigger value="operacional" className="data-[state=active]:bg-zinc-700 text-zinc-300">Operacional</TabsTrigger>
                </TabsList>

                {/* ═══ ABA: PERSONA DO AGENTE ═══ */}
                <TabsContent value="agente" className="space-y-4">
                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">System Prompt — Persona da Nexa</CardTitle>
                            <CardDescription className="text-zinc-400">
                                Identidade, missão, tom, proibições e fluxo de conversa do agente. Alterações aqui afetam TODAS as respostas geradas pelo GPT.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                value={templates.system_prompt || ""}
                                onChange={(e) => setField("system_prompt", e.target.value)}
                                className="bg-zinc-800/50 border-zinc-700 text-zinc-100 font-mono text-xs h-[500px]"
                            />
                        </CardContent>
                    </Card>
                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Prompt do Classificador de Intenções</CardTitle>
                            <CardDescription className="text-zinc-400">
                                Instrui o GPT a classificar cada mensagem do lead (intent, sentiment, lead_style). Altere com cuidado.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                value={templates.classifier_prompt || ""}
                                onChange={(e) => setField("classifier_prompt", e.target.value)}
                                className="bg-zinc-800/50 border-zinc-700 text-zinc-100 font-mono text-xs h-[400px]"
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ═══ ABA: SCRIPT DE VENDAS ═══ */}
                <TabsContent value="script" className="space-y-4">
                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Estágio 1 — Primeiro Contato</CardTitle>
                            <CardDescription className="text-zinc-400">Mensagem inicial enviada ao lead. Valida identidade sem revelar passivo. Variáveis: {"{nome}"}, {"{empresa}"}, {"{greeting}"}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                value={templates.messages?.first_contact?.text || ""}
                                onChange={(e) => setMsg("first_contact", e.target.value)}
                                className="bg-zinc-800/50 border-zinc-700 text-zinc-100 h-24"
                            />
                        </CardContent>
                    </Card>

                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Estágio 2 — Validação de Autoridade</CardTitle>
                            <CardDescription className="text-zinc-400">Diretrizes para quando o lead confirma identidade. Usado como referência para o GPT.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label className="text-zinc-300">Confirmou identidade → Perguntar sobre decisor</Label>
                                <Textarea
                                    value={templates.responses?.confirm_identity || ""}
                                    onChange={(e) => setResp("confirm_identity", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">É o Gatekeeper (secretária/recepcionista)</Label>
                                <Textarea
                                    value={templates.responses?.gatekeeper || ""}
                                    onChange={(e) => setResp("gatekeeper", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Não é o decisor</Label>
                                <Textarea
                                    value={templates.responses?.not_decision_maker || ""}
                                    onChange={(e) => setResp("not_decision_maker", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Número errado / pessoa errada</Label>
                                <Textarea
                                    value={templates.responses?.wrong_person || ""}
                                    onChange={(e) => setResp("wrong_person", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Não trabalha mais na empresa</Label>
                                <Textarea
                                    value={templates.responses?.not_at_company || ""}
                                    onChange={(e) => setResp("not_at_company", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-16"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Estágio 3 — Pitch</CardTitle>
                            <CardDescription className="text-zinc-400">Diretrizes do pitch após validar o decisor.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label className="text-zinc-300">Pitch do Problema (revelar passivo PGFN)</Label>
                                <Textarea
                                    value={templates.messages?.pitch_problem?.text || ""}
                                    onChange={(e) => setMsg("pitch_problem", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Pitch da Solução (Lei 13.988)</Label>
                                <Textarea
                                    value={templates.responses?.pitch_solution || ""}
                                    onChange={(e) => setResp("pitch_solution", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-24"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Quer saber mais (abertura para explicar)</Label>
                                <Textarea
                                    value={templates.responses?.wants_more_info || ""}
                                    onChange={(e) => setResp("wants_more_info", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Lead indicou outra pessoa (referral)</Label>
                                <Textarea
                                    value={templates.responses?.got_referral || ""}
                                    onChange={(e) => setResp("got_referral", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-16"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Já está negociando com outra empresa</Label>
                                <Textarea
                                    value={templates.responses?.already_negotiating || ""}
                                    onChange={(e) => setResp("already_negotiating", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ═══ ABA: OBJEÇÕES ═══ */}
                <TabsContent value="objections" className="space-y-4">
                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Contornos de Objeção</CardTitle>
                            <CardDescription className="text-zinc-400">
                                O GPT usa esses textos como diretrizes ao detectar cada objeção. Técnica: Validar → Diferenciar → Próximo Passo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[
                                { key: "objection_accountant", label: "\"Meu contador já cuida\"" },
                                { key: "objection_competitor", label: "\"Já tenho consultoria\" (Villela, Garzen...)" },
                                { key: "objection_no_money", label: "\"Não tenho dinheiro\"" },
                                { key: "objection_price", label: "\"Quanto custa?\"" },
                                { key: "objection_data_source", label: "\"Como conseguiram meus dados?\"" },
                                { key: "objection_is_robot", label: "\"Você é um robô?\"" },
                                { key: "objection_bad_experience", label: "\"Já fui enganado antes\"" },
                                { key: "objection_send_email", label: "\"Me manda por email\"" },
                                { key: "not_interested", label: "Sem interesse (educado)" },
                                { key: "busy", label: "Está ocupado / em reunião" },
                                { key: "hostile", label: "Hostil / ameaçando bloquear" },
                                { key: "block_confirm", label: "Confirmação de bloqueio/remoção da lista" },
                            ].map(({ key, label }) => (
                                <div key={key}>
                                    <Label className="text-zinc-300 text-sm">{label}</Label>
                                    <Textarea
                                        value={templates.responses?.[key] || ""}
                                        onChange={(e) => setResp(key, e.target.value)}
                                        className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-24 text-sm"
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ═══ ABA: QUALIFICAÇÃO ═══ */}
                <TabsContent value="qualification" className="space-y-4">
                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Perguntas de Qualificação (SPIN/BANT)</CardTitle>
                            <CardDescription className="text-zinc-400">
                                O agente faz no mínimo 2 perguntas antes do handoff. Adicione ou remova perguntas conforme seu processo de vendas.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <div key={n}>
                                    <Label className="text-zinc-300">Pergunta {n}</Label>
                                    <Textarea
                                        value={templates.responses?.[`qualification_q${n}`] || ""}
                                        onChange={(e) => setResp(`qualification_q${n}`, e.target.value)}
                                        className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-16"
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ═══ ABA: FOLLOW-UP ═══ */}
                <TabsContent value="followup" className="space-y-4">
                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Regras de Follow-up Frio</CardTitle>
                            <CardDescription className="text-zinc-400">Intervalo de horas entre cada tentativa e máximo de follow-ups para leads que não responderam.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                {[0, 1, 2].map((i) => (
                                    <div key={i}>
                                        <Label className="text-zinc-300">Follow-up {i + 1} — intervalo (horas)</Label>
                                        <Input
                                            type="number"
                                            value={templates.followup_intervals_hours?.[i] ?? ""}
                                            onChange={(e) => setInterval(i, parseInt(e.target.value))}
                                            className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1"
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="max-w-xs">
                                <Label className="text-zinc-300">Máximo de follow-ups por lead</Label>
                                <Input
                                    type="number"
                                    value={templates.max_followups ?? 3}
                                    onChange={(e) => setField("max_followups", parseInt(e.target.value))}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Mensagens de Follow-up</CardTitle>
                            <CardDescription className="text-zinc-400">Variáveis disponíveis: {"{nome}"}, {"{empresa}"}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {[
                                { key: "followup_1", label: "Follow-up 1 (após 1º silêncio)" },
                                { key: "followup_2", label: "Follow-up 2 (urgência)" },
                                { key: "followup_3", label: "Follow-up 3 (despedida)" },
                            ].map(({ key, label }) => (
                                <div key={key}>
                                    <Label className="text-zinc-300">{label}</Label>
                                    <Textarea
                                        value={templates.messages?.[key]?.text || ""}
                                        onChange={(e) => setMsg(key, e.target.value)}
                                        className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                    />
                                </div>
                            ))}
                            <div>
                                <Label className="text-zinc-300">Resposta positiva a follow-up (lead respondeu, ainda não ouviu o pitch)</Label>
                                <Textarea
                                    value={templates.responses?.followup_positive || ""}
                                    onChange={(e) => setResp("followup_positive", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ═══ ABA: HANDOFF ═══ */}
                <TabsContent value="handoff" className="space-y-4">
                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Mensagens de Handoff para o Consultor</CardTitle>
                            <CardDescription className="text-zinc-400">Mensagens enviadas ao lead quando é encaminhado ao consultor humano.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label className="text-zinc-300">Handoff Warm — sugerir conversa com consultor</Label>
                                <Textarea
                                    value={templates.responses?.handoff_warm || ""}
                                    onChange={(e) => setResp("handoff_warm", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Handoff Schedule — perguntar horário disponível</Label>
                                <Textarea
                                    value={templates.responses?.handoff_schedule || ""}
                                    onChange={(e) => setResp("handoff_schedule", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Handoff Confirm — confirmar agendamento</Label>
                                <Textarea
                                    value={templates.responses?.handoff_confirm || ""}
                                    onChange={(e) => setResp("handoff_confirm", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-16"
                                />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Notificação Interna para o Consultor (WhatsApp)</CardTitle>
                            <CardDescription className="text-zinc-400">
                                Mensagem enviada para o WhatsApp do consultor quando um lead é qualificado. Variáveis: {"{empresa}"}, {"{cnpj}"}, {"{nome}"}, {"{cargo}"}, {"{valor_divida}"}, {"{tipo_divida}"}, {"{summary}"}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                value={templates.responses?.handoff_notification || ""}
                                onChange={(e) => setResp("handoff_notification", e.target.value)}
                                className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-40 font-mono text-xs"
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ═══ ABA: OPERACIONAL ═══ */}
                <TabsContent value="operacional" className="space-y-4">
                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Horário Comercial</CardTitle>
                            <CardDescription className="text-zinc-400">O agente só envia mensagens dentro deste horário. Dias: 1=Segunda, 2=Terça, ... 5=Sexta, 6=Sábado, 7=Domingo.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 max-w-sm">
                                <div>
                                    <Label className="text-zinc-300">Hora de início</Label>
                                    <Input
                                        type="number"
                                        min={0} max={23}
                                        value={bh.start ?? 8}
                                        onChange={(e) => setBusinessHours("start", parseInt(e.target.value))}
                                        className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1"
                                    />
                                </div>
                                <div>
                                    <Label className="text-zinc-300">Hora de fim</Label>
                                    <Input
                                        type="number"
                                        min={0} max={23}
                                        value={bh.end ?? 20}
                                        onChange={(e) => setBusinessHours("end", parseInt(e.target.value))}
                                        className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1"
                                    />
                                </div>
                            </div>
                            <div>
                                <Label className="text-zinc-300">Dias da semana (separados por vírgula, 1=Seg a 7=Dom)</Label>
                                <Input
                                    value={(bh.days || [1,2,3,4,5]).join(",")}
                                    onChange={(e) => setBusinessHours("days", e.target.value.split(",").map(Number).filter(n => !isNaN(n)))}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 max-w-xs"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Fuso Horário</Label>
                                <Input
                                    value={bh.timezone || "America/Sao_Paulo"}
                                    onChange={(e) => setBusinessHours("timezone", e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 max-w-xs"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-zinc-900/50 border-zinc-800">
                        <CardHeader>
                            <CardTitle className="text-zinc-100">Saudações por Horário</CardTitle>
                            <CardDescription className="text-zinc-400">Usadas na variável {"{greeting}"} da primeira mensagem.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {(templates.greetings || []).map((g: string, i: number) => (
                                <div key={i} className="flex gap-2">
                                    <Input
                                        value={g}
                                        onChange={(e) => {
                                            const arr = [...templates.greetings]
                                            arr[i] = e.target.value
                                            setField("greetings", arr)
                                        }}
                                        className="bg-zinc-800/50 border-zinc-700 text-zinc-100"
                                    />
                                    <Button
                                        variant="ghost" size="icon"
                                        onClick={() => setField("greetings", templates.greetings.filter((_: any, j: number) => j !== i))}
                                        className="text-zinc-500 hover:text-red-400"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            <Button
                                variant="outline" size="sm"
                                onClick={() => setField("greetings", [...(templates.greetings || []), "Nova saudação"])}
                                className="border-zinc-700 text-zinc-300 mt-2"
                            >
                                <Plus className="h-4 w-4 mr-2" /> Adicionar saudação
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
