import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import type { Instance } from '../api/instances'
import type { AutomationRule, CreateAutomationRuleInput, Action } from '../types/automation'
import { createRule, updateRule } from '../api/automation'

interface Props {
	instances: Instance[]
	rule: AutomationRule | null
	conditionExamples: Array<{ name: string; condition: unknown }>
	actionExamples: Array<{ name: string; action: Action }>
	onClose: () => void
	onSave: () => void
}

const triggerTypes = [
	{ value: 'cron', label: 'Scheduled (Cron)', description: 'Run periodically using cron expression' },
	{ value: 'torrent_added', label: 'Torrent Added', description: 'When new torrent is added' },
	{ value: 'torrent_completed', label: 'Torrent Completed', description: 'When download finishes' },
	{ value: 'state_changed', label: 'State Changed', description: 'When torrent state changes' },
	{ value: 'ratio_reached', label: 'Ratio Reached', description: 'When ratio threshold is met' },
	{ value: 'manual', label: 'Manual Only', description: 'Run only when manually triggered' },
]

const actionTypes = [
	{ value: 'set_category', label: 'Set Category', hasParam: true, paramLabel: 'Category' },
	{ value: 'add_tag', label: 'Add Tag', hasParam: true, paramLabel: 'Tag' },
	{ value: 'remove_tag', label: 'Remove Tag', hasParam: true, paramLabel: 'Tag' },
	{ value: 'set_upload_limit', label: 'Set Upload Limit', hasParam: true, paramLabel: 'Limit (bytes/s, 0=unlimited)' },
	{
		value: 'set_download_limit',
		label: 'Set Download Limit',
		hasParam: true,
		paramLabel: 'Limit (bytes/s, 0=unlimited)',
	},
	{ value: 'pause', label: 'Pause Torrent', hasParam: false },
	{ value: 'resume', label: 'Resume Torrent', hasParam: false },
	{ value: 'delete', label: 'Delete Torrent', hasParam: true, paramLabel: 'Delete Files (true/false)' },
	{ value: 'move', label: 'Move Torrent', hasParam: true, paramLabel: 'Destination Path' },
	{ value: 'set_priority', label: 'Set Priority', hasParam: true, paramLabel: 'Priority (0-7)' },
]

// Простые примеры условий для UI
const simpleConditions = [
	{ name: 'Always true', condition: {} },
	{ name: 'Completed torrent', condition: { '==': [{ var: 'torrent.progress' }, 1] } },
	{ name: 'Ratio > 1.5', condition: { '>': [{ var: 'torrent.ratio' }, 1.5] } },
	{ name: 'Category is Movies', condition: { '==': [{ var: 'torrent.category' }, 'Movies'] } },
	{ name: 'Has tag "keep"', condition: { in: ['keep', { var: 'torrent.tags' }] } },
	{
		name: 'Completed AND ratio > 1',
		condition: {
			and: [{ '==': [{ var: 'torrent.progress' }, 1] }, { '>=': [{ var: 'torrent.ratio' }, 1] }],
		},
	},
]

