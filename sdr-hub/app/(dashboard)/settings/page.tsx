"use client"

import { useEffect, useState } from "react"
import { getTemplates, updateTemplates } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Loader2, Save } from "lucide-react"

export default function SettingsPage() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [templates, setTemplates] = useState<any>(null)

    useEffect(() => {
        loadTemplates()
    }, [])

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
            toast.success("Configurações e mensagens atualizadas com sucesso.")
        } else {
            toast.error(res.error || "Erro ao salvar configurações.")
        }
        setSaving(false)
    }

    function handleChangeMessage(key: string, value: string) {
        setTemplates((prev: any) => ({
            ...prev,
            messages: {
                ...prev.messages,
                [key]: {
                    ...prev.messages[key],
                    text: value
                }
            }
        }))
    }

    function handleChangeResponse(key: string, value: string) {
        setTemplates((prev: any) => ({
            ...prev,
            responses: {
                ...prev.responses,
                [key]: value
            }
        }))
    }

    function handleChangeInterval(index: number, value: number) {
        setTemplates((prev: any) => {
            const newIntervals = [...prev.followup_intervals_hours]
            newIntervals[index] = value
            return {
                ...prev,
                followup_intervals_hours: newIntervals
            }
        })
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

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Configurações do Agente Nexa</h2>
                <p className="text-zinc-400 mt-2">Personalize o comportamento, intervalos de follow-up e as diretrizes principais de mensagens.</p>
            </div>

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Salvar Configurações
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Configurações Gerais */}
                <Card className="bg-zinc-900/50 border-zinc-800 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="text-zinc-100">Regras de Follow-up</CardTitle>
                        <CardDescription className="text-zinc-400">Intervalo de horas entre as tentativas de repescagem.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <Label className="text-zinc-300">Follow-up 1 (h)</Label>
                                <Input
                                    type="number"
                                    value={templates.followup_intervals_hours[0]}
                                    onChange={(e) => handleChangeInterval(0, parseInt(e.target.value))}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Follow-up 2 (h)</Label>
                                <Input
                                    type="number"
                                    value={templates.followup_intervals_hours[1]}
                                    onChange={(e) => handleChangeInterval(1, parseInt(e.target.value))}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Follow-up 3 (h)</Label>
                                <Input
                                    type="number"
                                    value={templates.followup_intervals_hours[2]}
                                    onChange={(e) => handleChangeInterval(2, parseInt(e.target.value))}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Mensagens de Disparo Frio */}
                <Card className="bg-zinc-900/50 border-zinc-800 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="text-zinc-100">Primeiros Contatos</CardTitle>
                        <CardDescription className="text-zinc-400">Diretrizes iniciais. O LLM usa essas mensagens como roteiro.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label className="text-zinc-300">Primeiro Contato (Validação)</Label>
                            <Textarea
                                value={templates.messages.first_contact.text}
                                onChange={(e) => handleChangeMessage('first_contact', e.target.value)}
                                className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-20"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Diretrizes de Follow-up */}
                <Card className="md:col-span-2 bg-zinc-900/50 border-zinc-800 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="text-zinc-100">Textos de Follow-up Automático</CardTitle>
                        <CardDescription className="text-zinc-400">Disparados automaticamente pelo motor de engajamento da Nexa.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <Label className="text-zinc-300">Follow-up 1</Label>
                                <Textarea
                                    value={templates.messages.followup_1.text}
                                    onChange={(e) => handleChangeMessage('followup_1', e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-24"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Follow-up 2</Label>
                                <Textarea
                                    value={templates.messages.followup_2.text}
                                    onChange={(e) => handleChangeMessage('followup_2', e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-24"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Follow-up 3 (Despedida)</Label>
                                <Textarea
                                    value={templates.messages.followup_3.text}
                                    onChange={(e) => handleChangeMessage('followup_3', e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-24"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Diretrizes Respostas LLM */}
                <Card className="md:col-span-2 bg-zinc-900/50 border-zinc-800 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="text-zinc-100">Diretrizes de Argumentação (Pitch e Objeções)</CardTitle>
                        <CardDescription className="text-zinc-400">Instruções para o LLM construir respostas baseadas na intenção do usuário.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <Label className="text-zinc-300">Pitch da Solução</Label>
                                <Textarea
                                    value={templates.responses.pitch_solution}
                                    onChange={(e) => handleChangeResponse('pitch_solution', e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-24"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Objeção: "Já tenho contador"</Label>
                                <Textarea
                                    value={templates.responses.objection_accountant}
                                    onChange={(e) => handleChangeResponse('objection_accountant', e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-24"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Objeção: "Sem dinheiro"</Label>
                                <Textarea
                                    value={templates.responses.objection_no_money}
                                    onChange={(e) => handleChangeResponse('objection_no_money', e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-24"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-300">Handoff para Nicolle (Aviso interno)</Label>
                                <Textarea
                                    value={templates.responses.handoff_notification}
                                    onChange={(e) => handleChangeResponse('handoff_notification', e.target.value)}
                                    className="bg-zinc-800/50 border-zinc-700 text-zinc-100 mt-1 h-32 text-xs font-mono"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
