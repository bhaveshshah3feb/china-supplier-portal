import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://qnyxigiczewivylcmzyo.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFueXhpZ2ljemV3aXZ5bGNtenlvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzEzNTk3NiwiZXhwIjoyMDkyNzExOTc2fQ.nq4AeY4ZkMw_NDhWexKXI4Mz9EnxIOPbd4swyAR88L8'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

console.log('1. Fetching uploads...')
const { data: uploads, error: dbErr } = await supabase
  .from('uploads')
  .select('id, storage_path, upload_status')
  .order('created_at', { ascending: false })
  .limit(3)

if (dbErr) { console.error('DB ERROR:', dbErr); process.exit(1) }
console.log('   Found:', uploads.map(u => `${u.upload_status} | ${u.storage_path}`))

const path = uploads[0]?.storage_path
console.log('\n2. Downloading:', path)

const { data, error } = await supabase.storage.from('uploads').download(path)
if (error) {
  console.error('DOWNLOAD ERROR:', error.message)
  console.error('Full error:', JSON.stringify(error))
} else {
  console.log('DOWNLOAD OK, size:', data.size)
}
