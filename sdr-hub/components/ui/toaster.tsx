"use client"

import { Toaster as SonnerToaster } from "sonner"

export function Toaster() {
    return (
        <SonnerToaster
            position="top-right"
            toastOptions={{
                className: 'bg-card border-border text-foreground',
            }}
        />
    )
}
