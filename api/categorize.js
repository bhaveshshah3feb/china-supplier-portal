// Vercel serverless function — server-side only, Claude API key never exposed to browser
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
const supabase  = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { uploadId, storagePath } = req.body || {}
  if (!uploadId || !storagePath) return res.status(400).json({ error: 'Missing fields' })

  try {
    // Get the upload record
    const { data: upload, error: uploadErr } = await supabase
      .from('uploads').select('*, suppliers(supplier_code)').eq('id', uploadId).single()
    if (uploadErr || !upload) return res.status(404).json({ error: 'Upload not found' })

    // Videos are handled by GitHub Actions (FFmpeg frame extraction)
    if (upload.file_type === 'video') {
      // Create processing queue jobs for GitHub Actions to pick up
      await supabase.from('processing_queue').insert([
        { upload_id: uploadId, job_type: 'categorize', status: 'pending' },
      ])
      await supabase.from('uploads').update({ upload_status: 'completed' }).eq('id', uploadId)
      return res.status(200).json({ queued: true })
    }

    // For images, PDFs, docs — categorize directly with Claude Vision
    await supabase.from('uploads').update({ processing_status: 'processing' }).eq('id', uploadId)

    // Download file from Supabase Storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('uploads').download(storagePath)
    if (dlErr) throw dlErr

    const buffer     = Buffer.from(await fileData.arrayBuffer())
    const base64Data = buffer.toString('base64')
    const mediaType  = upload.mime_type || 'image/jpeg'

    // Fetch active main categories to give Claude the exact options
    const { data: mainCats } = await supabase.from('main_categories').select('id, slug, name_en').eq('status', 'active')
    const catList = (mainCats || []).map(c => `${c.slug} (${c.name_en})`).join(', ')

    // Call Claude Vision
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          {
            type: 'text',
            text: `You are analyzing amusement/arcade equipment for categorization.
Available categories: ${catList}
Look at this image and reply with ONLY the slug of the most appropriate category (e.g. "arcade" or "kiddy").
If it's a document/pricelist not showing equipment, reply "other".`,
          },
        ],
      }],
    })

    const aiSlug = message.content[0]?.text?.trim().toLowerCase().replace(/[^a-z-]/g, '')
    const matched = (mainCats || []).find(c => c.slug === aiSlug)

    // Update upload with AI category
    await supabase.from('uploads').update({
      processing_status:    'processing',
      ai_main_category_id:  matched?.id || null,
      main_category_id:     upload.main_category_id || matched?.id || null,
    }).eq('id', uploadId)

    // Create watermark job
    await supabase.from('processing_queue').insert([
      { upload_id: uploadId, job_type: 'watermark', status: 'pending' },
    ])

    return res.status(200).json({ category: aiSlug, matched: !!matched })
  } catch (err) {
    console.error('categorize error:', err)
    await supabase.from('uploads')
      .update({ processing_status: 'failed', error_message: err.message })
      .eq('id', uploadId)
    return res.status(500).json({ error: err.message })
  }
}
