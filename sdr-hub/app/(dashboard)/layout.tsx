import { Sidebar } from "@/components/Sidebar"
import { Header } from "@/components/Header"
import { RealtimeMessagesListener } from "@/components/realtime-messages-listener"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <RealtimeMessagesListener />
            <div className="hidden md:flex h-full w-64 flex-col fixed inset-y-0 z-50">
                <Sidebar />
            </div>
            <div className="flex flex-col md:pl-64 w-full h-full">
                <Header />
                <main className="flex-1 overflow-y-auto p-6 scroll-smooth">
                    {children}
                </main>
            </div>
        </div>
    )
}
