import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
// Tenta pegar a service key do env local (não deve ser exposta no client)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

// Se não tiver service key, usa anon key como fallback (mas vai falhar em RLS restrito)
const supabaseKey = supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
})
