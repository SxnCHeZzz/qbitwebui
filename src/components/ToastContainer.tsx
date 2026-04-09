import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'
import type { Toast } from '../hooks/useToast'

interface Props {
	toasts: Toast[]
	onRemove: (id: string) => void
}

const icons = {
	success: CheckCircle,
	error: AlertCircle,
	info: Info,
}

const colors = {
	success: '#a6e3a1',
	error: 'var(--error)',
	info: 'var(--accent)',
}

export function ToastContainer({ toasts, onRemove }: Props) {
	if (toasts.length === 0) return null

	return (
		<div className="fixed bottom-4 right-4 z-50 space-y-2">
			{toasts.map((toast) => {
				const Icon = icons[toast.type]
				return (
					<div
						key={toast.id}
						className="flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border min-w-[300px] max-w-md"
						style={{
							backgroundColor: 'var(--bg-secondary)',
							borderColor: 'var(--border)',
							color: 'var(--text-primary)',
						}}
					>
						<Icon className="w-5 h-5 shrink-0" style={{ color: colors[toast.type] }} />
						<p className="text-sm flex-1">{toast.message}</p>
						<button
							onClick={() => onRemove(toast.id)}
							className="p-1 rounded hover:bg-[var(--bg-tertiary)]"
							style={{ color: 'var(--text-muted)' }}
						>
							<X className="w-4 h-4" />
						</button>
					</div>
				)
			})}
		</div>
	)
}
