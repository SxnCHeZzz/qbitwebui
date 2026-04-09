import { useState } from 'react'
import { X, Play, AlertCircle } from 'lucide-react'
import type { Instance } from '../api/instances'
import type { AutomationRule } from '../types/automation'
import { testRule } from '../api/automation'

interface Props {
	rule: AutomationRule
	instances: Instance[]
	onClose: () => void
}

export function AutomationRuleTester({ rule, instances, onClose }: Props) {
	const [mockTorrent, setMockTorrent] = useState({
		hash: 'test123',
		name: 'Test Torrent',
		size: 1073741824,
		progress: 1,
		state: 'uploading',
		ratio: 2.5,
		seeding_time: 86400,
		category: 'Movies',
		tags: 'hd,test',
		dlspeed: 0,
		upspeed: 102400,
		priority: 0,
		num_seeds: 10,
		num_leechs: 2,
		added_on: Math.floor(Date.now() / 1000) - 86400,
		completion_on: Math.floor(Date.now() / 1000) - 43200,
		last_activity: Math.floor(Date.now() / 1000),
		uploaded: 2684354560,
		downloaded: 1073741824,
		save_path: '/downloads',
		tracker: 'tracker.example.com',
	})
	const [testing, setTesting] = useState(false)
	const [result, setResult] = useState<{
		matched: boolean
		wouldExecuteActions: unknown[]
		evaluationDurationMs: number
		error?: string
	} | null>(null)
	const [error, setError] = useState('')

	async function handleTest() {
		setTesting(true)
		setError('')
		try {
			const res = await testRule(rule.id, { mockTorrent })
			setResult({
				matched: res.matched,
				wouldExecuteActions: res.wouldExecuteActions,
				evaluationDurationMs: res.evaluationDurationMs,
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Test failed')
		} finally {
			setTesting(false)
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4"
			style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
		>
			<div
				className="w-full max-w-2xl max-h-[90vh] rounded-xl border overflow-hidden"
				style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
			>
				<div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
					<h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
						Test Rule: {rule.name}
					</h2>
					<button
						onClick={onClose}
						className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
						style={{ color: 'var(--text-muted)' }}
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				<div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)] space-y-4">
					{error && (
						<div
							className="px-4 py-3 rounded-lg text-sm flex items-center gap-2"
							style={{
								backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
								color: 'var(--error)',
							}}
						>
							<AlertCircle className="w-4 h-4" />
							{error}
						</div>
					)}

					<div>
						<h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
							Mock Torrent Data
						</h3>
						<div className="grid grid-cols-2 gap-3">
							{Object.entries(mockTorrent).map(([key, value]) => (
								<div key={key}>
									<label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
										{key}
									</label>
									<input
										type="text"
										value={String(value)}
										onChange={(e) => {
											let val: string | number = e.target.value
											if (typeof value === 'number') val = parseFloat(e.target.value) || 0
											setMockTorrent({ ...mockTorrent, [key]: val })
										}}
										className="w-full px-3 py-2 rounded-lg border text-sm"
										style={{
											backgroundColor: 'var(--bg-tertiary)',
											borderColor: 'var(--border)',
											color: 'var(--text-primary)',
										}}
									/>
								</div>
							))}
						</div>
					</div>

					{result && (
						<div
							className="p-4 rounded-lg border"
							style={{
								backgroundColor: result.matched
									? 'color-mix(in srgb, #a6e3a1 10%, transparent)'
									: 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
								borderColor: result.matched ? '#a6e3a1' : 'var(--border)',
							}}
						>
							<h3 className="font-medium mb-2" style={{ color: result.matched ? '#a6e3a1' : 'var(--text-muted)' }}>
								{result.matched ? 'Conditions Matched!' : 'Conditions Did Not Match'}
							</h3>
							{result.matched && result.wouldExecuteActions.length > 0 && (
								<div>
									<div className="text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
										Actions that would execute:
									</div>
									<ul className="text-sm space-y-1" style={{ color: 'var(--text-muted)' }}>
										{result.wouldExecuteActions.map((a, i) => (
											<li key={i}>• {(a as { type: string }).type}</li>
										))}
									</ul>
								</div>
							)}
							<div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
								Evaluation time: {result.evaluationDurationMs}ms
							</div>
						</div>
					)}
				</div>

				<div
					className="flex items-center justify-end gap-3 px-6 py-4 border-t"
					style={{ borderColor: 'var(--border)' }}
				>
					<button
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-sm border"
						style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
					>
						Close
					</button>
					<button
						onClick={handleTest}
						disabled={testing}
						className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
						style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-contrast)' }}
					>
						<Play className="w-4 h-4" />
						{testing ? 'Testing...' : 'Test Rule'}
					</button>
				</div>
			</div>
		</div>
	)
}
