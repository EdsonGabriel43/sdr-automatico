"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Link as LinkIcon, MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from "next/link"
import { format } from "date-fns"

export type Lead = {
    id: string
    nome: string
    empresa: string
    cargo: string
    status: string
    linkedin: string
    created_at: string
    valor_divida?: number
}

export const columns: ColumnDef<Lead>[] = [
    {
        id: "select",
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllPageRowsSelected()}
                onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                aria-label="Select all"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                aria-label="Select row"
            />
        ),
        enableSorting: false,
        enableHiding: false,
    },
    {
        accessorKey: "nome",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Nome
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => <div className="font-medium text-white">{row.getValue("nome")}</div>,
    },
    {
        accessorKey: "empresa",
        header: "Empresa",
        cell: ({ row }) => <div className="text-muted-foreground">{row.getValue("empresa")}</div>,
    },
    {
        accessorKey: "cargo",
        header: "Cargo",
        cell: ({ row }) => <div className="text-muted-foreground truncate max-w-[150px]">{row.getValue("cargo")}</div>,
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const val = row.getValue("status") as string
            return (
                <Badge variant="outline" className="text-xs uppercase bg-white/5 border-white/10">
                    {val === 'new' ? 'Novo' : val}
                </Badge>
            )
        },
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const lead = row.original

            return (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Ações</DropdownMenuLabel>
                        <DropdownMenuItem
                            onClick={() => navigator.clipboard.writeText(lead.id)}
                        >
                            Copiar ID do Lead
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <Link href={`/leads/${lead.id}`}>Ver Detalhes</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <a href={lead.linkedin} target="_blank">Abrir LinkedIn</a>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
]
