import { getAllLeads } from "@/app/actions"
import { columns } from "./columns" // Corrigido
import { DataTable } from "./data-table"

export default async function LeadsPage() {
    const { leads } = await getAllLeads(1, 100) as any

    return (
        <div className="h-full flex flex-col space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight text-white">Base de Leads</h1>
            </div>

            <div className="bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl p-4">
                <DataTable columns={columns} data={leads} />
            </div>
        </div>
    )
}
