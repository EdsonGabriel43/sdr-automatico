"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createAndStartCampaign } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { ArrowLeft, UploadCloud, Rocket } from "lucide-react"
import Link from "next/link"

export default function NewCampaignPage() {
    const router = useRouter()
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [formData, setFormData] = useState({
        name: "",
        description: ""
    })

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0])
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!file) {
            toast.error("Por favor, selecione um arquivo CSV com os leads.")
            return
        }

        if (!formData.name) {
            toast.error("O nome da campanha é obrigatório.")
            return
        }

        setIsSubmitting(true)

        try {
            // 1. Upload do CSV via API Route (mantém File binário intacto)
            toast.loading("Importando leads...", { id: "campaign-creation" })
            const csvData = new FormData()
            csvData.append("file", file)

            const importResponse = await fetch("/api/import-leads", {
                method: "POST",
                body: csvData,
            })

            const importRes = await importResponse.json()

            if (!importRes.success) {
                throw new Error("Falha na importação do CSV: " + importRes.error)
            }

            toast.loading("Leads importados! Iniciando campanha...", { id: "campaign-creation" })

            // 2. Criar e Disparar Campanha
            const campaignRes = await createAndStartCampaign(formData.name, formData.description)

            if (!campaignRes.success) {
                throw new Error("Falha ao iniciar campanha: " + campaignRes.error)
            }

            toast.success("Campanha criada e iniciada com sucesso!!", { id: "campaign-creation" })
            router.push("/campaigns")
            router.refresh()

        } catch (error: any) {
            console.error(error)
            toast.error(error.message || "Ocorreu um erro inesperado", { id: "campaign-creation" })
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild className="rounded-full">
                    <Link href="/campaigns">
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Nova Campanha</h1>
                    <p className="text-muted-foreground">Importe seus leads e inicie os disparos automáticos.</p>
                </div>
            </div>

            <Card className="glass-card border-border/50">
                <CardHeader>
                    <CardTitle className="text-white">Detalhes do Disparo</CardTitle>
                    <CardDescription>
                        Preencha as informações básicas para identificar este lote de disparos.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name" className="text-white">Nome da Campanha <span className="text-red-500">*</span></Label>
                                <Input
                                    id="name"
                                    placeholder="Ex: PGFN - Janeiro 2026 Lote 1"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="bg-background/50"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="description" className="text-white">Descrição <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                                <Textarea
                                    id="description"
                                    placeholder="Notas internas sobre este lote de leads..."
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="bg-background/50 resize-none"
                                    rows={3}
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-border/50 space-y-4">
                            <div className="space-y-2">
                                <Label className="text-white">Base de Leads (CSV) <span className="text-red-500">*</span></Label>
                                <div className="border-2 border-dashed border-border/50 rounded-lg p-8 text-center bg-background/30 hover:bg-background/50 transition-colors">
                                    <Input
                                        id="file"
                                        type="file"
                                        accept=".csv"
                                        onChange={handleFileChange}
                                        className="hidden"
                                    />
                                    <Label htmlFor="file" className="cursor-pointer flex flex-col items-center gap-3">
                                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                            <UploadCloud className="h-6 w-6" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium text-white">
                                                {file ? file.name : "Clique para selecionar ou arraste o arquivo CSV"}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                O arquivo deve conter colunas compatíveis com o layout da PGFN (nome, cpf_cnpj, etc)
                                            </p>
                                        </div>
                                    </Label>
                                </div>
                            </div>
                        </div>

                        <div className="pt-6 flex justify-end gap-4">
                            <Button variant="outline" type="button" asChild>
                                <Link href="/campaigns">Cancelar</Link>
                            </Button>
                            <Button type="submit" disabled={isSubmitting} className="gap-2 min-w-[150px]">
                                {isSubmitting ? (
                                    <span className="animate-pulse">Processando...</span>
                                ) : (
                                    <>
                                        <Rocket className="h-4 w-4" />
                                        Iniciar Disparos
                                    </>
                                )}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}
