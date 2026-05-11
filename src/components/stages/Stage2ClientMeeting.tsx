import { useEffect, useState } from 'react'
import { Plus, Video, MapPin, FileText, Link as LinkIcon, Calendar } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { advanceProject } from '@/lib/projectActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { DesignMeeting } from '@/lib/types'
import type { ProjectDetailContext } from './types'

function meetingCompletesStage(m: DesignMeeting): boolean {
  if (m.mode === 'offline') return true
  return !!(m.mom_notes && m.mom_notes.trim()) || !!(m.mom_file_url && m.mom_file_url.trim())
}

export function Stage2ClientMeeting({ ctx }: { ctx: ProjectDetailContext }) {
  const [meetings, setMeetings] = useState<DesignMeeting[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [meetingAt, setMeetingAt] = useState('')
  const [mode, setMode] = useState<'online' | 'offline'>('offline')
  const [attendees, setAttendees] = useState('')
  const [momNotes, setMomNotes] = useState('')
  const [momFileUrl, setMomFileUrl] = useState('')

  const canRecord = ctx.isAssignedMember || ctx.isTeamHead || ctx.isFounder

  useEffect(() => {
    void load()
  }, [ctx.project.id])

  async function load() {
    const { data } = await supabase
      .from('design_meetings')
      .select('*')
      .eq('project_id', ctx.project.id)
      .order('meeting_at', { ascending: false })
    setMeetings((data ?? []) as DesignMeeting[])
    setLoading(false)
  }

  function resetForm() {
    setMeetingAt('')
    setMode('offline')
    setAttendees('')
    setMomNotes('')
    setMomFileUrl('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!meetingAt) {
      setError('Pick a meeting date and time.')
      return
    }
    if (mode === 'online' && !momNotes.trim() && !momFileUrl.trim()) {
      setError('Online meetings require MOM notes or a file link.')
      return
    }

    setSubmitting(true)
    const attendeeList = attendees.split(',').map(a => a.trim()).filter(Boolean)

    const { error: insErr } = await supabase.from('design_meetings').insert({
      project_id: ctx.project.id,
      mode,
      meeting_at: new Date(meetingAt).toISOString(),
      attendees: attendeeList.length ? attendeeList : null,
      mom_notes: momNotes.trim() || null,
      mom_file_url: momFileUrl.trim() || null,
      created_by: ctx.currentUserId,
    })

    if (insErr) {
      setError(insErr.message)
      setSubmitting(false)
      return
    }

    resetForm()
    setShowForm(false)
    await load()
    await tryAutoAdvance()
    setSubmitting(false)
  }

  async function tryAutoAdvance() {
    const { data } = await supabase
      .from('design_meetings')
      .select('*')
      .eq('project_id', ctx.project.id)
    const fresh = (data ?? []) as DesignMeeting[]
    if (!fresh.some(meetingCompletesStage)) return

    setAdvancing(true)
    const result = await advanceProject({
      project: ctx.project,
      members: ctx.members,
      actorId: ctx.currentUserId,
      to: 3,
      reason: 'Stage 2 exit condition met: client meeting recorded.',
    })
    if (result.ok) {
      await ctx.refresh()
    } else {
      setError(`Auto-advance failed: ${result.error}`)
    }
    setAdvancing(false)
  }

  if (loading) {
    return <div className="h-20 rounded bg-surface animate-pulse" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Client Meetings</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Log at least one meeting to advance. Online meetings need MOM notes or a file link.
          </p>
        </div>
        {canRecord && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Log meeting
          </Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-border bg-background/40 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="meeting-at">Date & time *</Label>
              <Input
                id="meeting-at"
                type="datetime-local"
                value={meetingAt}
                onChange={e => setMeetingAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Mode *</Label>
              <Select value={mode} onValueChange={v => setMode(v as 'online' | 'offline')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="offline">Offline (in person)</SelectItem>
                  <SelectItem value="online">Online (video / call)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="attendees">Attendees (comma-separated)</Label>
            <Input
              id="attendees"
              placeholder="e.g. Rajesh Sharma, Designer1, Architect"
              value={attendees}
              onChange={e => setAttendees(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="mom-notes">
              MOM notes {mode === 'online' && <span className="text-destructive">*</span>}
            </Label>
            <Textarea
              id="mom-notes"
              rows={4}
              placeholder="Key decisions, scope notes, next steps…"
              value={momNotes}
              onChange={e => setMomNotes(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="mom-file">MOM file link (optional)</Label>
            <Input
              id="mom-file"
              type="url"
              placeholder="https://drive.google.com/…"
              value={momFileUrl}
              onChange={e => setMomFileUrl(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submitting || advancing}>
              {submitting ? 'Saving…' : advancing ? 'Advancing…' : 'Save meeting'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => { resetForm(); setShowForm(false) }}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {meetings.length === 0 ? (
        !showForm && (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">No meetings logged yet.</p>
            {canRecord && (
              <p className="text-xs text-muted-foreground mt-1">
                Record the first client meeting to advance to Stage 3.
              </p>
            )}
          </div>
        )
      ) : (
        <ul className="space-y-2">
          {meetings.map(m => {
            const valid = meetingCompletesStage(m)
            return (
              <li key={m.id} className="rounded-md border border-border bg-background/30 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {m.mode === 'online'
                        ? <Video className="h-3.5 w-3.5 text-accent-400 flex-shrink-0" />
                        : <MapPin className="h-3.5 w-3.5 text-accent-400 flex-shrink-0" />}
                      <span className="text-sm text-foreground capitalize">{m.mode}</span>
                      <span className="text-muted-foreground text-xs">·</span>
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      <time className="text-xs text-muted-foreground">
                        {new Date(m.meeting_at).toLocaleString('en-IN', {
                          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </time>
                      {valid
                        ? <Badge variant="success" className="text-[10px] ml-1">complete</Badge>
                        : <Badge variant="warning" className="text-[10px] ml-1">incomplete</Badge>}
                    </div>
                    {m.attendees && m.attendees.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1.5 truncate">
                        Attendees: {m.attendees.join(', ')}
                      </p>
                    )}
                    {m.mom_notes && (
                      <div className="flex items-start gap-1.5 mt-2">
                        <FileText className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-foreground-secondary whitespace-pre-wrap leading-relaxed">
                          {m.mom_notes}
                        </p>
                      </div>
                    )}
                    {m.mom_file_url && (
                      <a
                        href={m.mom_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300 mt-2"
                      >
                        <LinkIcon className="h-3 w-3" />
                        MOM file
                      </a>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
