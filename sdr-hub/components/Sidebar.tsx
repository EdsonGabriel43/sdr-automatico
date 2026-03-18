"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
    LayoutDashboard,
    MessageSquare,
    Users,
    Settings,
    LogOut,
    Megaphone,
    Flame,
    Target,
    BarChart3,
} from "lucide-react"

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

const routes = [
    { label: "Dashboard", icon: LayoutDashboard, href: "/", exact: true },
    { label: "Pipeline", icon: BarChart3, href: "/kanban" },
    { label: "Mensagens", icon: MessageSquare, href: "/chat" },
    { label: "Leads", icon: Users, href: "/leads" },
    { label: "Campanhas", icon: Megaphone, href: "/campaigns" },
    { label: "Nurturing", icon: Flame, href: "/nurturing" },
    { label: "Configurações", icon: Settings, href: "/settings" },
]

export function Sidebar({ className }: SidebarProps) {
    const pathname = usePathname()

    const isActive = (href: string, exact?: boolean) => {
        if (exact) return pathname === href
        return pathname === href || pathname.startsWith(href + "/")
    }

    return (
        <div className={cn("flex flex-col h-full border-r border-sidebar-border bg-sidebar", className)}>
            {/* Logo */}
            <div className="flex items-center gap-3 px-6 h-16 border-b border-sidebar-border shrink-0">
                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                    <Target className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
                </div>
                <div className="flex flex-col leading-none">
                    <span className="text-sm font-bold tracking-tight text-sidebar-foreground">SDR Hub</span>
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">Painel</span>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-3 py-5 space-y-0.5 overflow-y-auto">
                <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Menu</p>
                {routes.map((route) => {
                    const active = isActive(route.href, route.exact)
                    return (
                        <Link
                            key={route.href}
                            href={route.href}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group",
                                active
                                    ? "bg-primary/10 text-primary border border-primary/20"
                                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            )}
                        >
                            <route.icon className={cn(
                                "h-4 w-4 shrink-0 transition-colors",
                                active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                            )} />
                            {route.label}
                            {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                        </Link>
                    )
                })}
            </nav>

            {/* Footer */}
            <div className="px-3 py-4 border-t border-sidebar-border shrink-0">
                <button className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-all duration-150">
                    <LogOut className="h-4 w-4 shrink-0" />
                    Sair
                </button>
            </div>
        </div>
    )
}
