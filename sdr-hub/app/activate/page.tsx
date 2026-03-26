"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Key, CheckCircle } from "lucide-react"
import Link from "next/link"
import { validateLicenseKey, activateWithLicense } from "./actions"

export default function ActivatePage() {
    const router = useRouter()
    const [step, setStep] = useState<"key" | "register">("key")
    const [licenseKey, setLicenseKey] = useState("")
    const [tenantName, setTenantName] = useState("")

    const [name, setName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")

    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)

    const handleValidateKey = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        const res = await validateLicenseKey(licenseKey.trim().toUpperCase())
        if (res.valid) {
            setTenantName(res.tenantName || "")
            setStep("register")
        } else {
            setError(res.error || "Chave inválida")
        }
        setLoading(false)
    }

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")

        if (password !== confirmPassword) {
            setError("As senhas não coincidem")
            return
        }
        if (password.length < 6) {
            setError("A senha deve ter no mínimo 6 caracteres")
            return
        }

        setLoading(true)
        const res = await activateWithLicense(licenseKey.trim().toUpperCase(), name, email, password)
        if (res.success) {
            setSuccess(true)
        } else {
            setError(res.error || "Erro ao criar conta")
        }
        setLoading(false)
    }

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <div className="w-full max-w-sm text-center">
                    <CheckCircle className="h-14 w-14 text-emerald-500 mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-foreground mb-2">Conta criada!</h1>
                    <p className="text-sm text-muted-foreground mb-6">Sua conta foi ativada com sucesso. Faça login para acessar o SDR Hub.</p>
                    <Link href="/login" className="inline-flex px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90">
                        Fazer Login
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 bg-primary/10 rounded-2xl mb-4">
                        <Key className="h-7 w-7 text-primary" />
                    </div>
                    <h1 className="text-2xl font-bold text-foreground">Ativar Licença</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {step === "key" ? "Digite sua chave de licença" : `Criar conta — ${tenantName}`}
                    </p>
                </div>

                <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-lg p-3">
                            {error}
                        </div>
                    )}

                    {step === "key" ? (
                        <form onSubmit={handleValidateKey} className="space-y-4">
                            <div>
                                <label htmlFor="license-key" className="block text-xs font-medium text-muted-foreground mb-1.5">Chave de Licença</label>
                                <input
                                    id="license-key"
                                    name="license-key"
                                    type="text"
                                    value={licenseKey}
                                    onChange={e => setLicenseKey(e.target.value)}
                                    placeholder="SDR-XXXX-XXXX-XXXX"
                                    required
                                    className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary font-mono tracking-wider text-center"
                                />
                            </div>
                            <button type="submit" disabled={loading} className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                                {loading ? <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> : null}
                                Validar Chave
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleRegister} className="space-y-4">
                            <div>
                                <label htmlFor="name" className="block text-xs font-medium text-muted-foreground mb-1.5">Nome completo</label>
                                <input id="name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome" required className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                            </div>
                            <div>
                                <label htmlFor="reg-email" className="block text-xs font-medium text-muted-foreground mb-1.5">Email</label>
                                <input id="reg-email" name="reg-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" required className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                            </div>
                            <div>
                                <label htmlFor="reg-password" className="block text-xs font-medium text-muted-foreground mb-1.5">Senha</label>
                                <input id="reg-password" name="reg-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                            </div>
                            <div>
                                <label htmlFor="reg-confirm" className="block text-xs font-medium text-muted-foreground mb-1.5">Confirmar senha</label>
                                <input id="reg-confirm" name="reg-confirm" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repita a senha" required className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                            </div>
                            <button type="submit" disabled={loading} className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                                {loading ? <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> : null}
                                Criar Conta
                            </button>
                            <button type="button" onClick={() => setStep("key")} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground">
                                Voltar
                            </button>
                        </form>
                    )}
                </div>

                <p className="text-center text-xs text-muted-foreground mt-4">
                    Já tem conta?{" "}
                    <Link href="/login" className="text-primary hover:underline font-medium">Fazer login</Link>
                </p>
            </div>
        </div>
    )
}
