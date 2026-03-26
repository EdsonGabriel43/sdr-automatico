"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase-clients"
import { Loader2, Lock } from "lucide-react"
import Link from "next/link"

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        const supabase = createBrowserSupabaseClient()
        const { error } = await supabase.auth.signInWithPassword({ email, password })

        if (error) {
            setError(error.message === "Invalid login credentials" ? "Email ou senha incorretos" : error.message)
            setLoading(false)
            return
        }

        router.push("/")
        router.refresh()
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 bg-primary/10 rounded-2xl mb-4">
                        <Lock className="h-7 w-7 text-primary" />
                    </div>
                    <h1 className="text-2xl font-bold text-foreground">SDR Hub</h1>
                    <p className="text-sm text-muted-foreground mt-1">Acesse sua conta</p>
                </div>

                <form onSubmit={handleLogin} className="bg-card border border-border rounded-xl p-6 space-y-4">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-lg p-3">
                            {error}
                        </div>
                    )}

                    <div>
                        <label htmlFor="email" className="block text-xs font-medium text-muted-foreground mb-1.5">Email</label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="seu@email.com"
                            required
                            className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                        />
                    </div>

                    <div>
                        <label htmlFor="password" className="block text-xs font-medium text-muted-foreground mb-1.5">Senha</label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            className="w-full px-4 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> : null}
                        Entrar
                    </button>
                </form>

                <p className="text-center text-xs text-muted-foreground mt-4">
                    Tem uma chave de licença?{" "}
                    <Link href="/activate" className="text-primary hover:underline font-medium">
                        Ativar conta
                    </Link>
                </p>
            </div>
        </div>
    )
}
