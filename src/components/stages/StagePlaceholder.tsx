import { Construction } from 'lucide-react'
import { STAGE_LABELS, STAGE_EXIT_CONDITIONS } from '@/lib/stages'
import type { ProjectStage } from '@/lib/types'
import type { ProjectDetailContext } from './types'

export function StagePlaceholder({ ctx }: { ctx: ProjectDetailContext }) {
  const stage = ctx.project.current_stage as ProjectStage
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
      <Construction className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
      <p className="text-sm text-foreground">
        Stage {stage} — {STAGE_LABELS[stage]}
      </p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        {STAGE_EXIT_CONDITIONS[stage]}
      </p>
      <p className="text-[11px] text-muted-foreground/70 mt-3">
        Workspace not built yet.
      </p>
    </div>
  )
}
