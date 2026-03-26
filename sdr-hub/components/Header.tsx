"use client"

import { useTheme } from "next-themes"
import { usePathname } from "next/navigation"
import { Sun, Moon, Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { UserProfile } from "@/lib/auth"

const pageTitles: Record<string, string> = {
    "/": "Dashboard",
    "/kanban": "Pipeline",
    "/chat": "Mensagens",
    "/leads": "Leads",
    "/campaigns": "Campanhas",
    "/nurturing": "Nurturing",
    "/prospecting": "Prospectar",
    "/chips": "WhatsApp",
    "/settings": "Configurações",
}

export function Header({ userProfile }: { userProfile?: UserProfile }) {
    const { theme, setTheme } = useTheme()
    const pathname = usePathname()

    const title = Object.entries(pageTitles).find(([key]) =>
        key === "/" ? pathname === "/" : pathname.startsWith(key)
    )?.[1] ?? "SDR Hub"

    const userName = userProfile?.name || "Usuário"
    const userRole = userProfile?.role || "admin"
    const initials = userName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()

    const roleLabels: Record<string, string> = {
        admin: "Administrador",
        operator: "Operador",
        closer: "Closer",
    }

    return (
        <div className="glass flex h-16 items-center border-b px-6 shrink-0">
            <div className="flex w-full items-center justify-between">
                <h1 className="text-base font-semibold text-foreground">{title}</h1>

                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-foreground"
                    >
                        <Bell className="h-4 w-4" />
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-foreground relative"
                        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    >
                        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                        <span className="sr-only">Alternar tema</span>
                    </Button>

                    <div className="flex items-center gap-2.5 pl-3 ml-1 border-l border-border">
                        <div className="h-8 w-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
                            <span className="text-[11px] font-bold text-primary">{initials}</span>
                        </div>
                        <div className="hidden sm:flex flex-col leading-none">
                            <span className="text-xs font-semibold text-foreground">{userName}</span>
                            <span className="text-[10px] text-muted-foreground">{roleLabels[userRole] || userRole}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
