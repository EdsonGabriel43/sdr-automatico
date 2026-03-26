import { redirect } from "next/navigation"
import { Sidebar } from "@/components/Sidebar"
import { Header } from "@/components/Header"
import { RealtimeMessagesListener } from "@/components/realtime-messages-listener"
import { getAuthUser } from "@/lib/auth"

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const auth = await getAuthUser()
    if (!auth) redirect('/login')

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <RealtimeMessagesListener />
            <div className="hidden md:flex h-full w-64 flex-col fixed inset-y-0 z-50">
                <Sidebar userProfile={auth.profile} />
            </div>
            <div className="flex flex-col md:pl-64 w-full h-full">
                <Header userProfile={auth.profile} />
                <main className="flex-1 overflow-y-auto p-6 scroll-smooth">
                    {children}
                </main>
            </div>
        </div>
    )
}
