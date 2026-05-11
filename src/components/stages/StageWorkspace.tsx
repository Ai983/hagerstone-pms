import { Stage2ClientMeeting } from './Stage2ClientMeeting'
import { Stage3InitialDeliverables } from './Stage3InitialDeliverables'
import { Stage5BOQEntry } from './Stage5BOQEntry'
import { Stage6TwoBOQSplit } from './Stage6TwoBOQSplit'
import { Stage7ClientWalkthrough } from './Stage7ClientWalkthrough'
import { Stage8VendorConfirmation } from './Stage8VendorConfirmation'
import { StagePlaceholder } from './StagePlaceholder'
import type { ProjectDetailContext } from './types'

/**
 * Per-stage workspace router. Renders the interactive component
 * for the project's current stage. Stages without a built-out
 * workspace fall back to a placeholder so the page never breaks.
 */
export function StageWorkspace({ ctx }: { ctx: ProjectDetailContext }) {
  switch (ctx.project.current_stage) {
    case 2:
      return <Stage2ClientMeeting ctx={ctx} />
    case 3:
    case 4:
      return <Stage3InitialDeliverables ctx={ctx} />
    case 5:
      return <Stage5BOQEntry ctx={ctx} />
    case 6:
      return <Stage6TwoBOQSplit ctx={ctx} />
    case 7:
      return <Stage7ClientWalkthrough ctx={ctx} />
    case 8:
      return <Stage8VendorConfirmation ctx={ctx} />
    default:
      return <StagePlaceholder ctx={ctx} />
  }
}
