import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const { meeting_id, storage_path } = await req.json() as {
      meeting_id: string
      storage_path: string   // e.g. "mom-audio/projects/{project_id}/{meeting_id}.webm"
    }

    if (!meeting_id || !storage_path) {
      return new Response(JSON.stringify({ error: 'meeting_id and storage_path required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Download the audio file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('design-documents')
      .download(storage_path)

    if (downloadError || !fileData) {
      return new Response(JSON.stringify({ error: 'Could not download audio file', detail: downloadError?.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Call OpenAI Whisper API
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const formData = new FormData()
    formData.append('file', fileData, storage_path.split('/').pop() ?? 'audio.webm')
    formData.append('model', 'whisper-1')
    formData.append('language', 'en')
    formData.append('response_format', 'text')

    const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    })

    if (!whisperResp.ok) {
      const detail = await whisperResp.text()
      return new Response(JSON.stringify({ error: 'Whisper API error', detail }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const transcript = await whisperResp.text()

    // Save transcript to design_meetings.mom_notes
    const { error: updateError } = await supabase
      .from('design_meetings')
      .update({ mom_notes: transcript.trim() })
      .eq('id', meeting_id)

    if (updateError) {
      return new Response(JSON.stringify({ error: 'Failed to save transcript', detail: updateError.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ transcript: transcript.trim() }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', detail: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
