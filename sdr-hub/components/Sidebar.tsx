"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    LayoutDashboard,
    MessageSquare,
    Users,
    Settings,
    LogOut,
    Zap,
    Megaphone
} from "lucide-react"

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const pathname = usePathname()

    const routes = [
        {
            label: "Dashboard",
            icon: LayoutDashboard,
            href: "/",
            active: pathname === "/",
        },
        {
            label: "Pipeline (Kanban)",
            icon: Zap,
            href: "/kanban",
            active: pathname === "/kanban",
        },
        {
            label: "Mensagens",
            icon: MessageSquare,
            href: "/chat",
            active: pathname === "/chat",
        },
        {
            label: "Leads",
            icon: Users,
            href: "/leads",
            active: pathname === "/leads",
        },
        {
            label: "Campanhas",
            icon: Megaphone,
            href: "/campaigns",
            active: pathname === "/campaigns" || pathname.startsWith("/campaigns/"),
        },
        {
            label: "Configurações",
            icon: Settings,
            href: "/settings",
            active: pathname === "/settings",
        },
    ]

    return (
        <div className={cn("pb-12 min-h-screen border-r border-border bg-card/30 glass", className)}>
            <div className="space-y-4 py-4">
                <div className="px-3 py-2">
                    <h2 className="mb-6 px-4 text-2xl font-bold tracking-tight text-white">
                        SDR <span className="text-primary">Hub</span>
                    </h2>
                    <div className="space-y-1">
                        {routes.map((route) => (
                            <Button
                                key={route.href}
                                variant={route.active ? "secondary" : "ghost"}
                                className={cn(
                                    "w-full justify-start gap-2",
                                    route.active && "bg-secondary/50 font-medium text-white shadow-sm"
                                )}
                                asChild
                            >
                                <Link href={route.href}>
                                    <route.icon className="h-4 w-4" />
                                    {route.label}
                                </Link>
                            </Button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="absolute bottom-4 w-full px-4">
                <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground hover:text-white">
                    <LogOut className="h-4 w-4" />
                    Sair
                </Button>
            </div>
        </div>
    )
}