export function AutomationRuleBuilder({ instances, rule, onClose, onSave }: Props) {
	const [name, setName] = useState(rule?.name || '')
	const [instanceId, setInstanceId] = useState(rule?.instanceId || instances[0]?.id || 0)
	const [triggerType, setTriggerType] = useState(rule?.triggerType || 'manual')
	const [cronExpression, setCronExpression] = useState((rule?.triggerConfig?.cron as string) || '')
	const [conditions, setConditions] = useState<unknown>(rule?.conditions || {})
	const [actions, setActions] = useState<Action[]>(rule?.actions || [])
	const [enabled, setEnabled] = useState(rule?.enabled ?? true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')
	const [activeTab, setActiveTab] = useState<'conditions' | 'actions'>('conditions')

	async function handleSave() {
		if (!name.trim()) {
			setError('Name is required')
			return
		}
		if (triggerType === 'cron' && !cronExpression.trim()) {
			setError('Cron expression is required for scheduled rules')
			return
		}
		if (actions.length === 0) {
			setError('At least one action is required')
			return
		}

		setSaving(true)
		setError('')

		try {
			const data: CreateAutomationRuleInput = {
				instanceId,
				name: name.trim(),
				enabled,
				triggerType,
				triggerConfig: triggerType === 'cron' ? { cron: cronExpression } : {},
				conditions,
				actions,
				executionOrder: 0,
			}

			if (rule) {
				await updateRule(rule.id, data)
			} else {
				await createRule(data)
			}
			onSave()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save rule')
		} finally {
			setSaving(false)
		}
	}

	function addAction(type: string) {
		const newAction: Action = { type } as Action
		if (type === 'delete') newAction.deleteFiles = false
		setActions([...actions, newAction])
	}

	function updateAction(index: number, updates: Partial<Action>) {
		const updated = [...actions]
		updated[index] = { ...updated[index], ...updates }
		setActions(updated)
	}

	function removeAction(index: number) {
		setActions(actions.filter((_, i) => i !== index))
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
			style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
		>
			<div
				className="w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] rounded-xl border overflow-hidden"
				style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b"
					style={{ borderColor: 'var(--border)' }}
				>
					<h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
						{rule ? 'Edit Rule' : 'Create Rule'}
					</h2>
					<button
						onClick={onClose}
						className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
						style={{ color: 'var(--text-muted)' }}
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Content */}
				<div className="p-3 sm:p-6 overflow-y-auto max-h-[calc(95vh-120px)] sm:max-h-[calc(90vh-140px)] space-y-4 sm:space-y-6">
					{/* Error */}
					{error && (
						<div
							className="px-4 py-3 rounded-lg text-sm"
							style={{
								backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
								color: 'var(--error)',
							}}
						>
							{error}
						</div>
					)}

					{/* Basic Settings */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
						<div>
							<label
								className="block text-xs font-medium mb-2 uppercase tracking-wider"
								style={{ color: 'var(--text-muted)' }}
							>
								Rule Name
							</label>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="w-full px-4 py-2.5 rounded-lg border text-sm"
								style={{
									backgroundColor: 'var(--bg-tertiary)',
									borderColor: 'var(--border)',
									color: 'var(--text-primary)',
								}}
								placeholder="e.g., Delete old torrents"
							/>
						</div>
						<div>
							<label
								className="block text-xs font-medium mb-2 uppercase tracking-wider"
								style={{ color: 'var(--text-muted)' }}
							>
								Instance
							</label>
							<select
								value={instanceId}
								onChange={(e) => setInstanceId(parseInt(e.target.value))}
								className="w-full px-4 py-2.5 rounded-lg border text-sm"
								style={{
									backgroundColor: 'var(--bg-tertiary)',
									borderColor: 'var(--border)',
									color: 'var(--text-primary)',
								}}
							>
								{instances.map((instance) => (
									<option key={instance.id} value={instance.id}>
										{instance.label}
									</option>
								))}
							</select>
						</div>
					</div>

					{/* Trigger Type */}
					<div>
						<label
							className="block text-xs font-medium mb-2 uppercase tracking-wider"
							style={{ color: 'var(--text-muted)' }}
						>
							Trigger Type
						</label>
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
							{triggerTypes.map((t) => (
								<button
									key={t.value}
									onClick={() => setTriggerType(t.value)}
									className={`p-3 rounded-lg border text-left transition-all ${
										triggerType === t.value ? 'border-[var(--accent)]' : ''
									}`}
									style={{
										backgroundColor: triggerType === t.value ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
										borderColor: triggerType === t.value ? 'var(--accent)' : 'var(--border)',
									}}
								>
									<div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
										{t.label}
									</div>
									<div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
										{t.description}
									</div>
								</button>
							))}
						</div>
					</div>

					{/* Cron Expression */}
					{triggerType === 'cron' && (
						<div>
							<label
								className="block text-xs font-medium mb-2 uppercase tracking-wider"
								style={{ color: 'var(--text-muted)' }}
							>
								Cron Expression
							</label>
							<input
								type="text"
								value={cronExpression}
								onChange={(e) => setCronExpression(e.target.value)}
								className="w-full px-4 py-2.5 rounded-lg border text-sm font-mono"
								style={{
									backgroundColor: 'var(--bg-tertiary)',
									borderColor: 'var(--border)',
									color: 'var(--text-primary)',
								}}
								placeholder="0 2 * * *"
							/>
							<p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
								Format: minute hour day_of_month month day_of_week • Example: "0 2 * * *" = daily at 2 AM
							</p>
						</div>
					)}

					{/* Enabled Toggle */}
					<div className="flex items-center gap-3">
						<input
							type="checkbox"
							checked={enabled}
							onChange={(e) => setEnabled(e.target.checked)}
							className="w-4 h-4 rounded"
						/>
						<span className="text-sm" style={{ color: 'var(--text-primary)' }}>
							Enable this rule
						</span>
					</div>

					{/* Tabs */}
					<div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
						<div className="flex gap-4 mb-4">
							<button
								onClick={() => setActiveTab('conditions')}
								className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
									activeTab === 'conditions' ? 'border-[var(--accent)]' : 'border-transparent'
								}`}
								style={{ color: activeTab === 'conditions' ? 'var(--accent)' : 'var(--text-muted)' }}
							>
								Conditions
							</button>
							<button
								onClick={() => setActiveTab('actions')}
								className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
									activeTab === 'actions' ? 'border-[var(--accent)]' : 'border-transparent'
								}`}
								style={{ color: activeTab === 'actions' ? 'var(--accent)' : 'var(--text-muted)' }}
							>
								Actions ({actions.length})
							</button>
						</div>

						{activeTab === 'conditions' && (
							<div className="space-y-4">
								<div className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
									Select a preset condition or customize with JSON Logic
								</div>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
									{simpleConditions.map((c) => (
										<button
											key={c.name}
											onClick={() => setConditions(c.condition)}
											className={`p-3 rounded-lg border text-left text-sm transition-all ${
												JSON.stringify(conditions) === JSON.stringify(c.condition) ? 'border-[var(--accent)]' : ''
											}`}
											style={{
												backgroundColor:
													JSON.stringify(conditions) === JSON.stringify(c.condition)
														? 'var(--bg-tertiary)'
														: 'var(--bg-secondary)',
												borderColor:
													JSON.stringify(conditions) === JSON.stringify(c.condition)
														? 'var(--accent)'
														: 'var(--border)',
											}}
										>
											<div style={{ color: 'var(--text-primary)' }}>{c.name}</div>
										</button>
									))}
								</div>
								<div>
									<label
										className="block text-xs font-medium mb-2 uppercase tracking-wider"
										style={{ color: 'var(--text-muted)' }}
									>
										Custom JSON Logic (Advanced)
									</label>
									<textarea
										value={JSON.stringify(conditions, null, 2)}
										onChange={(e) => {
											try {
												setConditions(JSON.parse(e.target.value))
											} catch {
												// Ignore invalid JSON while typing
											}
										}}
										className="w-full px-4 py-3 rounded-lg border text-sm font-mono h-40"
										style={{
											backgroundColor: 'var(--bg-tertiary)',
											borderColor: 'var(--border)',
											color: 'var(--text-primary)',
										}}
									/>
								</div>
							</div>
						)}

						{activeTab === 'actions' && (
							<div className="space-y-4">
								<div className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
									Actions will be executed in order when conditions match
								</div>

								{/* Add Action */}
								<div className="flex gap-2">
									<select
										onChange={(e) => {
											if (e.target.value) {
												addAction(e.target.value)
												e.target.value = ''
											}
										}}
										className="flex-1 px-4 py-2 rounded-lg border text-sm"
										style={{
											backgroundColor: 'var(--bg-tertiary)',
											borderColor: 'var(--border)',
											color: 'var(--text-primary)',
										}}
									>
										<option value="">Add action...</option>
										{actionTypes.map((t) => (
											<option key={t.value} value={t.value}>
												{t.label}
											</option>
										))}
									</select>
								</div>

								{/* Actions List */}
								<div className="space-y-2">
									{actions.map((action, idx) => {
										const actionType = actionTypes.find((t) => t.value === action.type)
										return (
											<div
												key={idx}
												className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-lg border"
												style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border)' }}
											>
												<div className="flex-1">
													<div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
														{actionType?.label || action.type}
													</div>
													{actionType?.hasParam && (
														<div className="mt-2">
															<input
																type="text"
																value={
																	action.category ||
																	action.tag ||
																	action.destination ||
																	(action.deleteFiles !== undefined ? String(action.deleteFiles) : '') ||
																	action.limit ||
																	action.priority ||
																	''
																}
																onChange={(e) => {
																	const val = e.target.value
																	const updates: Partial<Action> = {}
																	if (action.type === 'set_category') updates.category = val
																	if (action.type === 'add_tag' || action.type === 'remove_tag') updates.tag = val
																	if (action.type === 'move') updates.destination = val
																	if (action.type === 'delete') updates.deleteFiles = val === 'true'
																	if (action.type === 'set_upload_limit' || action.type === 'set_download_limit')
																		updates.limit = parseInt(val) || 0
																	if (action.type === 'set_priority') updates.priority = parseInt(val) || 0
																	updateAction(idx, updates)
																}}
																className="w-full px-3 py-1.5 rounded text-sm"
																style={{
																	backgroundColor: 'var(--bg-secondary)',
																	borderColor: 'var(--border)',
																	color: 'var(--text-primary)',
																}}
																placeholder={actionType?.paramLabel}
															/>
														</div>
													)}
												</div>
												<button
													onClick={() => removeAction(idx)}
													className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-secondary)]"
													style={{ color: 'var(--error)' }}
												>
													<Trash2 className="w-4 h-4" />
												</button>
											</div>
										)
									})}
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Footer */}
				<div
					className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 px-3 sm:px-6 py-3 sm:py-4 border-t"
					style={{ borderColor: 'var(--border)' }}
				>
					<button
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-sm border"
						style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={saving}
						className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
						style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-contrast)' }}
					>
						{saving ? 'Saving...' : rule ? 'Update Rule' : 'Create Rule'}
					</button>
				</div>
			</div>
		</div>
	)
}
