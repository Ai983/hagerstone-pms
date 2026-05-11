import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent-500 text-white',
        secondary: 'border-transparent bg-muted text-foreground-secondary',
        destructive: 'border-transparent bg-destructive/20 text-destructive border-destructive/30',
        outline: 'border-border text-foreground',
        success: 'border-transparent bg-success/20 text-success border-success/30',
        warning: 'border-transparent bg-warning/20 text-warning border-warning/30',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
