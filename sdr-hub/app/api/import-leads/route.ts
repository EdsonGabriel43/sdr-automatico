import { NextRequest, NextResponse } from "next/server"

const DISPATCHER_API_URL = process.env.DISPATCHER_API_URL || "http://127.0.0.1:3001"

export async function POST(req: NextRequest) {
    try {
        // Recebe o FormData do browser (com o File intacto)
        const formData = await req.formData()

        // Re-empacota e envia direto para o Python
        const pyResponse = await fetch(`${DISPATCHER_API_URL}/leads/import`, {
            method: "POST",
            body: formData,
        })

        if (!pyResponse.ok) {
            const errorText = await pyResponse.text()
            return NextResponse.json(
                { success: false, error: `API Python: ${pyResponse.status} - ${errorText}` },
                { status: pyResponse.status }
            )
        }

        const data = await pyResponse.json()
        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        console.error("Erro na API Route /api/import-leads:", e)
        return NextResponse.json(
            { success: false, error: e.message || "Falha de conexão com a API do Disparador" },
            { status: 500 }
        )
    }
}
