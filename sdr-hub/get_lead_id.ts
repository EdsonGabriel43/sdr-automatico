import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://nntdpuvftgwmpgdhwtbd.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5udGRwdXZmdGd3bXBnZGh3dGJkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTMzMzQ3OSwiZXhwIjoyMDg2OTA5NDc5fQ.1FGsn8HLSMzG6wQ_NRHqUwvaTAdX8aGzRyKAG65_E3s'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function getOneLead() {
    const { data } = await supabase.from('leads').select('id, nome').limit(1).single()
    console.log(data?.id)
}

getOneLead()
