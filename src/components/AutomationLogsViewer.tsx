import { useState, useEffect } from 'react'
import { X, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AutomationRule } from '../types/automation'
import { getRuleLogs } from '../api/automation'

interface Props {
	rule: AutomationRule
	onClose: () => void
}

export function AutomationLogsViewer({ rule, onClose }: Props) {
	const [logs, setLogs] = useState<
		Array<{
			id: number
			torrentHash: string | null
			torrentName: string | null
			triggeredBy: string
			conditionsMatched: boolean
			actionsExecuted: Array<{ success: boolean; action: { type: string }; message?: string }>
			executionDurationMs: number | null
			errorMessage: string | null
			createdAt: number
		}>
	>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [page, setPage] = useState(0)
	const [total, setTotal] = useState(0)
	const limit = 20

	async function loadLogs() {
		setLoading(true)
		try {
			const res = await getRuleLogs(rule.id, limit, page * limit)
			setLogs(res.logs)
			setTotal(res.total)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load logs')
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		loadLogs()
	}, [page])

	const totalPages = Math.ceil(total / limit)

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4"
			style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
		>
			<div
				className="w-full max-w-4xl max-h-[90vh] rounded-xl border overflow-hidden"
				style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
			>
				<div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
					<div>
						<h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
							Execution Logs: {rule.name}
						</h2>
						<p className="text-xs" style={{ color: 'var(--text-muted)' }}>
							{total} total entries
						</p>
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={loadLogs}
							className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
							style={{ color: 'var(--text-muted)' }}
						>
							<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
						</button>
						<button
							onClick={onClose}
							className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
							style={{ color: 'var(--text-muted)' }}
						>
							<X className="w-5 h-5" />
						</button>
					</div>
				</div>

				<div className="overflow-y-auto max-h-[calc(90vh-200px)]">
					{error && (
						<div
							className="m-6 px-4 py-3 rounded-lg text-sm"
							style={{
								backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
								color: 'var(--error)',
							}}
						>
							{error}
						</div>
					)}

					{loading ? (
						<div className="flex items-center justify-center h-64">
							<div className="text-sm" style={{ color: 'var(--text-muted)' }}>
								Loading...
							</div>
						</div>
					) : logs.length === 0 ? (
						<div className="text-center py-12">
							<p className="text-sm" style={{ color: 'var(--text-muted)' }}>
								No execution logs yet
							</p>
						</div>
					) : (
						<div className="divide-y" style={{ borderColor: 'var(--border)' }}>
							{logs.map((log) => (
								<div key={log.id} className="p-4 hover:bg-[var(--bg-tertiary)]">
									<div className="flex items-start justify-between gap-4">
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2 mb-1">
												{log.conditionsMatched ? (
													<span
														className="text-xs px-2 py-0.5 rounded-full"
														style={{
															backgroundColor: 'color-mix(in srgb, #a6e3a1 20%, transparent)',
															color: '#a6e3a1',
														}}
													>
														Matched
													</span>
												) : (
													<span
														className="text-xs px-2 py-0.5 rounded-full"
														style={{
															backgroundColor: 'color-mix(in srgb, var(--text-muted) 20%, transparent)',
															color: 'var(--text-muted)',
														}}
													>
														Not Matched
													</span>
												)}
												<span className="text-xs" style={{ color: 'var(--text-muted)' }}>
													{new Date(log.createdAt * 1000).toLocaleString()}
												</span>
											</div>
											{log.torrentName && (
												<div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
													{log.torrentName}
												</div>
											)}
											<div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
												Triggered by: {log.triggeredBy}
												{log.executionDurationMs && ` • ${log.executionDurationMs}ms`}
											</div>
											{log.errorMessage && (
												<div className="text-xs mt-1" style={{ color: 'var(--error)' }}>
													Error: {log.errorMessage}
												</div>
											)}
										</div>
										{log.actionsExecuted.length > 0 && (
											<div className="text-right">
												<div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
													{log.actionsExecuted.filter((a) => a.success).length}/{log.actionsExecuted.length} actions
												</div>
											</div>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Pagination */}
				{totalPages > 1 && (
					<div
						className="flex items-center justify-between px-6 py-4 border-t"
						style={{ borderColor: 'var(--border)' }}
					>
						<button
							onClick={() => setPage(page - 1)}
							disabled={page === 0}
							className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm disabled:opacity-50"
							style={{ color: 'var(--text-secondary)' }}
						>
							<ChevronLeft className="w-4 h-4" />
							Previous
						</button>
						<span className="text-sm" style={{ color: 'var(--text-muted)' }}>
							Page {page + 1} of {totalPages}
						</span>
						<button
							onClick={() => setPage(page + 1)}
							disabled={page >= totalPages - 1}
							className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm disabled:opacity-50"
							style={{ color: 'var(--text-secondary)' }}
						>
							Next
							<ChevronRight className="w-4 h-4" />
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
