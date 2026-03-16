export function Header() {
    return (
        <div className="glass flex h-16 items-center border-b px-6">
            <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-lg">
                    <span className="text-muted-foreground mr-2">Visão Geral</span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center text-xs font-bold text-primary">
                        AD
                    </div>
                </div>
            </div>
        </div>
    )
}
