import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LogOut, FolderKanban, ChevronRight } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Notifications } from '@/components/Notifications'
import { cn } from '@/lib/utils'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { user, roles, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-border bg-surface flex flex-col">
        <div className="px-5 py-5 border-b border-border flex items-center justify-between">
          <Link to="/projects" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-accent-500 flex items-center justify-center">
              <ChevronRight className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-foreground text-sm tracking-tight">
              Hagerstone Design
            </span>
          </Link>
          <Notifications />
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink
            to="/projects"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-accent-500/10 text-accent-400 font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface'
              )
            }
          >
            <FolderKanban className="h-4 w-4" />
            Projects
          </NavLink>
        </nav>

        <div className="px-3 py-4 border-t border-border">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            <p className="text-xs text-accent-400 capitalize">{roles.join(', ')}</p>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  )
}
